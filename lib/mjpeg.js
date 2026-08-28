// Doc MJPEG (multipart/x-mixed-replace) bang fetch() thay vi <img src>.
// Ly do: fetch gan duoc header (token, ngrok-skip-browser-warning) - <img> thi khong.
// Hien thi: giai ma bang createImageBitmap roi ve len <canvas>. Khong dung img.src=blob
// vi gan src lien tuc se huy giai ma frame truoc -> may cham khong hien duoc frame nao (man hinh den).

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** Bo tach frame JPEG tu luong byte bat ky (khong phu thuoc boundary). */
export class MjpegParser {
  constructor() {
    this.buf = new Uint8Array(0);
  }

  /** @returns {Uint8Array[]} cac JPEG hoan chinh vua nhan duoc */
  feed(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const frames = [];
    let pos = 0;
    for (;;) {
      const start = indexOf(this.buf, SOI, pos);
      if (start < 0) {
        this.buf = new Uint8Array(0);
        break;
      }
      const end = indexOf(this.buf, EOI, start + 2);
      if (end < 0) {
        this.buf = this.buf.slice(start);
        break;
      }
      frames.push(this.buf.slice(start, end + 2));
      pos = end + 2;
    }
    return frames;
  }
}

function indexOf(arr, pat, from) {
  for (let i = from; i < arr.length - 1; i++) {
    if (arr[i] === pat[0] && arr[i + 1] === pat[1]) return i;
  }
  return -1;
}

/**
 * Ket noi MJPEG va ve len <canvas>. Tra ve ham stop().
 * onFrame(count) goi moi frame da ve; onError(err) khi mat ket noi (tu reconnect sau 2s).
 */
export function startMjpeg(url, canvas, { headers = {}, onFrame, onError } = {}) {
  let stopped = false;
  let controller = null;
  let decoding = false;
  let pending = null; // frame moi nhat cho decode (chi giu 1)
  const ctx = canvas.getContext("2d");
  let count = 0;

  const draw = async (jpg) => {
    if (decoding) {
      pending = jpg; // dang ban -> giu lai frame moi nhat, bo frame cu
      return;
    }
    decoding = true;
    try {
      const blob = new Blob([jpg], { type: "image/jpeg" });
      let bmp;
      if (typeof createImageBitmap === "function") {
        bmp = await createImageBitmap(blob);
      } else {
        bmp = await loadImage(blob);
      }
      if (stopped) return;
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      onFrame?.(++count);
    } catch (e) {
      console.warn("MJPEG decode:", e?.message);
    } finally {
      decoding = false;
      if (pending && !stopped) {
        const p = pending;
        pending = null;
        draw(p);
      }
    }
  };

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      const parser = new MjpegParser();
      try {
        const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          const frames = parser.feed(value);
          if (frames.length) draw(frames[frames.length - 1]);
        }
      } catch (e) {
        if (!stopped) onError?.(e);
      }
      if (!stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  };
  run();

  return () => {
    stopped = true;
    controller?.abort();
  };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
