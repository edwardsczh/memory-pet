import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
const worker = require.resolve("tesseract.js/dist/worker.min.js");
const trained = join(root, "ocr/chi_sim.traineddata");

if (!existsSync(trained)) {
  throw new Error("missing ocr/chi_sim.traineddata");
}

const tessDir = join(root, "public/tesseract");
const dataDir = join(root, "public/tessdata");
mkdirSync(tessDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

cpSync(
  join(coreDir, "tesseract-core-simd-lstm.wasm.js"),
  join(tessDir, "tesseract-core-simd-lstm.wasm.js"),
);
cpSync(worker, join(tessDir, "worker.min.js"));
cpSync(join(coreDir, "LICENSE"), join(tessDir, "LICENSE-tesseract-core.txt"));
cpSync(join(dirname(worker), "..", "LICENSE.md"), join(tessDir, "LICENSE-tesseract.md"));
cpSync(trained, join(dataDir, "chi_sim.traineddata"));
cpSync(join(root, "ocr/NOTICE"), join(dataDir, "NOTICE"));
