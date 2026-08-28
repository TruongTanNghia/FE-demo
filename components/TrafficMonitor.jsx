"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detect, getProvider, loadDetector } from "@/lib/detector";
import { ByteTracker } from "@/lib/tracker";
import { TrafficMonitor as Monitor } from "@/lib/monitor";
import { drawAlertBanner, drawDraft, drawLine, drawPerspective, drawTraces, drawTracks, drawZones, scaleFor } from "@/lib/draw";
import SidePanel from "./SidePanel";
import RtspGuide from "./RtspGuide";

const SAMPLE_URL = "https://media.roboflow.com/supervision/video-examples/vehicles.mp4";
const STORAGE_KEY = "traffic-monitor-config-v1";

const DEFAULT_SETTINGS = {
  conf: 0.3,
  speedLimit: 80,
  roadWidth: 25,
  roadLength: 250,
  dwellSeconds: 10,
  showTraces: true,
  inferEvery: 1, // detect moi N frame (1 = moi frame)
};

export default function TrafficMonitor({ engineSwitch = null }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const hlsRef = useRef(null);

  const monitorRef = useRef(new Monitor());
  const trackerRef = useRef(new ByteTracker());
  const rafRef = useRef(0);
  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const lastRef = useRef({ tracks: [], labels: new Map() });
  const draftRef = useRef([]);
  const cursorRef = useRef(null);
  const modeRef = useRef("none");
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const fpsRef = useRef({ t: performance.now(), n: 0, fps: 0, infer: 0 });
  const frameNoRef = useRef(0);
  const lastAlertRef = useRef(0);

  const [status, setStatus] = useState({ text: "Chưa nạp model", kind: "idle" });
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("none");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [stats, setStats] = useState(null);
  const [violations, setViolations] = useState([]);
  const [geom, setGeom] = useState({ hasLine: false, zones: [], persp: null });
  const [videoSize, setVideoSize] = useState({ w: 16, h: 9, ready: false });
  const [sourceLabel, setSourceLabel] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [showRtsp, setShowRtsp] = useState(false);
  const [fpsText, setFpsText] = useState("");

  // ---------- Nap model ----------
  useEffect(() => {
    let alive = true;
    setStatus({ text: "Đang nạp model...", kind: "loading" });
    loadDetector((t) => alive && setStatus({ text: t, kind: "loading" }))
      .then(() => alive && setStatus({ text: `Sẵn sàng · ${getProvider().toUpperCase()}`, kind: "ready" }))
      .catch((e) => alive && setStatus({ text: "Lỗi nạp model: " + e.message, kind: "error" }));
    return () => {
      alive = false;
    };
  }, []);

  // ---------- Ap dung settings vao monitor ----------
  useEffect(() => {
    settingsRef.current = settings;
    const m = monitorRef.current;
    m.speedLimit = Number(settings.speedLimit) || 80;
    m.dwellSeconds = Number(settings.dwellSeconds) || 10;
    if (m.perspective) m.setPerspective(m.perspective.src, Number(settings.roadWidth), Number(settings.roadLength));
    saveConfig();
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Luu / nap cau hinh (localStorage) ----------
  const saveConfig = useCallback(() => {
    try {
      const m = monitorRef.current;
      const v = videoRef.current;
      if (!v?.videoWidth) return;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          vw: v.videoWidth,
          vh: v.videoHeight,
          line: m.line,
          zones: m.zones,
          persp: m.perspective ? { src: m.perspective.src } : null,
          settings: settingsRef.current,
        })
      );
    } catch {}
  }, []);

  const loadConfig = useCallback((vw, vh) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      const sx = vw / c.vw, sy = vh / c.vh;
      const sc = (p) => ({ x: p.x * sx, y: p.y * sy });
      const m = monitorRef.current;
      if (c.settings) setSettings({ ...DEFAULT_SETTINGS, ...c.settings });
      if (c.line) m.setLine(sc(c.line.start), sc(c.line.end));
      m.zones = (c.zones || []).map((z) => ({ id: z.id, points: z.points.map(sc) }));
      if (c.persp?.src) {
        const s = c.settings || settingsRef.current;
        m.setPerspective(c.persp.src.map(sc), Number(s.roadWidth), Number(s.roadLength));
      }
      syncGeom();
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncGeom = () => {
    const m = monitorRef.current;
    setGeom({
      hasLine: !!m.line,
      zones: m.zones.map((z) => ({ id: z.id, n: z.points.length })),
      persp: m.perspective ? { w: m.perspective.widthM, l: m.perspective.lengthM } : null,
    });
    drawOverlay();
    saveConfig();
  };

  // ---------- Nguon video ----------
  const attachSource = (label, setup) => {
    stop();
    const v = videoRef.current;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    v.pause();
    v.removeAttribute("src");
    v.srcObject = null;
    v.crossOrigin = "anonymous";
    setVideoSize((s) => ({ ...s, ready: false }));
    resetAll(false);
    setSourceLabel(label);
    setup(v);
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    attachSource(f.name, (v) => {
      v.crossOrigin = null;
      v.src = URL.createObjectURL(f);
      v.loop = true;
    });
    e.target.value = "";
  };

  const onSample = () =>
    attachSource("vehicles.mp4 (mẫu)", (v) => {
      v.src = SAMPLE_URL;
      v.loop = true;
    });

  const onWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
      attachSource("Webcam", (v) => {
        v.srcObject = stream;
        v.loop = false;
      });
    } catch (e) {
      setStatus({ text: "Không mở được webcam: " + e.message, kind: "error" });
    }
  };

  const onStream = async () => {
    const url = streamUrl.trim();
    if (!url) return;
    if (/^rtsps?:\/\//i.test(url)) {
      setShowRtsp(true);
      return;
    }
    attachSource(url.replace(/^https?:\/\//, "").slice(0, 40), async (v) => {
      v.loop = false;
      const isHls = /\.m3u8(\?|$)/i.test(url);
      if (isHls && !v.canPlayType("application/vnd.apple.mpegurl")) {
        const Hls = (await import("hls.js")).default;
        if (Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
          hls.loadSource(url);
          hls.attachMedia(v);
          hlsRef.current = hls;
          return;
        }
      }
      v.src = url;
    });
  };

  const onLoadedMeta = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    setVideoSize({ w: v.videoWidth, h: v.videoHeight, ready: true });
    loadConfig(v.videoWidth, v.videoHeight);
    v.play().catch(() => {});
    start();
  };

  // ---------- Vong lap xu ly ----------
  const start = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    videoRef.current?.play().catch(() => {});
    rafRef.current = requestAnimationFrame(loop);
  };

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
    cancelAnimationFrame(rafRef.current);
    videoRef.current?.pause();
  };

  const loop = () => {
    if (!runningRef.current) return;
    rafRef.current = requestAnimationFrame(loop);
    const v = videoRef.current;
    if (busyRef.current || !v || v.paused || v.ended || v.readyState < 2) return;
    busyRef.current = true;
    processFrame(v).finally(() => (busyRef.current = false));
  };

  const processFrame = async (v) => {
    const s = settingsRef.current;
    const t = v.currentTime;
    frameNoRef.current++;
    const t0 = performance.now();
    let tracks;
    if (frameNoRef.current % Math.max(1, s.inferEvery) === 0 || !lastRef.current.tracks.length) {
      const dets = await detect(v, v.videoWidth, v.videoHeight, { conf: Number(s.conf) });
      tracks = trackerRef.current.update(dets);
    } else {
      tracks = lastRef.current.tracks; // tai su dung ket qua (giam tai CPU)
    }
    const { labels, newViolations } = monitorRef.current.process(tracks, t, v);
    lastRef.current = { tracks, labels };
    if (newViolations.length) {
      lastAlertRef.current = performance.now();
      setViolations((prev) => [...newViolations.reverse(), ...prev]);
    }
    drawOverlay();

    // fps
    const f = fpsRef.current;
    f.n++;
    f.infer = 0.8 * f.infer + 0.2 * (performance.now() - t0);
    const now = performance.now();
    if (now - f.t > 500) {
      f.fps = (f.n * 1000) / (now - f.t);
      f.n = 0;
      f.t = now;
      setFpsText(`${f.fps.toFixed(1)} fps · ${f.infer.toFixed(0)} ms`);
      pushStats();
    }
  };

  const pushStats = () => {
    const m = monitorRef.current;
    setStats({
      inCount: m.inCount,
      outCount: m.outCount,
      byClass: { ...m.byClass },
      zoneCounts: { ...m.zoneCounts },
      dwellAlerts: m.dwellAlerts.slice(),
      violationCount: m.violations.size,
      active: lastRef.current.tracks.length,
    });
  };

  const drawOverlay = () => {
    const c = canvasRef.current;
    if (!c || !c.width) return;
    const ctx = c.getContext("2d");
    const m = monitorRef.current;
    const s = scaleFor(c.width, c.height);
    const { tracks, labels } = lastRef.current;
    ctx.clearRect(0, 0, c.width, c.height);
    drawPerspective(ctx, m.perspective, s);
    drawZones(ctx, m.zones, m.zoneCounts, m.dwellAlerts, s);
    if (settingsRef.current.showTraces) drawTraces(ctx, m.traces, new Set(tracks.map((t) => t.id)), s);
    drawTracks(ctx, tracks, labels, s, m.violations);
    drawLine(ctx, m.line, m.inCount, m.outCount, s);
    drawDraft(ctx, modeRef.current, draftRef.current, modeRef.current !== "none" ? cursorRef.current : null, s);
    if (m.dwellAlerts.length) {
      drawAlertBanner(ctx, `!!! XE DUNG QUA LAU TRONG VUNG: #${m.dwellAlerts.map((a) => a.tid).join(", #")} !!!`, c.width, s);
    } else if (performance.now() - lastAlertRef.current < 2500) {
      drawAlertBanner(ctx, "!!! PHAT HIEN XE QUA TOC DO - DA CHUP HINH !!!", c.width, s);
    }
  };

  // ---------- Ve bang chuot ----------
  const toCanvas = (e) => {
    const c = canvasRef.current;
    // object-fit: contain -> tru phan letterbox truoc khi quy ve toa do frame
    const r = c.getBoundingClientRect();
    const s = Math.min(r.width / c.width, r.height / c.height);
    const ox = (r.width - c.width * s) / 2;
    const oy = (r.height - c.height * s) / 2;
    return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
  };

  const setTool = (m) => {
    const next = modeRef.current === m ? "none" : m;
    modeRef.current = next;
    draftRef.current = [];
    setMode(next);
    drawOverlay();
  };

  const onCanvasClick = (e) => {
    const md = modeRef.current;
    if (md === "none") return;
    const p = toCanvas(e);
    const d = draftRef.current;
    d.push(p);
    const m = monitorRef.current;
    if (md === "line" && d.length === 2) {
      m.setLine(d[0], d[1]);
      draftRef.current = [];
      modeRef.current = "none";
      setMode("none");
      syncGeom();
    } else if (md === "persp" && d.length === 4) {
      const s = settingsRef.current;
      m.setPerspective(d.slice(), Number(s.roadWidth), Number(s.roadLength));
      draftRef.current = [];
      modeRef.current = "none";
      setMode("none");
      syncGeom();
    }
    drawOverlay();
  };

  const finishZone = () => {
    const d = draftRef.current;
    if (modeRef.current === "zone" && d.length >= 3) {
      monitorRef.current.addZone(d.slice());
      draftRef.current = [];
      modeRef.current = "none";
      setMode("none");
      syncGeom();
    }
  };

  const onCanvasMove = (e) => {
    cursorRef.current = toCanvas(e);
    if (modeRef.current !== "none" && (videoRef.current?.paused || !runningRef.current)) drawOverlay();
    else if (modeRef.current !== "none" && !busyRef.current) drawOverlay();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "Enter") finishZone();
      if (e.key === "Escape") setTool("none");
      if (e.key === " ") {
        e.preventDefault();
        running ? stop() : start();
      }
      if (e.key.toLowerCase() === "l") setTool("line");
      if (e.key.toLowerCase() === "z") setTool("zone");
      if (e.key.toLowerCase() === "p") setTool("persp");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // co y khong dat deps: luon dung state moi nhat

  // ---------- Reset / xoa ----------
  const resetAll = (keepGeom = true) => {
    monitorRef.current.resetStats();
    trackerRef.current.reset();
    lastRef.current = { tracks: [], labels: new Map() };
    frameNoRef.current = 0;
    setViolations([]);
    setStats(null);
    if (!keepGeom) {
      monitorRef.current.setLine(null, null);
      monitorRef.current.zones = [];
      monitorRef.current.perspective = null;
      syncGeom();
    }
    drawOverlay();
  };

  const clearLine = () => {
    monitorRef.current.setLine(null, null);
    syncGeom();
  };
  const removeZone = (id) => {
    monitorRef.current.removeZone(id);
    syncGeom();
  };
  const clearPersp = () => {
    monitorRef.current.perspective = null;
    syncGeom();
  };

  const exportReport = () => {
    const rep = monitorRef.current.report(sourceLabel);
    const blob = new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const modelReady = status.kind === "ready";
  const hint = {
    line: "VẠCH ĐẾM: click 2 điểm trên khung hình · Esc hủy",
    zone: "VÙNG POLYGON: click các đỉnh · Enter để đóng vùng · Esc hủy",
    persp: `PHỐI CẢNH: click 4 góc vùng mặt đường (${settings.roadWidth}m × ${settings.roadLength}m) · Esc hủy`,
  }[mode];

  return (
    <div className="app">
      <header className="head">
        <div className="brand">
          <h1>
            Traffic<span>·Monitor</span>
          </h1>
          <small>Bài 9 · Supervision trong trình duyệt</small>
        </div>
        {engineSwitch}

        <label className="btn file-btn">
          📂 Mở video
          <input type="file" accept="video/*" onChange={onFile} />
        </label>
        <button className="btn" onClick={onSample}>🛣 Video mẫu</button>
        <button className="btn" onClick={onWebcam}>📷 Webcam</button>
        <div className="url-row">
          <input
            placeholder="URL stream: .m3u8 / .mp4 / rtsp:// (xem hướng dẫn)"
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onStream()}
          />
          <button className="btn" onClick={onStream}>▶ Kết nối</button>
          <button className="btn" title="Hướng dẫn camera RTSP" onClick={() => setShowRtsp(true)}>RTSP?</button>
        </div>
        <span className={`status ${status.kind}`}>
          <i /> {status.text}
        </span>
      </header>

      <main className="stage" ref={stageRef}>
        <div className="stage-inner">
          <video ref={videoRef} muted playsInline onLoadedMetadata={onLoadedMeta} />
          <canvas
            ref={canvasRef}
            className={mode === "none" ? "idle" : ""}
            onClick={onCanvasClick}
            onDoubleClick={finishZone}
            onMouseMove={onCanvasMove}
            onMouseLeave={() => (cursorRef.current = null)}
            onContextMenu={(e) => {
              e.preventDefault();
              finishZone();
            }}
          />
          {!videoSize.ready && (
            <div className="stage-empty">
              <div>
                <b>Chưa có nguồn video</b>
                Mở file, video mẫu, webcam hoặc stream URL ở thanh trên
              </div>
            </div>
          )}
          {hint && <div className="hint">{hint}</div>}
          {fpsText && running && <div className="fps">{fpsText}</div>}
        </div>
      </main>

      <footer className="tools">
        <button className="btn primary" disabled={!modelReady || !videoSize.ready} onClick={running ? stop : start}>
          {running ? "⏸ Tạm dừng" : "▶ Chạy"} <span className="kbd">Space</span>
        </button>
        <button className={`btn tool-line ${mode === "line" ? "active" : ""}`} disabled={!videoSize.ready} onClick={() => setTool("line")}>
          ━ Vẽ vạch đếm <span className="kbd">L</span>
        </button>
        <button className={`btn tool-zone ${mode === "zone" ? "active" : ""}`} disabled={!videoSize.ready} onClick={() => setTool("zone")}>
          ⬠ Vẽ vùng <span className="kbd">Z</span>
        </button>
        <button className={`btn tool-persp ${mode === "persp" ? "active" : ""}`} disabled={!videoSize.ready} onClick={() => setTool("persp")}>
          ◈ Phối cảnh (tốc độ) <span className="kbd">P</span>
        </button>
        {mode === "zone" && (
          <button className="btn" onClick={finishZone}>✓ Đóng vùng <span className="kbd">Enter</span></button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => resetAll(true)} disabled={!videoSize.ready}>↺ Reset số liệu</button>
        <button className="btn" onClick={exportReport} disabled={!videoSize.ready}>⬇ Báo cáo JSON</button>
      </footer>

      <SidePanel
        stats={stats}
        violations={violations}
        geom={geom}
        settings={settings}
        onSettings={setSettings}
        onClearLine={clearLine}
        onRemoveZone={removeZone}
        onClearPersp={clearPersp}
        sourceLabel={sourceLabel}
        videoSize={videoSize}
      />

      {showRtsp && <RtspGuide onClose={() => setShowRtsp(false)} onUse={(u) => { setStreamUrl(u); setShowRtsp(false); }} />}
    </div>
  );
}
