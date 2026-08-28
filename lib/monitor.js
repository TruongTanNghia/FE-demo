// Bo may giam sat (Bai 9 - class TrafficMonitor): dem qua vach, vung polygon,
// do toc do, canh bao + chup hinh xe qua toc do. Khong phu thuoc React.

import { applyPerspective, bottomCenter, getPerspectiveTransform, orderQuad, pointInPolygon, sideOfLine } from "./geometry";

const SPEED_WINDOW_S = 1.0; // trung binh toc do tren 1 giay (khu jitter)
const SPEED_MIN_SPAN_S = 0.4;
const CROSSING_CONFIRM = 2; // minimum_crossing_threshold: can 2 frame xac nhan

export class TrafficMonitor {
  constructor() {
    this.line = null; // {start:{x,y}, end:{x,y}}
    this.zones = []; // [{id, points:[{x,y}], color}]
    this.perspective = null; // {src:[4 pts], widthM, lengthM, M}
    this.speedLimit = 80;
    this.dwellSeconds = 10;
    this.resetStats();
  }

  resetStats() {
    this.inCount = 0;
    this.outCount = 0;
    this.byClass = {}; // "car_in": n
    this.lineState = new Map(); // tid -> {side, pendingSide, pendingCount}
    this.speedHist = new Map(); // tid -> [{x,y,t}]
    this.speeds = new Map(); // tid -> km/h (EMA)
    this.traces = new Map(); // tid -> [{x,y,t}] pixel (ve quy dao)
    this.zoneEnter = new Map(); // `${zone}:${tid}` -> t vao vung
    this.zoneCounts = {}; // zoneId -> so xe hien tai
    this.dwellAlerts = []; // [{zone, tid}] frame hien tai
    this.violations = new Map(); // tid -> {id, name, speed, time, snapshot}
    this.frameCount = 0;
    this.lastSeen = new Map(); // tid -> t
  }

  // ---------- Cau hinh hinh hoc ----------
  setLine(start, end) {
    this.line = start && end ? { start, end } : null;
    this.lineState.clear();
  }

  addZone(points) {
    const id = (this.zones.at(-1)?.id ?? 0) + 1;
    this.zones.push({ id, points });
    return id;
  }

  removeZone(id) {
    this.zones = this.zones.filter((z) => z.id !== id);
  }

  setPerspective(points4, widthM, lengthM) {
    if (!points4 || points4.length !== 4) {
      this.perspective = null;
      return;
    }
    const src = orderQuad(points4);
    const dst = [
      { x: 0, y: 0 },
      { x: widthM, y: 0 },
      { x: widthM, y: lengthM },
      { x: 0, y: lengthM },
    ];
    this.perspective = { src, widthM, lengthM, M: getPerspectiveTransform(src, dst) };
    this.speedHist.clear();
    this.speeds.clear();
  }

  // ---------- Xu ly moi frame ----------
  /**
   * @param tracks  tu ByteTracker.update
   * @param t       thoi gian (giay) cua frame
   * @param frame   canvas/video de crop anh vi pham
   * @returns {labels: Map<tid,string>, newViolations: []}
   */
  process(tracks, t, frame) {
    this.frameCount++;
    const labels = new Map();
    const newViolations = [];
    const activeIds = new Set();

    // --- Dem qua vach + chi tiet theo loai (Bai 6) ---
    for (const tr of tracks) {
      activeIds.add(tr.id);
      this.lastSeen.set(tr.id, t);
      const p = bottomCenter(tr.xyxy);

      // quy dao
      const tail = this.traces.get(tr.id) || [];
      tail.push({ x: p.x, y: p.y, t });
      while (tail.length && t - tail[0].t > 2) tail.shift(); // giu vet 2 giay
      this.traces.set(tr.id, tail);

      if (this.line) this._updateLine(tr, p);

      // --- Toc do (Bai 8) ---
      let speedText = "";
      if (this.perspective) {
        const spd = this._updateSpeed(tr.id, p, t);
        if (spd != null) {
          speedText = ` ${Math.round(spd)} km/h`;
          if (spd > this.speedLimit) {
            speedText += " !!";
            const v = this.violations.get(tr.id);
            if (!v) {
              const snapshot = frame ? cropSnapshot(frame, tr.xyxy) : null;
              const rec = { id: tr.id, name: tr.name, speed: Math.round(spd), time: t, snapshot };
              this.violations.set(tr.id, rec);
              newViolations.push(rec);
            } else if (spd > v.speed) {
              v.speed = Math.round(spd);
            }
          }
        }
      }
      labels.set(tr.id, `#${tr.id} ${tr.name}${speedText}`);
    }

    // --- Vung polygon (Bai 7): dem hien tai + dwell time ---
    this.dwellAlerts = [];
    for (const z of this.zones) {
      let n = 0;
      for (const tr of tracks) {
        const inside = pointInPolygon(z.points, bottomCenter(tr.xyxy));
        const key = `${z.id}:${tr.id}`;
        if (inside) {
          n++;
          if (!this.zoneEnter.has(key)) this.zoneEnter.set(key, t);
          else if (t - this.zoneEnter.get(key) > this.dwellSeconds) this.dwellAlerts.push({ zone: z.id, tid: tr.id });
        } else {
          this.zoneEnter.delete(key);
        }
      }
      this.zoneCounts[z.id] = n;
    }

    // Don rac: track bien mat > 3s
    if (this.frameCount % 60 === 0) {
      for (const [id, last] of this.lastSeen) {
        if (t - last > 3) {
          this.lastSeen.delete(id);
          this.traces.delete(id);
          this.speedHist.delete(id);
          this.speeds.delete(id);
          this.lineState.delete(id);
        }
      }
    }

    return { labels, newViolations };
  }

