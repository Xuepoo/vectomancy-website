# Plan: Fix Web Worker Concurrency Race Conditions and Premature Finalization

## Goal
Refactor frame processing and demuxing/finalization logic in `zola-site/static/js/video-worker.js` under the worktree to ensure strictly sequential frame processing (synchronous frame queueing) and prevent premature finalization.

## Steps
1. **Define Queue and Synchronization State Variables**:
   In `startExport` function of `zola-site/static/js/video-worker.js`, introduce:
   - `frameQueue` (array of `VideoFrame`)
   - `isProcessingQueue` (boolean flag)
   - `decodedCount` (integer, starts at 0)
   - `decoderFlushed` (boolean, starts at false)
   - `processingPromise` and its resolver `resolveProcessing`.

2. **Refactor `VideoDecoder` output callback**:
   - Change `output` callback to synchronous.
   - Inside the callback, check `isCancelled`. If so, call `frame.close()` and return.
   - Push decoded frame into `frameQueue`, increment `decodedCount`, and call `processQueue()`.

3. **Implement `processQueue` Helper Function**:
   - Create an async `processQueue()` inside `startExport`.
   - Prevent concurrent processing using `isProcessingQueue`.
   - Process queued frames one-by-one using a `while (frameQueue.length > 0)` loop:
     * Draw frame to context.
     * Close frame immediately (`frame.close()`).
     * Extract pixel data (`ctx.getImageData`).
     * Process image buffer via WASM (`process_image_buffer`).
     * Redraw canvas using `drawAST`.
     * Convert canvas to a new `VideoFrame` and encode it.
     * Close new frame and bitmap.
     * Increment `processedFrames` and post PROGRESS message.
     * Handle errors gracefully inside the loop (increment `processedFrames` to avoid deadlocks).
   - In `finally` block, set `isProcessingQueue = false`.
   - Check if `decoderFlushed && processedFrames === decodedCount`, and if so, call `resolveProcessing()`.

4. **Coordinate Finalization in `startExport`**:
   - After `await decoderPromise`, set `decoderFlushed = true`.
   - Check `if (processedFrames === decodedCount) resolveProcessing();`.
   - Await `processingPromise;` before flushing encoder and finalizing muxer.

5. **Validation and Build**:
   - Run `zola build` inside `zola-site/` to ensure successful compilation.
   - Run pre-commit hooks: `pre-commit run --all-files` (using CLI tool or git runner).

6. **Commit Changes**:
   - Commit with the message `git commit -a -m "fix(web): serialize frame processing and prevent premature worker finalize"`.

## Risks
- **Memory leaks**: If frames in `frameQueue` are not closed on error or cancellation, we could leak GPU resources.
  - *Mitigation*: Ensure `frame.close()` is called in `finally`/`catch` blocks and when draining the queue on cancellation/cleanup.
- **Deadlocks**: If `processedFrames` does not reach `decodedCount` due to processing errors, finalization might hang.
  - *Mitigation*: Ensure `processedFrames` is incremented in the `catch` block inside the frame processing loop.

## Verification
- Run `zola build` inside the `zola-site/` directory.
- Verify through local testing or test suite if available.
