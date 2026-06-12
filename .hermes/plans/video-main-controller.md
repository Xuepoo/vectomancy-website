# Plan - Implement Main UI Controller Logic (video-main.js)

## Goal
Implement the main UI controller in `zola-site/static/js/video-main.js` and integrate it into the `video.html` template.

## Steps
1. **Create and Write `video-main.js`**:
   - Check if WebCodecs APIs (`window.VideoFrame`, `window.VideoEncoder`, and `window.VideoDecoder`) are supported.
   - If not supported, prepend a warning banner/message in the control panel (sidebar) and disable the export button `#export-btn`.
   - Setup the Web Worker by loading `/js/video-worker.js`.
   - Send `INIT` message to the worker with `wasmJsUrl: "/wasm/wasm_engine.js"` and `wasmWasmUrl: "/wasm/wasm_engine_bg.wasm"`.
   - Bind UI event listeners:
     - Drag & drop and click upload handlers for `#drop-zone` and `#video-input`.
     - Value changes for `#detail-slider` and `#min-path-slider` to update their corresponding value displays (`#detail-val`, `#min-path-val`).
     - Play/pause functionality for `#play-btn` linked to the hidden `<video>`.
     - Timeline changes (drag/seek) on `#timeline-slider`.
   - When a video is selected:
     - Read the file as a Blob URL and load it in a hidden `<video>` element.
     - Listen to the `loadedmetadata` event of the hidden video:
       - Get width and height to resize the `#preview-canvas`.
       - Update stats: file name, resolution (`width x height`), total frame counts (assuming 30fps), and duration. Make `#video-info` visible.
       - Enable the export button `#export-btn`.
       - Show `#timeline-controls`.
       - Update `#timeline-slider` max value to the video duration in seconds (or frames).
     - Implement preview frame rendering:
       - Draw the current frame of the `<video>` onto the `#preview-canvas`.
       - Listen to `seeked` or manual slider input. If the video is playing, use `requestAnimationFrame` to continuously update the slider and render the current frame onto the canvas.
   - Export button click listener:
     - Use `FileReader` to read the video file as an `ArrayBuffer`.
     - Send `START_EXPORT` to the worker with the transferred `ArrayBuffer` in the transfer list.
     - The message should include format, width, height, fps (default 30), and processing options (mode, detail, min_path_len, color).
     - Open the `#progress-dialog`.
   - Cancel button click listener:
     - Send `CANCEL` to the worker.
     - Close the `#progress-dialog`.
   - Worker message listener:
     - `INIT_DONE`: Log success.
     - `PROGRESS`: Update `#export-progress` value and `#progress-status` text.
     - `DONE`: Revoke resources, hide dialog, trigger a direct browser download of the video blob (mime type: `video/webm` or `video/mp4` depending on selected export format).
     - `ERROR`: Close dialog, alert user of the error.
     - `CANCELLED`: Close dialog.

2. **Modify `zola-site/templates/video.html`**:
   - Add `<script src="/js/video-main.js" defer></script>` in the `<head>` of the HTML template.

3. **Verify the static site builds**:
   - Run `zola build` inside `zola-site/` directory to ensure build succeeds.

4. **Verify and Commit**:
   - Check if changes are clean, run pre-commit or basic checks if any.
   - Commit via `git commit -a -m "feat(web): implement main video UI controller and link script"`.

## Risks
- **Video frame updates during seek**: The hidden `<video>` element must seek reliably. We will use the `seeked` event or `timeupdate` event to render frames to canvas.
- **Large video files**: Transferring the `ArrayBuffer` in `postMessage` must be zero-copy. We will use the transfer list parameter: `worker.postMessage({ type: 'START_EXPORT', ... }, [arrayBuffer])`.
- **Canvas aspect ratio and display**: The canvas elements must be configured to match the video's original width/height dynamically, keeping it visually responsive.

## Verification
- Run `zola build` and inspect output.
- Check files with syntax validation.
