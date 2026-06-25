import init, { fit_paths } from "../wasm/wasm_engine.js";

let isInitialized = false;

self.onmessage = async (e) => {
  if (e.data.type === "init") {
    try {
      await init(e.data.wasmUrl);
      isInitialized = true;
      self.postMessage({ type: "initialized" });
    } catch (err) {
      self.postMessage({ type: "error", error: `WASM Init Failed: ${err.message}` });
    }
  } else if (e.data.type === "fit") {
    if (!isInitialized) {
      self.postMessage({ type: "error", chunkId: e.data.chunkId, error: "Worker not initialized" });
      return;
    }
    try {
      const result = fit_paths(e.data.paths, e.data.config);
      self.postMessage({ type: "success", chunkId: e.data.chunkId, astChunk: result.ast });
    } catch (err) {
      self.postMessage({ type: "error", chunkId: e.data.chunkId, error: `Fitting Failed: ${err}` });
    }
  }
};
