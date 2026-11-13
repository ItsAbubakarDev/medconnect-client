// Copies what voice mode's speech detector loads at run time (the Silero model, its audio
// worklet, and onnxruntime's WebAssembly) from node_modules into public/vad/, so we serve
// them ourselves at the exact installed versions. Runs before `dev` and `build`;
// public/vad/ is not committed (about 17 MB, ~6 MB compressed, fetched only when a patient
// starts voice mode).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vad");
const files = [
  ["node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js", "vad.worklet.bundle.min.js"],
  ["node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx", "silero_vad_v5.onnx"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.mjs"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.wasm"],
];
mkdirSync(out, { recursive: true });
for (const [from, to] of files) copyFileSync(join(root, from), join(out, to));
console.log(`voice assets copied to public/vad (${files.length} files)`);
