// Web Worker for parallel video frame vectorization.
//
// Each worker owns its own WASM module instance (wasm memory cannot be
// shared across threads without SharedArrayBuffer + COOP/COEP, which this
// project intentionally avoids). The main thread extracts frames from the
// <video> element (DOM access is unavailable in workers) and distributes
// the raw pixel buffers across a small pool of these workers so multiple
// frames vectorize concurrently instead of blocking the UI thread one at
// a time.

import init, { process_image } from "/wasm/wasm_engine.js";

let ready = false;
const pending = [];

async function boot() {
  await init();
  ready = true;
  for (const msg of pending.splice(0)) handle(msg);
}

function handle({ id, frameData, options }) {
  try {
    const result = process_image(frameData, options);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
}

self.onmessage = (e) => {
  if (!ready) {
    pending.push(e.data);
    return;
  }
  handle(e.data);
};

boot();
