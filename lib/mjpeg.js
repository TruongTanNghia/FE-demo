// Doc MJPEG (multipart/x-mixed-replace) bang fetch() thay vi <img src>.
// Ly do: fetch gan duoc header (token, ngrok-skip-browser-warning) - <img> thi khong.

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
 * Ket noi MJPEG va cap nhat <img>. Tra ve ham stop().
 * onFrame(count) goi moi frame; onError(err) khi mat ket noi (tu reconnect sau 2s).
 */
export function startMjpeg(url, img, { headers = {}, onFrame, onError } = {}) {
  let stopped = false;
  let controller = null;
  let lastUrl = null;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      const parser = new MjpegParser();
      try {
        const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        let n = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          const frames = parser.feed(value);
          if (!frames.length) continue;
          const jpg = frames[frames.length - 1]; // chi hien frame moi nhat (bo frame ton dong)
          const next = URL.createObjectURL(new Blob([jpg], { type: "image/jpeg" }));
          img.src = next;
          if (lastUrl) URL.revokeObjectURL(lastUrl);
          lastUrl = next;
          onFrame?.(++n);
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
    if (lastUrl) URL.revokeObjectURL(lastUrl);
  };
}
