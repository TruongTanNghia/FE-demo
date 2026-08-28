"use client";

import { ZONE_COLORS } from "@/lib/draw";

const CLASS_VI = { car: "Ô tô", motorcycle: "Xe máy", bus: "Xe buýt", truck: "Xe tải" };

export default function SidePanel({
  stats,
  violations,
  geom,
  settings,
  onSettings,
  onClearLine,
  onRemoveZone,
  onClearPersp,
  sourceLabel,
  videoSize,
  extra = null,
}) {
  const set = (k) => (e) => onSettings({ ...settings, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const byClass = stats?.byClass || {};
  const classRows = Object.keys(CLASS_VI).filter((c) => byClass[`${c}_in`] || byClass[`${c}_out`]);

  return (
    <aside className="side">
      {stats?.dwellAlerts?.length > 0 && <div className="alert-strip">⚠ Xe dừng quá lâu trong vùng</div>}

      <section className="sec">
        <h2>
          Đếm qua vạch
          {geom.hasLine && (
            <span className="mini" onClick={onClearLine}>xóa vạch</span>
          )}
        </h2>
        <div className="big-nums">
          <div className="bn" style={{ "--c": "var(--green)" }}>
            <small>Vào</small>
            <b>{stats?.inCount ?? 0}</b>
          </div>
          <div className="bn" style={{ "--c": "var(--red)" }}>
            <small>Ra</small>
            <b>{stats?.outCount ?? 0}</b>
          </div>
          <div className="bn" style={{ "--c": "var(--blue)" }}>
            <small>Đang theo dõi</small>
            <b>{stats?.active ?? 0}</b>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          {!geom.hasLine ? (
            <div className="empty">Chưa có vạch — bấm "Vẽ vạch đếm" rồi click 2 điểm trên khung hình.</div>
          ) : classRows.length === 0 ? (
            <div className="empty">Chưa có xe nào cắt vạch.</div>
          ) : (
            <div className="kv">
              {classRows.map((c) => (
                <FragmentRow key={c} label={CLASS_VI[c]} inN={byClass[`${c}_in`] || 0} outN={byClass[`${c}_out`] || 0} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="sec">
        <h2>Vùng giám sát</h2>
        {geom.zones.length === 0 ? (
          <div className="empty">Chưa có vùng — bấm "Vẽ vùng", click các đỉnh, Enter để đóng.</div>
        ) : (
          geom.zones.map((z, i) => (
            <div key={z.id} className="zone-row" style={{ "--c": ZONE_COLORS[i % ZONE_COLORS.length] }}>
              <i />
              <span>Vùng {z.id} · {z.n} đỉnh</span>
              <b>{stats?.zoneCounts?.[z.id] ?? 0} xe</b>
              <button title="Xóa vùng" onClick={() => onRemoveZone(z.id)}>✕</button>
            </div>
          ))
        )}
        <div className="field" style={{ marginTop: 8 }}>
          <span>Cảnh báo dừng quá (giây)</span>
          <input type="number" min="1" value={settings.dwellSeconds} onChange={set("dwellSeconds")} />
        </div>
      </section>

      <section className="sec">
        <h2>
          Tốc độ
          {geom.persp && (
            <span className="mini" onClick={onClearPersp}>xóa phối cảnh</span>
          )}
        </h2>
        {!geom.persp ? (
          <div className="empty">
            Chưa hiệu chỉnh — nhập kích thước thật của một đoạn đường rồi bấm "Phối cảnh", click 4 góc của đoạn đó trên khung hình.
          </div>
        ) : (
          <div className="empty" style={{ color: "var(--violet)", fontStyle: "normal" }}>
            ✓ Đã hiệu chỉnh vùng {geom.persp.w}m × {geom.persp.l}m
          </div>
        )}
        <div className="field" style={{ marginTop: 8 }}>
          <span>Bề rộng vùng (m)</span>
          <input type="number" min="1" value={settings.roadWidth} onChange={set("roadWidth")} />
        </div>
        <div className="field">
          <span>Chiều dài vùng (m)</span>
          <input type="number" min="1" value={settings.roadLength} onChange={set("roadLength")} />
        </div>
        <div className="field">
          <span>Giới hạn tốc độ (km/h)</span>
          <input type="number" min="1" value={settings.speedLimit} onChange={set("speedLimit")} />
        </div>
      </section>

      <section className="sec">
        <h2>
          Xe vi phạm tốc độ <span style={{ color: "var(--red)" }}>{violations.length}</span>
        </h2>
        {violations.length === 0 ? (
          <div className="empty">Chưa phát hiện vi phạm.</div>
        ) : (
          <div className="viol-list">
            {violations.map((v) => (
              <div key={v.id} className="viol">
                {v.snapshot ? (
                  <img src={v.snapshot} alt={`Xe #${v.id}`} />
                ) : (
                  <div className="noimg">không chụp được (video chặn CORS)</div>
                )}
                <div className="info">
                  <b>{v.speed} km/h</b>
                  <span>#{v.id} · {CLASS_VI[v.name] || v.name}</span>
                  <span>t = {v.time.toFixed(1)}s</span>
                  {v.snapshot && (
                    <a href={v.snapshot} download={`vi_pham_${v.id}_${v.speed}kmh.jpg`}>⬇ tải ảnh</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sec">
        <h2>Thiết lập</h2>
        <div className="field wide">
          <span>
            Ngưỡng confidence <span className="val">{Number(settings.conf).toFixed(2)}</span>
          </span>
          <input type="range" min="0.1" max="0.9" step="0.05" value={settings.conf} onChange={set("conf")} />
        </div>
        <div className="field wide">
          <span>
            Detect mỗi <span className="val">{settings.inferEvery}</span> frame (tăng nếu máy yếu)
          </span>
          <input type="range" min="1" max="4" step="1" value={settings.inferEvery} onChange={set("inferEvery")} />
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.showTraces} onChange={set("showTraces")} /> Vẽ vệt quỹ đạo
        </label>
        <div className="kv" style={{ marginTop: 8 }}>
          <span>Nguồn</span>
          <b style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sourceLabel || "—"}</b>
          <span>Độ phân giải</span>
          <b>{videoSize.ready ? `${videoSize.w}×${videoSize.h}` : "—"}</b>
        </div>
        {extra}
      </section>
    </aside>
  );
}

function FragmentRow({ label, inN, outN }) {
  return (
    <>
      <span>{label}</span>
      <b>
        <span className="in" style={{ color: "var(--green)" }}>▲{inN}</span>{" "}
        <span className="out" style={{ color: "var(--red)" }}>▼{outN}</span>
      </b>
    </>
  );
}
