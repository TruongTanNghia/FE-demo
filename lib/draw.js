// Ve overlay len canvas (tuong duong cac Annotator cua supervision - Bai 2).

const PALETTE = [
  "#ffb020", "#37d67a", "#2fb7ff", "#ff5e5e", "#c084fc", "#f472b6", "#fbbf24", "#34d399",
  "#60a5fa", "#fb923c", "#a3e635", "#22d3ee", "#e879f9", "#f87171", "#facc15", "#4ade80",
];
export const ZONE_COLORS = ["#ff5e5e", "#2fb7ff", "#37d67a", "#c084fc", "#fbbf24", "#f472b6"];

export const trackColor = (id) => PALETTE[id % PALETTE.length];

/** Do day net / co chu theo do phan giai (calculate_optimal_line_thickness / text_scale). */
export function scaleFor(w, h) {
  const k = Math.max(w, h) / 1280;
  return { line: Math.max(2, Math.round(2 * k)), font: Math.max(14, Math.round(15 * k)), k };
}

export function drawTraces(ctx, traces, activeIds, s) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [id, pts] of traces) {
    if (!activeIds.has(id) || pts.length < 2) continue;
    ctx.strokeStyle = trackColor(id);
    ctx.lineWidth = s.line;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

export function drawTracks(ctx, tracks, labels, s, violations) {
  ctx.font = `600 ${s.font}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "top";
  for (const t of tracks) {
    const [x1, y1, x2, y2] = t.xyxy;
    const isViol = violations.has(t.id);
    const color = isViol ? "#ff3b3b" : trackColor(t.id);
    ctx.strokeStyle = color;
    ctx.lineWidth = isViol ? s.line * 1.6 : s.line;
    // Box bo goc kieu "BoxCorner" + vien mong
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const L = Math.min(x2 - x1, y2 - y1) * 0.25;
    ctx.lineWidth = s.line * 2.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1 + L); ctx.lineTo(x1, y1); ctx.lineTo(x1 + L, y1);
    ctx.moveTo(x2 - L, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + L);
    ctx.moveTo(x2, y2 - L); ctx.lineTo(x2, y2); ctx.lineTo(x2 - L, y2);
    ctx.moveTo(x1 + L, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - L);
    ctx.stroke();

    const text = labels.get(t.id) || `#${t.id} ${t.name}`;
    const padX = s.font * 0.4;
    const tw = ctx.measureText(text).width + padX * 2;
    const th = s.font * 1.5;
    const ly = Math.max(0, y1 - th);
    ctx.fillStyle = color;
    ctx.fillRect(x1, ly, tw, th);
    ctx.fillStyle = "#0b0d10";
    ctx.fillText(text, x1 + padX, ly + s.font * 0.25);
  }
}

export function drawLine(ctx, line, inCount, outCount, s) {
  if (!line) return;
  const { start, end } = line;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = s.line * 1.5;
  ctx.setLineDash([s.font, s.font * 0.6]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [start, end]) {
    ctx.fillStyle = "#ffb020";
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.line * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Badge Vao/Ra o giua vach, moi ben mot nhan
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const nx = -(end.y - start.y);
  const ny = end.x - start.x;
  const nl = Math.hypot(nx, ny) || 1;
  const off = s.font * 2.2;
  badge(ctx, `RA ${outCount}`, mx - (nx / nl) * off, my - (ny / nl) * off, "#ff5e5e", s);
  badge(ctx, `VAO ${inCount}`, mx + (nx / nl) * off, my + (ny / nl) * off, "#37d67a", s);
  ctx.restore();
}

function badge(ctx, text, cx, cy, color, s) {
  ctx.font = `700 ${s.font * 1.2}px "Barlow Condensed", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + s.font;
  const h = s.font * 1.7;
  ctx.fillStyle = "rgba(11,13,16,0.85)";
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = s.line;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.textAlign = "left";
}

export function drawZones(ctx, zones, counts, alerts, s) {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const color = ZONE_COLORS[i % ZONE_COLORS.length];
    const hasAlert = alerts.some((a) => a.zone === z.id);
    ctx.save();
    ctx.beginPath();
    z.points.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = hexA(hasAlert ? "#ff3b3b" : color, hasAlert ? 0.35 : 0.18);
    ctx.fill();
    ctx.strokeStyle = hasAlert ? "#ff3b3b" : color;
    ctx.lineWidth = s.line * 1.3;
    ctx.stroke();
    const c = centroid(z.points);
    badge(ctx, `VUNG ${z.id}: ${counts[z.id] || 0}`, c.x, c.y, hasAlert ? "#ff3b3b" : color, s);
    ctx.restore();
  }
}

export function drawPerspective(ctx, persp, s) {
  if (!persp) return;
  ctx.save();
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = s.line;
  ctx.setLineDash([s.font * 0.5, s.font * 0.5]);
  ctx.beginPath();
  persp.src.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#c084fc";
  ctx.font = `600 ${s.font}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "bottom";
  ctx.fillText(`${persp.widthM}m x ${persp.lengthM}m`, persp.src[0].x, persp.src[0].y - s.font * 0.3);
  ctx.restore();
}

/** Ve hinh dang ve do (diem da click + duong noi toi chuot). */
export function drawDraft(ctx, mode, pts, cursor, s) {
  if (!pts.length && !cursor) return;
  const color = mode === "line" ? "#ffb020" : mode === "zone" ? "#2fb7ff" : "#c084fc";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s.line;
  ctx.setLineDash([s.font * 0.4, s.font * 0.4]);
  ctx.beginPath();
  pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (cursor && pts.length) ctx.lineTo(cursor.x, cursor.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.line * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (cursor) {
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(cursor.x - s.font, cursor.y); ctx.lineTo(cursor.x + s.font, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - s.font); ctx.lineTo(cursor.x, cursor.y + s.font);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawAlertBanner(ctx, text, w, s) {
  const h = s.font * 3;
  ctx.fillStyle = "rgba(255,59,59,0.85)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${s.font * 1.6}px "Barlow Condensed", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, w / 2, h / 2);
  ctx.textAlign = "left";
}

function centroid(pts) {
  const n = pts.length;
  return { x: pts.reduce((a, p) => a + p.x, 0) / n, y: pts.reduce((a, p) => a + p.y, 0) / n };
}

function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
