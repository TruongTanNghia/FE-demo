// Hinh hoc dung chung: IoU, phia cua diem so voi vach, diem trong polygon,
// perspective transform (Bai 8 - ViewTransformer) giai bang Gauss 8x8.

export function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

/** Anchor BOTTOM_CENTER — diem "cham dat" cua xe. */
export function bottomCenter(xyxy) {
  return { x: (xyxy[0] + xyxy[2]) / 2, y: xyxy[3] };
}

/** >0 / <0 tuy diem nam ben nao cua vach start->end; 0 = tren vach. */
export function sideOfLine(start, end, p) {
  return Math.sign((end.x - start.x) * (p.y - start.y) - (end.y - start.y) * (p.x - start.x));
}

/** Ray casting. poly = [{x,y}, ...] */
export function pointInPolygon(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tinh ma tran homography 3x3 anh xa 4 diem src -> 4 diem dst
 * (tuong duong cv2.getPerspectiveTransform).
 */
export function getPerspectiveTransform(src, dst) {
  // He 8 phuong trinh: [x y 1 0 0 0 -x*u -y*u] h = u ; [0 0 0 x y 1 -x*v -y*v] h = v
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyPerspective(M, p) {
  const w = M[6] * p.x + M[7] * p.y + M[8];
  return {
    x: (M[0] * p.x + M[1] * p.y + M[2]) / w,
    y: (M[3] * p.x + M[4] * p.y + M[5]) / w,
  };
}

/** Giai Ax=b bang khu Gauss co chon tru (pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const pv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / pv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Sap xep 4 diem nguoi dung click thanh [trai-tren, phai-tren, phai-duoi, trai-duoi]. */
export function orderQuad(pts) {
  const s = [...pts].sort((a, b) => a.y - b.y);
  const top = s.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = s.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}
