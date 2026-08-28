// Copy cac file WASM/JS runtime cua onnxruntime-web vao public/ort
// de trinh duyet tai duoc tu chinh domain (khong phu thuoc CDN ngoai).
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "onnxruntime-web", "dist");
const dst = join(root, "public", "ort");

if (!existsSync(src)) {
  console.warn("[copy-ort] khong tim thay onnxruntime-web/dist - bo qua");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".wasm") || (f.endsWith(".mjs") && f.startsWith("ort-wasm"))) {
    cpSync(join(src, f), join(dst, f));
    n++;
  }
}
console.log(`[copy-ort] da copy ${n} file runtime vao public/ort`);
