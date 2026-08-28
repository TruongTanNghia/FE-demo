"use client";

import { useEffect, useState } from "react";
import TrafficMonitor from "./TrafficMonitor";
import BackendMonitor from "./BackendMonitor";

const KEY = "traffic-monitor-engine";

/** Chon engine: 'browser' (ONNX trong trinh duyet, deploy Vercel) hoac 'backend' (Python GPU local). */
export default function App() {
  const [engine, setEngine] = useState("browser");

  useEffect(() => {
    try {
      // ?engine=backend tren URL (link chia se) > localStorage
      const q = new URLSearchParams(window.location.search).get("engine");
      const e = q === "backend" || q === "browser" ? q : localStorage.getItem(KEY);
      if (e === "backend" || e === "browser") setEngine(e);
      if (q) localStorage.setItem(KEY, q);
    } catch {}
  }, []);

  const pick = (e) => {
    setEngine(e);
    try {
      localStorage.setItem(KEY, e);
    } catch {}
  };

  const engineSwitch = (
    <div style={{ display: "inline-flex", border: "1px solid var(--line-2)", borderRadius: 6, overflow: "hidden" }}>
      <button className={`btn ${engine === "browser" ? "active" : ""}`} style={{ border: 0, borderRadius: 0 }} onClick={() => pick("browser")} title="Chạy YOLO ngay trong trình duyệt (WebGPU/WASM) — deploy Vercel">
        🌐 Trình duyệt
      </button>
      <button className={`btn ${engine === "backend" ? "active" : ""}`} style={{ border: 0, borderRadius: 0 }} onClick={() => pick("backend")} title="Python + GPU chạy trên máy anh, đọc RTSP trực tiếp">
        ⚡ Backend GPU
      </button>
    </div>
  );

  return engine === "backend" ? <BackendMonitor engineSwitch={engineSwitch} /> : <TrafficMonitor engineSwitch={engineSwitch} />;
}
