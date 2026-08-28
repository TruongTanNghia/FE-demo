// ByteTrack-lite (Bai 5): khop track bang IoU qua 2 vong (conf cao -> conf thap),
// giu track mat dau trong lostBuffer frame, lam muot box (DetectionsSmoother).

import { iou } from "./geometry";

export class ByteTracker {
  constructor({
    highThresh = 0.5, // vong 1: detection conf cao
    lowThresh = 0.1, // vong 2: tan dung ca detection conf thap (xe bi che)
    activationThresh = 0.25, // conf toi thieu de khoi tao track moi
    matchIou = 0.2, // IoU toi thieu de coi la cung 1 xe
    matchDist = 1.2, // fallback: khoang cach tam / kich thuoc box (chiu duoc fps thap - xe nhay xa giua 2 frame)
    lostBuffer = 30, // giu track "mat dau" trong N frame
    minHits = 1, // hien ngay tu lan khop dau (fps thap thi doi 2 frame la mat xe)
    smoothing = 0.6, // he so lam muot box (0 = khong muot)
  } = {}) {
    Object.assign(this, { highThresh, lowThresh, activationThresh, matchIou, matchDist, lostBuffer, minHits, smoothing });
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
    this.frame = 0;
  }

  /**
   * @param dets [{xyxy, cls, name, conf}]
   * @returns tracks dang active [{id, xyxy, cls, name, conf, hits}]
   */
  update(dets) {
    this.frame++;
    // Du doan vi tri moi theo van toc (Kalman "nghèo")
    for (const t of this.tracks) {
      t.pred = [t.xyxy[0] + t.vx, t.xyxy[1] + t.vy, t.xyxy[2] + t.vx, t.xyxy[3] + t.vy];
    }

    const high = dets.filter((d) => d.conf >= this.highThresh);
    const low = dets.filter((d) => d.conf < this.highThresh && d.conf >= this.lowThresh);

    let unmatchedTracks = [...this.tracks];
    const matched = [];

    // Vong 1: tat ca track vs detection conf cao
    let r = greedyMatch(unmatchedTracks, high, this.matchIou, this.matchDist);
    matched.push(...r.pairs);
    unmatchedTracks = r.tracks;
    const unmatchedHigh = r.dets;

    // Vong 2: track con lai vs detection conf thap (xe dang bi che khuat)
    r = greedyMatch(unmatchedTracks, low, this.matchIou, this.matchDist);
    matched.push(...r.pairs);
    unmatchedTracks = r.tracks;

    for (const [t, d] of matched) this._assign(t, d);

    for (const t of unmatchedTracks) {
      t.lost++;
      // Track mat dau van "troi" theo van toc de bat lai sau khi bi che
      t.xyxy = t.pred;
    }
    this.tracks = this.tracks.filter((t) => t.lost <= this.lostBuffer);

    for (const d of unmatchedHigh) {
      if (d.conf < this.activationThresh) continue;
      this.tracks.push({
        id: this.nextId++,
        xyxy: d.xyxy.slice(),
        cls: d.cls,
        name: d.name,
        conf: d.conf,
        hits: 1,
        lost: 0,
        vx: 0,
        vy: 0,
      });
    }

    return this.tracks.filter((t) => t.lost === 0 && t.hits >= this.minHits);
  }

  _assign(t, d) {
    const cx0 = (t.xyxy[0] + t.xyxy[2]) / 2;
    const cy0 = (t.xyxy[1] + t.xyxy[3]) / 2;
    const cx1 = (d.xyxy[0] + d.xyxy[2]) / 2;
    const cy1 = (d.xyxy[1] + d.xyxy[3]) / 2;
    t.vx = 0.7 * t.vx + 0.3 * (cx1 - cx0);
    t.vy = 0.7 * t.vy + 0.3 * (cy1 - cy0);
    const a = t.lost > 0 ? 1 : this.smoothing; // vua bat lai thi nhay thang toi vi tri moi
    t.xyxy = t.xyxy.map((v, i) => v + a * (d.xyxy[i] - v));
    t.conf = d.conf;
    // Class co the nhap nhay (car <-> truck): giu class cua detection conf cao nhat gan day
    if (d.conf >= t.conf - 0.05) {
      t.cls = d.cls;
      t.name = d.name;
    }
    t.hits++;
    t.lost = 0;
  }
}

/**
 * Khop tham lam: uu tien IoU; neu IoU = 0 (fps thap, xe nhay xa) thi dung
 * khoang cach tam chuan hoa theo kich thuoc box, cung class.
 */
function greedyMatch(tracks, dets, thr, distThr) {
  const cands = [];
  for (let i = 0; i < tracks.length; i++) {
    const tb = tracks[i].pred || tracks[i].xyxy;
    const tw = tb[2] - tb[0], th = tb[3] - tb[1];
    for (let j = 0; j < dets.length; j++) {
      const db = dets[j].xyxy;
      const v = iou(tb, db);
      if (v >= thr) {
        cands.push([1 + v, i, j]); // IoU luon thang diem khoang cach
        continue;
      }
      if (tracks[i].cls !== dets[j].cls) continue;
      const dx = (tb[0] + tb[2] - db[0] - db[2]) / 2;
      const dy = (tb[1] + tb[3] - db[1] - db[3]) / 2;
      const d = Math.hypot(dx / Math.max(tw, 1), dy / Math.max(th, 1));
      const sizeRatio = Math.max((db[2] - db[0]) / Math.max(tw, 1), tw / Math.max(db[2] - db[0], 1));
      if (d <= distThr && sizeRatio < 2) cands.push([1 - d / distThr, i, j]);
    }
  }
  cands.sort((a, b) => b[0] - a[0]);
  const usedT = new Set();
  const usedD = new Set();
  const pairs = [];
  for (const [, i, j] of cands) {
    if (usedT.has(i) || usedD.has(j)) continue;
    usedT.add(i);
    usedD.add(j);
    pairs.push([tracks[i], dets[j]]);
  }
  return {
    pairs,
    tracks: tracks.filter((_, i) => !usedT.has(i)),
    dets: dets.filter((_, j) => !usedD.has(j)),
  };
}
