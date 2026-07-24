// static/js/worker-pool.js
//
// Minimal round-robin task pool for the video frame vectorization workers.
// Frames are independent (no shared state between them), so distributing
// them across N workers parallelizes the CPU-bound WASM computation across
// N cores instead of processing every frame serially on the main thread.

export class VideoFramePool {
  /**
   * @param {number} size Number of workers to spawn. Defaults to
   *   navigator.hardwareConcurrency, clamped to a sane range so we don't
   *   spawn dozens of WASM instances on high-core-count machines (each
   *   worker loads its own copy of the wasm module into memory).
   */
  constructor(size) {
    const cores =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    this.size = Math.max(1, Math.min(size || cores, 6));
    this.workers = [];
    this.nextId = 0;
    this.pending = new Map();
    this.nextWorker = 0;

    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL("/js/video-frame-worker.js", location.href), {
        type: "module",
      });
      worker.onmessage = (e) => {
        const { id, ok, result, error } = e.data;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (ok) entry.resolve(result);
        else entry.reject(new Error(error));
      };
      worker.onerror = (e) => {
        // Reject every task currently assigned to this worker; without a
        // per-task marker we conservatively fail nothing here and rely on
        // the caller's per-task timeout/error handling upstream.
        console.error("VideoFramePool worker error:", e.message || e);
      };
      this.workers.push(worker);
    }
  }

  /**
   * Submits one frame for vectorization. Frames are assigned to workers
   * round-robin, so up to `size` frames process concurrently.
   * @param {Uint8Array} frameData PNG-encoded frame bytes.
   * @param {object} options process_image options (format, mode, etc).
   * @returns {Promise<string>} the WASM result (JSON string per the
   *   'json' format option used by the video page).
   */
  submit(frameData, options) {
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, frameData, options });
    });
  }

  /**
   * Processes a list of frames with bounded concurrency (`size` workers
   * in flight at once), preserving input order in the returned array.
   * @param {Array<{data: Uint8Array, width: number, height: number}>} frames
   * @param {object} options
   * @param {(done: number, total: number) => void} [onProgress]
   * @returns {Promise<Array<{ok: boolean, value?: string, error?: string, width: number, height: number}>>}
   */
  async processAll(frames, options, onProgress) {
    const results = new Array(frames.length);
    let done = 0;
    let cursor = 0;

    const runNext = async () => {
      const index = cursor++;
      if (index >= frames.length) return;
      const frame = frames[index];
      try {
        const value = await this.submit(frame.data, options);
        results[index] = { ok: true, value, width: frame.width, height: frame.height };
      } catch (err) {
        results[index] = {
          ok: false,
          error: err.message,
          width: frame.width,
          height: frame.height,
        };
      }
      done++;
      if (onProgress) onProgress(done, frames.length);
      await runNext();
    };

    const lanes = Array.from({ length: this.workers.length }, () => runNext());
    await Promise.all(lanes);
    return results;
  }

  terminate() {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.pending.clear();
  }
}
