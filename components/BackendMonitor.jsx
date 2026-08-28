"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawDraft, scaleFor } from "@/lib/draw";
import { startMjpeg } from "@/lib/mjpeg";
import SidePanel from "./SidePanel";
import BackendGuide from "./BackendGuide";

const DEFAULT_BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_BACKEND_TOKEN || "";
const KEY = "traffic-monitor-backend-url";
const KEY_TOKEN = "traffic-monitor-backend-token";
const STATS_INTERVAL_MS = 300;

const DEFAULT_SETTINGS = {
  conf: 0.3,
  speedLimit: 80,
  roadWidth: 25,
  roadLength: 250,
  dwellSeconds: 10,
  showTraces: true,
  inferEvery: 1,
};

/**
 * Che do Backend: Python (GPU) tren may ca nhan xu ly + ve; trinh duyet (Vercel) hien MJPEG
 * va ve vach/vung bang chuot. Moi request deu qua fetch() de gan duoc header
 * (token + ngrok-skip-browser-warning) -> chay tot qua ngrok / Cloudflare Tunnel / localhost.
 */
export default function BackendMonitor({ engineSwitch }) {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [showGuide, setShowGuide] = useState(false);
  const [status, setStatus] = useState(null); // tu /api/status
  const [online, setOnline] = useState(false);
  const [stats, setStats] = useState(null);
  const [violations, setViolations] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [geom, setGeom] = useState({ hasLine: false, zones: [], persp: null });
  const [mode, setMode] = useState("none");
  const [sourceInput, setSourceInput] = useState("");
  const [streamKey, setStreamKey] = useState(0);
  const [streamOk, setStreamOk] = useState(false);

  const canvasRef = useRef(null);
  const viewRef = useRef(null); // canvas hien luong MJPEG
  const draftRef = useRef([]);
  const cursorRef = useRef(null);
  const modeRef = useRef("none");
  const cfgRef = useRef({ line: null, zones: [], perspective: null });
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const debounceRef = useRef(0);
  const loadedCfg = useRef(false);
  const violCountRef = useRef(0);

  // Header dung chung cho moi request toi backend
  const headers = useCallback(
    () => ({
      "ngrok-skip-browser-warning": "1", // bo qua trang canh bao cua ngrok free
      ...(token ? { "X-Token": token } : {}),
    }),
    [token]
  );

  const api = useCallback(
    (path, body, method = body ? "POST" : "GET") =>
      fetch(`${backendUrl}${path}`, {
        method,
        headers: { ...headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    [backendUrl, headers]
  );

  // Dia chi backend: ?backend=&token= tren URL > localStorage > bien moi truong Vercel > localhost
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const qu = q.get("backend");
      const qt = q.get("token");
      const u = qu || localStorage.getItem(KEY);
      const t = qt ?? localStorage.getItem(KEY_TOKEN);
      if (u) setBackendUrl(u.replace(/\/$/, ""));
      if (t != null) setToken(t);
      if (qu) localStorage.setItem(KEY, qu);
      if (qt != null) localStorage.setItem(KEY_TOKEN, qt);
    } catch {}
  }, []);

  // ---------- Poll /api/status (2s) + /api/stats (300ms) ----------
  useEffect(() => {
    let alive = true;
    let tStatus, tStats;

    const pollStatus = async () => {
      try {
        const s = await api("/api/status");
        if (!alive) return;
        setStatus(s);
        setOnline(true);
        if (!loadedCfg.current && s.config) {
          loadedCfg.current = true;
          cfgRef.current = { line: s.config.line, zones: s.config.zones || [], perspective: s.config.perspective };
          setSettings((p) => ({
            ...p,
            conf: s.config.conf,
            speedLimit: s.config.speed_limit,
            dwellSeconds: s.config.dwell_seconds,
            showTraces: s.config.show_traces,
            roadWidth: s.config.perspective?.widthM ?? p.roadWidth,
            roadLength: s.config.perspective?.lengthM ?? p.roadLength,
          }));
          syncGeom();
        }
      } catch {
        if (alive) {
          setOnline(false);
          loadedCfg.current = false;
        }
      }
      if (alive) tStatus = setTimeout(pollStatus, 2000);
    };

    const pollStats = async () => {
      try {
        const m = await api("/api/stats");
        if (!alive) return;
        setStats(m);
        if (m.violationCount !== violCountRef.current) {
          violCountRef.current = m.violationCount;
          const list = await api("/api/violations");
          if (alive) setViolations([...list].reverse());
        }
      } catch {}
      if (alive) tStats = setTimeout(pollStats, STATS_INTERVAL_MS);
    };

    pollStatus();
    pollStats();
    return () => {
      alive = false;
      clearTimeout(tStatus);
      clearTimeout(tStats);
    };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- MJPEG qua fetch stream ----------
  const ready = online && status?.running && status.width > 0;
  useEffect(() => {
    if (!ready || !viewRef.current) return;
    setStreamOk(false);
    const stop = startMjpeg(`${backendUrl}/stream.mjpg?k=${streamKey}`, viewRef.current, {
      headers: headers(),
      onFrame: (n) => n === 1 && setStreamOk(true),
      onError: () => setStreamOk(false),
    });
    return stop;
  }, [ready, backendUrl, streamKey, headers]);

  // ---------- Canvas overlay: chi ve nhap (backend da ve moi thu len frame) ----------
  useEffect(() => {
    const c = canvasRef.current;
    if (c && status?.width) {
      c.width = status.width;
      c.height = status.height;
    }
  }, [status?.width, status?.height]);

  const drawOverlay = () => {
    const c = canvasRef.current;
    if (!c || !c.width) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const s = scaleFor(c.width, c.height);
    drawDraft(ctx, modeRef.current, draftRef.current, modeRef.current !== "none" ? cursorRef.current : null, s);
  };

  const toCanvas = (e) => {
    const c = canvasRef.current;
    // object-fit: contain -> tru phan letterbox truoc khi quy ve toa do frame
    const r = c.getBoundingClientRect();
    const s = Math.min(r.width / c.width, r.height / c.height);
    const ox = (r.width - c.width * s) / 2;
    const oy = (r.height - c.height * s) / 2;
    return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
  };

  const pushConfig = (partial) => api("/api/config", partial).catch(() => {});

  const syncGeom = () => {
    const g = cfgRef.current;
    setGeom({
      hasLine: !!g.line,
      zones: (g.zones || []).map((z) => ({ id: z.id, n: z.points.length })),
      persp: g.perspective ? { w: g.perspective.widthM, l: g.perspective.lengthM } : null,
    });
  };

  const setTool = (m) => {
    const next = modeRef.current === m ? "none" : m;
    modeRef.current = next;
    draftRef.current = [];
    setMode(next);
    drawOverlay();
  };

  const finishTool = () => {
    draftRef.current = [];
    modeRef.current = "none";
    setMode("none");
    syncGeom();
  };

  const onCanvasClick = (e) => {
    const md = modeRef.current;
    if (md === "none") return;
    const d = draftRef.current;
    d.push(toCanvas(e));
    const g = cfgRef.current;
    if (md === "line" && d.length === 2) {
      g.line = { start: d[0], end: d[1] };
      pushConfig({ line: g.line });
      finishTool();
    } else if (md === "persp" && d.length === 4) {
      const s = settingsRef.current;
      g.perspective = { src: d.slice(), widthM: Number(s.roadWidth), lengthM: Number(s.roadLength) };
      pushConfig({ perspective: g.perspective });
      finishTool();
    }
    drawOverlay();
  };

  const finishZone = () => {
    const d = draftRef.current;
    if (modeRef.current === "zone" && d.length >= 3) {
      const g = cfgRef.current;
      const id = (g.zones.at(-1)?.id ?? 0) + 1;
      g.zones = [...g.zones, { id, points: d.slice() }];
      pushConfig({ zones: g.zones });
      finishTool();
      drawOverlay();
    }
  };

  const onCanvasMove = (e) => {
    cursorRef.current = toCanvas(e);
    if (modeRef.current !== "none") drawOverlay();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "Enter") finishZone();
      if (e.key === "Escape") setTool("none");
      if (e.key.toLowerCase() === "l") setTool("line");
      if (e.key.toLowerCase() === "z") setTool("zone");
      if (e.key.toLowerCase() === "p") setTool("persp");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- Settings -> backend (debounce) ----------
  useEffect(() => {
    settingsRef.current = settings;
    if (!loadedCfg.current) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const g = cfgRef.current;
      const body = {
        conf: Number(settings.conf),
        speed_limit: Number(settings.speedLimit),
        dwell_seconds: Number(settings.dwellSeconds),
        show_traces: !!settings.showTraces,
      };
      if (g.perspective) {
        g.perspective = { ...g.perspective, widthM: Number(settings.roadWidth), lengthM: Number(settings.roadLength) };
        body.perspective = g.perspective;
        syncGeom();
      }
      pushConfig(body);
    }, 300);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Nguon ----------
  const setSource = async (src) => {
    setViolations([]);
    violCountRef.current = 0;
    await api("/api/source", { source: src }).catch(() => {});
    setStreamKey((k) => k + 1);
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setViolations([]);
    violCountRef.current = 0;
    await fetch(`${backendUrl}/api/upload`, { method: "POST", body: fd, headers: headers() }).catch(() => {});
    setStreamKey((k) => k + 1);
    e.target.value = "";
  };

  const clearLine = () => {
    cfgRef.current.line = null;
    pushConfig({ line: null });
    syncGeom();
  };
  const removeZone = (id) => {
    cfgRef.current.zones = cfgRef.current.zones.filter((z) => z.id !== id);
    pushConfig({ zones: cfgRef.current.zones });
    syncGeom();
  };
  const clearPersp = () => {
    cfgRef.current.perspective = null;
    pushConfig({ perspective: null });
    syncGeom();
  };
  const resetStats = () => {
    setViolations([]);
    violCountRef.current = 0;
    api("/api/reset", {}).catch(() => {});
  };
  const exportReport = async () => {
    const rep = await api("/api/report");
    const blob = new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_${Date.now()}.json`;
    a.click();
  };

  const saveConnection = (u, t) => {
    loadedCfg.current = false;
    setBackendUrl(u || DEFAULT_BACKEND);
    setToken(t);
    setShowGuide(false);
    try {
      localStorage.setItem(KEY, u || DEFAULT_BACKEND);
      localStorage.setItem(KEY_TOKEN, t);
    } catch {}
  };

  const hint = {
    line: "VẠCH ĐẾM: click 2 điểm trên khung hình · Esc hủy",
    zone: "VÙNG POLYGON: click các đỉnh · Enter để đóng vùng · Esc hủy",
    persp: `PHỐI CẢNH: click 4 góc vùng mặt đường (${settings.roadWidth}m × ${settings.roadLength}m) · Esc hủy`,
  }[mode];
  const statusKind = !online ? "error" : status?.error ? "error" : ready ? "ready" : "loading";
  const statusText = !online
    ? `Không kết nối được ${backendUrl.replace(/^https?:\/\//, "")} — bấm 🔗 Backend`
    : status?.error
    ? status.error
    : ready
    ? `Backend · ${status.device}`
    : `Backend online · ${status?.device} · chưa có nguồn`;

  return (
    <div className="app">
      <header className="head">
        <div className="brand">
          <h1>
            Traffic<span>·Monitor</span>
          </h1>
          <small>Bài 9 · Backend GPU local</small>
        </div>
        {engineSwitch}
        <label className="btn file-btn">
          📂 Mở video
          <input type="file" accept="video/*" onChange={onFile} />
        </label>
        <button className="btn" onClick={() => setSource("sample")}>🛣 Video mẫu</button>
        <button className="btn" onClick={() => setSource("0")}>📷 Webcam</button>
        <div className="url-row">
          <input
            placeholder="rtsp://user:pass@ip:554/... · đường dẫn file · http stream"
            value={sourceInput}
            onChange={(e) => setSourceInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sourceInput.trim() && setSource(sourceInput.trim())}
          />
          <button className="btn" onClick={() => sourceInput.trim() && setSource(sourceInput.trim())}>▶ Kết nối</button>
        </div>
        <button className={`btn ${online ? "" : "danger"}`} onClick={() => setShowGuide(true)} title="Địa chỉ backend, token, hướng dẫn kết nối Vercel ↔ máy cá nhân">
          🔗 Backend
        </button>
        <span className={`status ${statusKind}`}>
          <i /> {statusText}
        </span>
      </header>

      {showGuide && (
        <BackendGuide url={backendUrl} token={token} online={online} status={status} onSave={saveConnection} onClose={() => setShowGuide(false)} />
      )}

      <main className="stage">
        <div className="stage-inner">
          <canvas ref={viewRef} className="view" style={{ display: ready ? "block" : "none" }} />
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
          {!ready && (
            <div className="stage-empty">
              <div>
                <b>{online ? "Chưa có nguồn video" : "Backend chưa kết nối"}</b>
                {online ? (
                  "Mở file, video mẫu, webcam hoặc dán link RTSP ở thanh trên"
                ) : (
                  <>
                    Chạy <code style={{ color: "var(--amber)" }}>webapp\backend\run_backend.bat</code> trên máy anh, rồi bấm 🔗 Backend
                  </>
                )}
              </div>
            </div>
          )}
          {ready && !streamOk && <div className="hint" style={{ left: "auto", right: 12, bottom: 12 }}>Đang chờ luồng hình…</div>}
          {hint && <div className="hint">{hint}</div>}
          {ready && stats && (
            <div className="fps">
              {stats.fps} fps · {stats.infer_ms} ms · {status.width}×{status.height}
              {status.live ? " · LIVE" : ""}
            </div>
          )}
        </div>
      </main>

      <footer className="tools">
        <button className={`btn tool-line ${mode === "line" ? "active" : ""}`} disabled={!ready} onClick={() => setTool("line")}>
          ━ Vẽ vạch đếm <span className="kbd">L</span>
        </button>
        <button className={`btn tool-zone ${mode === "zone" ? "active" : ""}`} disabled={!ready} onClick={() => setTool("zone")}>
          ⬠ Vẽ vùng <span className="kbd">Z</span>
        </button>
        <button className={`btn tool-persp ${mode === "persp" ? "active" : ""}`} disabled={!ready} onClick={() => setTool("persp")}>
          ◈ Phối cảnh (tốc độ) <span className="kbd">P</span>
        </button>
        {mode === "zone" && (
          <button className="btn" onClick={finishZone}>✓ Đóng vùng <span className="kbd">Enter</span></button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={resetStats} disabled={!ready}>↺ Reset số liệu</button>
        <button className="btn" onClick={exportReport} disabled={!ready}>⬇ Báo cáo JSON</button>
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
        sourceLabel={status?.source || ""}
        videoSize={{ w: status?.width || 0, h: status?.height || 0, ready: !!ready }}
        extra={
          <div className="kv" style={{ marginTop: 6 }}>
            <span>Backend</span>
            <b style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{backendUrl.replace(/^https?:\/\//, "")}</b>
          </div>
        }
      />
    </div>
  );
}
