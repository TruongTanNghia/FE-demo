"""
Backend local cho Traffic Monitor (Bai 9) - chay tren GPU neu co.

    cd webapp/backend
    pip install -r requirements.txt
    python server.py            # http://localhost:8000

Pipeline dung dung cac thanh phan supervision cua giao trinh:
  YOLO -> sv.Detections -> loc -> ByteTrack -> Smoother -> LineZone / PolygonZone
  -> ViewTransformer (toc do) -> Annotators -> MJPEG + WebSocket (thong ke, vi pham)

Web-app (Next.js) chi hien thi & ve vach/vung bang chuot roi POST /api/config.
Nguon video: file, webcam (0), RTSP (doc thang bang OpenCV - khong can relay), "sample".
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import queue
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

# RTSP qua TCP on dinh hon UDP; timeout 5s
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")

import supervision as sv  # noqa: E402
import torch  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from ultralytics import YOLO  # noqa: E402

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
SAMPLE_VIDEO = REPO / "vehicles.mp4"
MODEL_PATH = REPO / "yolov8n.pt" if (REPO / "yolov8n.pt").exists() else Path("yolov8n.pt")
VIOL_DIR = ROOT / "violations"
UPLOAD_DIR = ROOT / "uploads"
VIOL_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

VEHICLE_CLASSES = [2, 3, 5, 7]
STREAM_MAX_WIDTH = int(os.environ.get("STREAM_WIDTH", "1280"))  # thu nho frame MJPEG (chi de xem)
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "70"))  # giam (60-70) neu xem qua tunnel/mang yeu
STREAM_FPS = float(os.environ.get("STREAM_FPS", "10"))  # gioi han fps cua luong hinh gui di (xu ly van full fps)
IMGSZ = int(os.environ.get("IMGSZ", "640"))
# Token bao ve khi mo backend ra internet (tunnel). De trong = khong kiem tra (chi dung trong LAN).
API_TOKEN = os.environ.get("API_TOKEN", "").strip()


# ============================================================ FrameReader
class FrameReader(threading.Thread):
    """Doc frame o thread rieng. Nguon live (rtsp/webcam) chi giu frame moi nhat -> khong tre."""

    def __init__(self, source: str | int):
        super().__init__(daemon=True)
        self.source = source
        self.live = isinstance(source, int) or str(source).lower().startswith(("rtsp://", "rtsps://", "http"))
        self.cap = cv2.VideoCapture(source)
        if not self.cap.isOpened():
            raise RuntimeError(f"Khong mo duoc nguon: {source}")
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 25.0
        if self.fps <= 1 or self.fps > 120:
            self.fps = 25.0
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.q: queue.Queue = queue.Queue(maxsize=1 if self.live else 4)
        self.stop_flag = False
        self.frame_idx = 0
        self.t0 = time.time()

    def run(self):
        while not self.stop_flag:
            ok, frame = self.cap.read()
            if not ok:
                if self.live:
                    time.sleep(0.5)
                    self.cap.release()
                    self.cap = cv2.VideoCapture(self.source)  # reconnect
                    continue
                # file: lap lai tu dau
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self.frame_idx = 0
                continue
            self.frame_idx += 1
            t = time.time() - self.t0 if self.live else self.frame_idx / self.fps
            item = (frame, t)
            if self.live:
                # chi giu frame moi nhat
                try:
                    self.q.get_nowait()
                except queue.Empty:
                    pass
                self.q.put(item)
            else:
                while not self.stop_flag:
                    try:
                        self.q.put(item, timeout=0.2)
                        break
                    except queue.Full:
                        pass
        self.cap.release()

    def read(self, timeout=1.0):
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None

    def stop(self):
        self.stop_flag = True


# ============================================================ ViewTransformer (Bai 8)
class ViewTransformer:
    def __init__(self, source: np.ndarray, target: np.ndarray):
        self.m = cv2.getPerspectiveTransform(source.astype(np.float32), target.astype(np.float32))

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        if points.size == 0:
            return points
        reshaped = points.reshape(-1, 1, 2).astype(np.float32)
        return cv2.perspectiveTransform(reshaped, self.m).reshape(-1, 2)


def order_quad(pts: list[dict]) -> np.ndarray:
    s = sorted(pts, key=lambda p: p["y"])
    top = sorted(s[:2], key=lambda p: p["x"])
    bottom = sorted(s[2:], key=lambda p: p["x"])
    return np.array([[p["x"], p["y"]] for p in (top[0], top[1], bottom[1], bottom[0])], dtype=np.float32)


# ============================================================ Pipeline (Bai 9)
class Pipeline(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device_name = torch.cuda.get_device_name(0) if self.device == "cuda" else "CPU"
        self.model = YOLO(str(MODEL_PATH))
        self.model.to(self.device)

        self.lock = threading.Lock()
        self.cfg: dict[str, Any] = {
            "line": None,
            "zones": [],
            "perspective": None,
            "speed_limit": 80.0,
            "conf": 0.3,
            "dwell_seconds": 10.0,
            "show_traces": True,
        }
        self.reader: Optional[FrameReader] = None
        self.source_label = ""
        self.pending_source: Optional[str | int] = None
        self.error = ""

        self.latest_jpeg: Optional[bytes] = None
        self.frame_cond = threading.Condition()
        self.events: queue.Queue = queue.Queue()
        self.fps = 0.0
        self.infer_ms = 0.0
        self.active = 0
        self._build_geometry()
        self._reset_stats()

    # ---------- cau hinh ----------
    def _build_geometry(self):
        w = self.reader.width if self.reader else 1920
        h = self.reader.height if self.reader else 1080
        fps = self.reader.fps if self.reader else 25.0
        thickness = sv.calculate_optimal_line_thickness((w, h))
        text_scale = sv.calculate_optimal_text_scale((w, h))
        self.thickness, self.text_scale = thickness, text_scale

        line = self.cfg["line"]
        self.line_zone = None
        if line:
            self.line_zone = sv.LineZone(
                start=sv.Point(line["start"]["x"], line["start"]["y"]),
                end=sv.Point(line["end"]["x"], line["end"]["y"]),
                triggering_anchors=[sv.Position.BOTTOM_CENTER],
                minimum_crossing_threshold=2,
            )
        self.line_annotator = sv.LineZoneAnnotator(
            thickness=thickness, text_scale=text_scale, custom_in_text="Vao", custom_out_text="Ra"
        )

        self.zones = []
        colors = [sv.Color.RED, sv.Color.BLUE, sv.Color.GREEN, sv.Color.from_hex("#c084fc"), sv.Color.YELLOW]
        for i, z in enumerate(self.cfg["zones"]):
            poly = np.array([[p["x"], p["y"]] for p in z["points"]], dtype=np.int32)
            zone = sv.PolygonZone(polygon=poly, triggering_anchors=(sv.Position.BOTTOM_CENTER,))
            ann = sv.PolygonZoneAnnotator(
                zone=zone, color=colors[i % len(colors)], thickness=thickness,
                text_scale=text_scale * 1.5, text_thickness=thickness, opacity=0.2,
            )
            self.zones.append((z["id"], zone, ann))

        self.view_transformer = None
        self.persp_src = None
        p = self.cfg["perspective"]
        if p and len(p.get("src", [])) == 4:
            src = order_quad(p["src"])
            W, L = float(p["widthM"]), float(p["lengthM"])
            target = np.array([[0, 0], [W, 0], [W, L], [0, L]], dtype=np.float32)
            self.view_transformer = ViewTransformer(src, target)
            self.persp_src = src.astype(np.int32)

        self.tracker = sv.ByteTrack(frame_rate=fps)
        self.smoother = sv.DetectionsSmoother(length=5)
        self.box_annotator = sv.BoxAnnotator(thickness=thickness, color_lookup=sv.ColorLookup.TRACK)
        self.label_annotator = sv.LabelAnnotator(text_scale=text_scale, color_lookup=sv.ColorLookup.TRACK)
        self.trace_annotator = sv.TraceAnnotator(
            trace_length=int(fps * 2), thickness=thickness, color_lookup=sv.ColorLookup.TRACK
        )

    def _reset_stats(self):
        self.class_counts = defaultdict(int)
        self.coordinates = defaultdict(lambda: deque())  # tid -> [(t, x, y)] trong 1 giay
        self.speeds: dict[int, float] = {}
        self.speed_violations: dict[int, dict] = {}
        self.zone_enter: dict[tuple, float] = {}
        self.zone_counts: dict[int, int] = {}
        self.dwell_alerts: list[dict] = []
        self.last_violation_t = -10.0
        if self.line_zone is not None:
            self.line_zone.in_count = 0
            self.line_zone.out_count = 0
        try:
            self.tracker.reset()
        except Exception:
            pass

    def set_config(self, cfg: dict):
        with self.lock:
            self.cfg.update({k: v for k, v in cfg.items() if v is not None or k in ("line", "perspective")})
            self._build_geometry_keep_counts()

    def _build_geometry_keep_counts(self):
        in_c = self.line_zone.in_count if self.line_zone else 0
        out_c = self.line_zone.out_count if self.line_zone else 0
        old_tracker = self.tracker
        self._build_geometry()
        self.tracker = old_tracker  # giu ID dang chay
        if self.line_zone is not None and in_c + out_c:
            self.line_zone.in_count, self.line_zone.out_count = in_c, out_c

    def set_source(self, source: str):
        src: str | int
        if source == "sample":
            src = str(SAMPLE_VIDEO)
            self.source_label = "vehicles.mp4 (mau)"
        elif source.isdigit():
            src = int(source)
            self.source_label = f"Webcam {source}"
        else:
            src = source
            self.source_label = source.split("@")[-1][:60] if "rtsp" in source else Path(source).name
        self.pending_source = src

    def reset(self):
        with self.lock:
            self._reset_stats()

    # ---------- vong lap ----------
    def run(self):
        last_fps_t, n = time.time(), 0
        while True:
            if self.pending_source is not None:
                src, self.pending_source = self.pending_source, None
                if self.reader:
                    self.reader.stop()
                    self.reader = None
                try:
                    self.reader = FrameReader(src)
                    self.reader.start()
                    self.error = ""
                    with self.lock:
                        self._build_geometry()
                        self._reset_stats()
                except Exception as e:  # noqa: BLE001
                    self.error = str(e)
                    self.reader = None
            if self.reader is None:
                time.sleep(0.1)
                continue
            item = self.reader.read()
            if item is None:
                continue
            frame, t = item
            t0 = time.time()
            try:
                with self.lock:
                    out = self.process_frame(frame, t)
            except Exception as e:  # noqa: BLE001
                self.error = f"Loi xu ly: {e}"
                continue
            self.infer_ms = 0.8 * self.infer_ms + 0.2 * (time.time() - t0) * 1000
            n += 1
            if time.time() - last_fps_t > 0.5:
                self.fps = n / (time.time() - last_fps_t)
                n, last_fps_t = 0, time.time()
            self._publish(out)
            # file: khong chay nhanh hon fps that (demo nhin tu nhien)
            if not self.reader.live:
                spare = 1.0 / self.reader.fps - (time.time() - t0)
                if spare > 0:
                    time.sleep(spare)

    def _publish(self, frame):
        now = time.time()
        if now - getattr(self, "_last_pub", 0.0) < 1.0 / STREAM_FPS:
            return  # tiet kiem bang thong: khong gui nhieu hon STREAM_FPS frame/giay
        self._last_pub = now
        h, w = frame.shape[:2]
        if w > STREAM_MAX_WIDTH:
            s = STREAM_MAX_WIDTH / w
            frame = cv2.resize(frame, (STREAM_MAX_WIDTH, int(h * s)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if ok:
            with self.frame_cond:
                self.latest_jpeg = buf.tobytes()
                self.frame_cond.notify_all()

    # ---------- cac buoc Bai 9 ----------
    def process_frame(self, frame, t):
        results = self.model(frame, imgsz=IMGSZ, verbose=False, device=self.device)[0]
        det = sv.Detections.from_ultralytics(results)
        det = det[(det.confidence > float(self.cfg["conf"])) & np.isin(det.class_id, VEHICLE_CLASSES)]
        det = self.tracker.update_with_detections(det)
        det = self.smoother.update_with_detections(det)
        self.active = len(det)
        # Frame khong co xe (hoac tracker lam rot metadata) -> dam bao luon co class_name
        if "class_name" not in det.data or len(det.data["class_name"]) != len(det):
            det.data["class_name"] = np.array(
                [self.model.names.get(int(c), str(c)) for c in det.class_id] if det.class_id is not None else [], dtype=str
            )

        # dem qua vach
        if self.line_zone is not None and det.tracker_id is not None:
            crossed_in, crossed_out = self.line_zone.trigger(det)
            for name in det.data["class_name"][crossed_in]:
                self.class_counts[f"{name}_in"] += 1
            for name in det.data["class_name"][crossed_out]:
                self.class_counts[f"{name}_out"] += 1

        labels = self._speed_labels(det, t, frame)

        # vung polygon + dwell
        self.dwell_alerts = []
        for zid, zone, _ in self.zones:
            inside = zone.trigger(det) if len(det) else np.zeros(0, dtype=bool)
            self.zone_counts[zid] = int(inside.sum())
            tids = set(int(x) for x in det.tracker_id[inside]) if det.tracker_id is not None else set()
            for key in [k for k in self.zone_enter if k[0] == zid and k[1] not in tids]:
                del self.zone_enter[key]
            for tid in tids:
                key = (zid, tid)
                self.zone_enter.setdefault(key, t)
                if t - self.zone_enter[key] > float(self.cfg["dwell_seconds"]):
                    self.dwell_alerts.append({"zone": zid, "tid": tid})

        return self._annotate(frame, det, labels, t)

    def _speed_labels(self, det, t, frame):
        labels = []
        if det.tracker_id is None:
            return labels
        pts = det.get_anchors_coordinates(sv.Position.BOTTOM_CENTER)
        if self.view_transformer is not None:
            pts_m = self.view_transformer.transform_points(pts)
        else:
            pts_m = None
        limit = float(self.cfg["speed_limit"])
        for i, (tid, name) in enumerate(zip(det.tracker_id, det.data["class_name"])):
            tid = int(tid)
            label = f"#{tid} {name}"
            if pts_m is not None:
                h = self.coordinates[tid]
                h.append((t, float(pts_m[i][0]), float(pts_m[i][1])))
                while h and t - h[0][0] > 1.0:
                    h.popleft()
                span = t - h[0][0]
                if span >= 0.4:
                    dist = float(np.hypot(h[-1][1] - h[0][1], h[-1][2] - h[0][2]))
                    raw = dist / span * 3.6
                    spd = raw if tid not in self.speeds else 0.7 * self.speeds[tid] + 0.3 * raw
                    self.speeds[tid] = spd
                    label += f" {int(spd)}km/h"
                    if spd > limit:
                        label += " !!"
                        self._record_violation(tid, name, spd, t, frame, det.xyxy[i])
            labels.append(label)
        return labels

    def _record_violation(self, tid, name, spd, t, frame, xyxy):
        v = self.speed_violations.get(tid)
        if v:
            v["speed"] = max(v["speed"], int(spd))
            return
        x1, y1, x2, y2 = xyxy
        w, h = x2 - x1, y2 - y1
        crop = sv.crop_image(
            frame, [int(max(0, x1 - w * 0.15)), int(max(0, y1 - h * 0.15)),
                    int(min(frame.shape[1], x2 + w * 0.15)), int(min(frame.shape[0], y2 + h * 0.15))]
        )
        if crop.shape[1] > 480:
            s = 480 / crop.shape[1]
            crop = cv2.resize(crop, (480, int(crop.shape[0] * s)))
        fname = f"vi_pham_{int(time.time())}_{tid}_{int(spd)}kmh.jpg"
        cv2.imwrite(str(VIOL_DIR / fname), crop)
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        data_url = "data:image/jpeg;base64," + base64.b64encode(buf).decode() if ok else None
        rec = {"id": tid, "name": name, "speed": int(spd), "time": round(t, 2), "file": fname, "snapshot": data_url}
        self.speed_violations[tid] = rec
        self.last_violation_t = t
        self.events.put({"type": "violation", **rec})

    def _annotate(self, frame, det, labels, t):
        out = frame.copy()
        if self.persp_src is not None:
            out = sv.draw_polygon(out, polygon=self.persp_src, color=sv.Color.from_hex("#c084fc"), thickness=self.thickness)
        for _, _, ann in self.zones:
            out = ann.annotate(out)
        if self.cfg["show_traces"] and det.tracker_id is not None:
            out = self.trace_annotator.annotate(out, det)
        out = self.box_annotator.annotate(out, det)
        if labels:
            out = self.label_annotator.annotate(out, det, labels=labels)
        if self.line_zone is not None:
            out = self.line_annotator.annotate(out, line_counter=self.line_zone)

        banner = None
        if self.dwell_alerts:
            banner = "!!! XE DUNG QUA LAU TRONG VUNG: " + ", ".join(f"#{a['tid']}" for a in self.dwell_alerts) + " !!!"
        elif t - self.last_violation_t < 2.5:
            banner = "!!! PHAT HIEN XE QUA TOC DO - DA CHUP HINH !!!"
        if banner:
            hgt = int(self.text_scale * 60)
            cv2.rectangle(out, (0, 0), (out.shape[1], hgt), (0, 0, 255), -1)
            cv2.putText(out, banner, (20, int(hgt * 0.7)), cv2.FONT_HERSHEY_SIMPLEX,
                        self.text_scale * 1.6, (255, 255, 255), max(2, self.thickness))
        return out

    # ---------- du lieu cho UI ----------
    def status(self):
        r = self.reader
        return {
            "running": r is not None,
            "source": self.source_label,
            "live": bool(r and r.live),
            "width": r.width if r else 0,
            "height": r.height if r else 0,
            "fps_source": r.fps if r else 0,
            "fps": round(self.fps, 1),
            "infer_ms": round(self.infer_ms),
            "device": self.device_name,
            "error": self.error,
            "config": self.cfg,
        }

    def stats(self):
        return {
            "type": "stats",
            "inCount": self.line_zone.in_count if self.line_zone else 0,
            "outCount": self.line_zone.out_count if self.line_zone else 0,
            "byClass": dict(self.class_counts),
            "zoneCounts": self.zone_counts,
            "dwellAlerts": self.dwell_alerts,
            "violationCount": len(self.speed_violations),
            "active": self.active,
            "fps": round(self.fps, 1),
            "infer_ms": round(self.infer_ms),
            "error": self.error,
        }

    def report(self):
        return {
            "source": self.source_label,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "device": self.device_name,
            "total_in": self.line_zone.in_count if self.line_zone else 0,
            "total_out": self.line_zone.out_count if self.line_zone else 0,
            "by_class": dict(self.class_counts),
            "speed_limit_kmh": self.cfg["speed_limit"],
            "speed_violations": [{k: v for k, v in r.items() if k != "snapshot"} for r in self.speed_violations.values()],
            "zones": [{"id": zid, "current": self.zone_counts.get(zid, 0)} for zid, _, _ in self.zones],
        }


# ============================================================ FastAPI
app = FastAPI(title="Traffic Monitor backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
pipeline = Pipeline()


def _token_ok(token: Optional[str]) -> bool:
    return not API_TOKEN or token == API_TOKEN


@app.middleware("http")
async def _security(request, call_next):
    # 1) Token: ?token=... hoac header X-Token (bo qua preflight OPTIONS)
    if request.method != "OPTIONS" and not _token_ok(request.query_params.get("token") or request.headers.get("x-token")):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "Sai hoac thieu token"}, status_code=401)
    resp = await call_next(request)
    # 2) Cho phep trang Vercel (COEP credentialless) nhung MJPEG/anh tu domain nay
    resp.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    return resp


class SourceIn(BaseModel):
    source: str


class ConfigIn(BaseModel):
    line: Optional[dict] = None
    zones: Optional[list] = None
    perspective: Optional[dict] = None
    speed_limit: Optional[float] = None
    conf: Optional[float] = None
    dwell_seconds: Optional[float] = None
    show_traces: Optional[bool] = None


@app.on_event("startup")
def _start():
    pipeline.start()
    port = os.environ.get("PORT", "8000")
    print(f"[backend] model={MODEL_PATH.name} device={pipeline.device_name} imgsz={IMGSZ}")
    print(f"[backend] token: {'BAT' if API_TOKEN else 'TAT (chi nen dung trong LAN)'}")
    print(f"[backend] Cung may:   dan http://localhost:{port} vao web-app (Vercel cung dung duoc)")
    print(f"[backend] May khac:   run_tunnel.bat -> dan URL https://....trycloudflare.com vao web-app")


@app.get("/api/status")
def api_status():
    return pipeline.status()


@app.post("/api/source")
def api_source(body: SourceIn):
    pipeline.set_source(body.source.strip())
    return {"ok": True}


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    dst = UPLOAD_DIR / Path(file.filename).name
    with open(dst, "wb") as f:
        while chunk := await file.read(1 << 20):
            f.write(chunk)
    pipeline.set_source(str(dst))
    return {"ok": True, "path": str(dst)}


@app.post("/api/config")
def api_config(body: ConfigIn):
    pipeline.set_config(body.model_dump(exclude_unset=True))
    return {"ok": True}


@app.post("/api/reset")
def api_reset():
    pipeline.reset()
    return {"ok": True}


@app.get("/api/stats")
def api_stats():
    """Polling thay cho WebSocket (chay tot qua ngrok/cloudflare/proxy)."""
    return pipeline.stats()


@app.get("/api/report")
def api_report():
    return pipeline.report()


@app.get("/api/violations")
def api_violations():
    return list(pipeline.speed_violations.values())


@app.get("/stream.mjpg")
def stream():
    def gen():
        last = None
        while True:
            with pipeline.frame_cond:
                pipeline.frame_cond.wait(timeout=1.0)
                jpg = pipeline.latest_jpeg
            if jpg is None or jpg is last:
                continue
            last = jpg
            yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n"

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-cache"})


@app.get("/stream.bin")
def stream_bin():
    """JPEG noi tiep nhau, content-type nhi phan thuan.
    Dung cho fetch() trong trinh duyet: Chrome xu ly dac biet multipart/x-mixed-replace nen
    fetch() khong nhan duoc luong tho; octet-stream thi qua ngrok/proxy/browser deu nguyen ven."""

    def gen():
        last = None
        while True:
            with pipeline.frame_cond:
                pipeline.frame_cond.wait(timeout=1.0)
                jpg = pipeline.latest_jpeg
            if jpg is None or jpg is last:
                continue
            last = jpg
            yield jpg

    return StreamingResponse(
        gen(),
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-cache, no-store", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no"},
    )


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    if not _token_ok(websocket.query_params.get("token")):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        while True:
            await websocket.send_text(json.dumps(pipeline.stats()))
            while True:
                try:
                    ev = pipeline.events.get_nowait()
                except queue.Empty:
                    break
                await websocket.send_text(json.dumps(ev))
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="info")