  _updateLine(tr, p) {
    const side = sideOfLine(this.line.start, this.line.end, p);
    if (side === 0) return;
    let st = this.lineState.get(tr.id);
    if (!st) {
      this.lineState.set(tr.id, { side, pendingSide: side, pendingCount: 0 });
      return;
    }
    if (side === st.side) {
      st.pendingSide = side;
      st.pendingCount = 0;
      return;
    }
    if (side === st.pendingSide) st.pendingCount++;
    else {
      st.pendingSide = side;
      st.pendingCount = 1;
    }
    if (st.pendingCount >= CROSSING_CONFIRM) {
      const dir = st.side < 0 && side > 0 ? "in" : "out";
      if (dir === "in") this.inCount++;
      else this.outCount++;
      const k = `${tr.name}_${dir}`;
      this.byClass[k] = (this.byClass[k] || 0) + 1;
      st.side = side;
      st.pendingCount = 0;
    }
  }

  _updateSpeed(tid, p, t) {
    const m = applyPerspective(this.perspective.M, p);
    const h = this.speedHist.get(tid) || [];
    h.push({ x: m.x, y: m.y, t });
    while (h.length && t - h[0].t > SPEED_WINDOW_S) h.shift();
    this.speedHist.set(tid, h);
    const span = t - h[0].t;
    if (span < SPEED_MIN_SPAN_S) return this.speeds.get(tid) ?? null;
    const dist = Math.hypot(h.at(-1).x - h[0].x, h.at(-1).y - h[0].y);
    const raw = (dist / span) * 3.6;
    const prev = this.speeds.get(tid);
    const smooth = prev == null ? raw : 0.7 * prev + 0.3 * raw;
    this.speeds.set(tid, smooth);
    return smooth;
  }

  report(sourceName) {
    return {
      source: sourceName,
      generated_at: new Date().toISOString(),
      total_in: this.inCount,
      total_out: this.outCount,
      by_class: { ...this.byClass },
      speed_limit_kmh: this.speedLimit,
      speed_violations: [...this.violations.values()].map(({ snapshot, ...v }) => v),
      zones: this.zones.map((z) => ({ id: z.id, current: this.zoneCounts[z.id] || 0 })),
    };
  }
}

/** Crop box xe (co le) tu frame -> dataURL JPEG. */
function cropSnapshot(frame, xyxy) {
  try {
    const pad = 0.15;
    const fw = frame.videoWidth || frame.width;
    const fh = frame.videoHeight || frame.height;
    const w = xyxy[2] - xyxy[0];
    const h = xyxy[3] - xyxy[1];
    const x = Math.max(0, xyxy[0] - w * pad);
    const y = Math.max(0, xyxy[1] - h * pad);
    const cw = Math.min(fw - x, w * (1 + 2 * pad));
    const ch = Math.min(fh - y, h * (1 + 2 * pad));
    const c = document.createElement("canvas");
    const scale = Math.min(1, 480 / cw);
    c.width = Math.round(cw * scale);
    c.height = Math.round(ch * scale);
    c.getContext("2d").drawImage(frame, x, y, cw, ch, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch (e) {
    console.warn("Khong chup duoc anh (canvas bi tainted do CORS?):", e?.message);
    return null;
  }
}
