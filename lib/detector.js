// YOLOv8n chay trong trinh duyet bang ONNX Runtime Web (WebGPU -> fallback WASM).
// Tuong duong Bai 1 + Bai 3: model -> sv.Detections -> loc class/confidence.

export const VEHICLE_CLASSES = { 2: "car", 3: "motorcycle", 5: "bus", 7: "truck" };
const CLASS_IDS = Object.keys(VEHICLE_CLASSES).map(Number);

const INPUT = 640;
const NUM_ANCHORS = 8400; // 640x640 -> (80*80 + 40*40 + 20*20)

let ort = null;
let session = null;
let provider = "none";

const inputCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

export function getProvider() {
  return provider;
}

/** Tai model. onStatus(text) de hien tien trinh len UI. */
export async function loadDetector(onStatus = () => {}) {
  if (session) return session;
  onStatus("Dang nap ONNX Runtime...");
  ort = await import("onnxruntime-web/webgpu");
  ort.env.wasm.wasmPaths = "/ort/";
  // Da luong chi bat duoc khi trang cross-origin isolated (da set header trong next.config)
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 2)
    : 1;

  const modelUrl = "/models/yolov8n.onnx";
  const tryCreate = async (eps) =>
    ort.InferenceSession.create(modelUrl, {
      executionProviders: eps,
      graphOptimizationLevel: "all",
    });

  if (navigator.gpu) {
    try {
      onStatus("Dang khoi tao WebGPU...");
      session = await tryCreate(["webgpu"]);
      provider = "webgpu";
    } catch (e) {
      console.warn("WebGPU that bai, chuyen sang WASM:", e?.message);
    }
  }
  if (!session) {
    onStatus(`Dang khoi tao WASM (${ort.env.wasm.numThreads} luong)...`);
    session = await tryCreate(["wasm"]);
    provider = "wasm";
  }
  // Warm-up 1 lan de lan dau detect khong bi khung
  onStatus("Warm-up model...");
  const zeros = new ort.Tensor("float32", new Float32Array(3 * INPUT * INPUT), [1, 3, INPUT, INPUT]);
  await session.run({ [session.inputNames[0]]: zeros });
  onStatus(`San sang (${provider.toUpperCase()})`);
  return session;
}

/**
 * Chay detect tren 1 frame (video/canvas/image).
 * @returns {Array<{xyxy:number[], cls:number, name:string, conf:number}>}
 */
export async function detect(source, srcW, srcH, { conf = 0.3, iou = 0.45, classes = CLASS_IDS } = {}) {
  if (!session) throw new Error("Detector chua duoc nap");

  // --- Letterbox 640x640 (giu ti le, pad xam) ---
  const scale = Math.min(INPUT / srcW, INPUT / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padX = (INPUT - newW) / 2;
  const padY = (INPUT - newH) / 2;

  inputCanvas.width = INPUT;
  inputCanvas.height = INPUT;
  const ctx = inputCanvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#727272";
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(source, 0, 0, srcW, srcH, padX, padY, newW, newH);
  const { data } = ctx.getImageData(0, 0, INPUT, INPUT);

  // HWC uint8 -> CHW float32 [0,1]
  const area = INPUT * INPUT;
  const input = new Float32Array(3 * area);
  for (let i = 0, p = 0; i < area; i++, p += 4) {
    input[i] = data[p] / 255;
    input[i + area] = data[p + 1] / 255;
    input[i + 2 * area] = data[p + 2] / 255;
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT, INPUT]);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const o = out[session.outputNames[0]].data; // [1, 84, 8400] phang

  // --- Decode: chi xet cac class xe co ---
  const cands = [];
  for (let i = 0; i < NUM_ANCHORS; i++) {
    let best = 0;
    let bestCls = -1;
    for (const c of classes) {
      const s = o[(4 + c) * NUM_ANCHORS + i];
      if (s > best) {
        best = s;
        bestCls = c;
      }
    }
    if (best < conf) continue;
    const cx = o[i];
    const cy = o[NUM_ANCHORS + i];
    const w = o[2 * NUM_ANCHORS + i];
    const h = o[3 * NUM_ANCHORS + i];
    const x1 = Math.max(0, (cx - w / 2 - padX) / scale);
    const y1 = Math.max(0, (cy - h / 2 - padY) / scale);
    const x2 = Math.min(srcW, (cx + w / 2 - padX) / scale);
    const y2 = Math.min(srcH, (cy + h / 2 - padY) / scale);
    cands.push({ xyxy: [x1, y1, x2, y2], cls: bestCls, name: VEHICLE_CLASSES[bestCls], conf: best });
  }
  return nms(cands, iou);
}

function boxIou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

/** Non-Max Suppression theo tung class (nhu detections.with_nms). */
function nms(dets, thr) {
  dets.sort((a, b) => b.conf - a.conf);
  const keep = [];
  const removed = new Uint8Array(dets.length);
  for (let i = 0; i < dets.length; i++) {
    if (removed[i]) continue;
    keep.push(dets[i]);
    for (let j = i + 1; j < dets.length; j++) {
      if (removed[j] || dets[j].cls !== dets[i].cls) continue;
      if (boxIou(dets[i].xyxy, dets[j].xyxy) > thr) removed[j] = 1;
    }
  }
  return keep;
}
