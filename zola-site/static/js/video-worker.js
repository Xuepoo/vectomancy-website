let wasmInitialized = false;
let isCancelled = false;
let activeMuxer = null;
let activeEncoder = null;
let activeDecoder = null;
let totalFrames = 0;
let processedFrames = 0;
let frameQueue = [];
let isProcessingQueue = false;
let decodedCount = 0;
let decoderFlushed = false;
let resolveProcessing = null;
let processingPromise = null;
let tempCanvas = null;
let tempCtx = null;

// Load dependencies if they are not already globally defined
try {
  if (typeof WebMMuxer === 'undefined') importScripts('webm-muxer.min.js');
} catch (e) {
  try {
    if (typeof WebMMuxer === 'undefined') importScripts('/js/webm-muxer.min.js');
  } catch (err) {}
}
try {
  if (typeof Mp4Muxer === 'undefined') importScripts('mp4-muxer.min.js');
} catch (e) {
  try {
    if (typeof Mp4Muxer === 'undefined') importScripts('/js/mp4-muxer.min.js');
  } catch (err) {}
}
try {
  if (typeof MP4Box === 'undefined') importScripts('mp4box.all.min.js');
} catch (e) {
  try {
    if (typeof MP4Box === 'undefined') importScripts('/js/mp4box.all.min.js');
  } catch (err) {}
}

self.onmessage = async function(e) {
  const { type, data } = e.data;

  if (type === 'INIT') {
    try {
      importScripts(data.wasmJsUrl);
      await wasm_bindgen(data.wasmWasmUrl);
      wasmInitialized = true;
      self.postMessage({ type: 'INIT_DONE' });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: 'Failed to init WASM: ' + err.toString() });
    }
  } else if (type === 'START_EXPORT') {
    if (activeDecoder || activeEncoder) {
      self.postMessage({ type: 'ERROR', error: 'Export already in progress' });
      return;
    }
    isCancelled = false;
    try {
      if (!wasmInitialized) {
        throw new Error("WASM not initialized. Send INIT first.");
      }
      await startExport(data);
    } catch (err) {
      if (!isCancelled) {
        self.postMessage({ type: 'ERROR', error: err.toString() });
      }
      cleanup();
    }
  } else if (type === 'CANCEL') {
    isCancelled = true;
    cleanup();
    self.postMessage({ type: 'CANCELLED' });
  }
};

async function startExport(data) {
  const { videoBuffer, format, width, height, fps, options } = data;

  processedFrames = 0;
  totalFrames = 0;
  frameQueue = [];
  isProcessingQueue = false;
  decodedCount = 0;
  decoderFlushed = false;
  processingPromise = new Promise((resolve) => {
    resolveProcessing = resolve;
  });

  // Initialize OffscreenCanvas
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Initialize Muxer
  let target;
  if (format === 'webm') {
    target = new WebMMuxer.ArrayBufferTarget();
    activeMuxer = new WebMMuxer.Muxer({
      target,
      video: {
        codec: 'V_VP9',
        width: width,
        height: height,
        frameRate: fps
      }
    });
  } else {
    target = new Mp4Muxer.ArrayBufferTarget();
    activeMuxer = new Mp4Muxer.Muxer({
      target,
      video: {
        codec: 'avc',
        width: width,
        height: height,
        frameRate: fps
      },
      fastStart: 'in-memory'
    });
  }

  // Initialize VideoEncoder
  activeEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (activeMuxer) {
        activeMuxer.addVideoChunk(chunk, metadata);
      }
    },
    error: (err) => {
      if (!isCancelled) {
        self.postMessage({ type: 'ERROR', error: 'VideoEncoder error: ' + err.message });
      }
    }
  });

  const encoderConfig = {
    codec: format === 'webm' ? 'vp09.00.10.08' : 'avc1.4d002a',
    width: width,
    height: height,
    bitrate: 2000000, // 2 Mbps
    frameRate: fps,
  };

  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) {
    if (format === 'mp4') {
      encoderConfig.codec = 'avc1.42e01e'; // Fallback Baseline profile
      const fallbackSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!fallbackSupport.supported) {
        throw new Error("Target codec is not supported by VideoEncoder: " + encoderConfig.codec);
      }
    } else {
      throw new Error("Target codec is not supported by VideoEncoder: " + encoderConfig.codec);
    }
  }

  activeEncoder.configure(encoderConfig);

  // Initialize VideoDecoder
  activeDecoder = new VideoDecoder({
    output: (frame) => {
      if (isCancelled) {
        frame.close();
        return;
      }
      frameQueue.push(frame);
      decodedCount++;
      processQueue();
    },
    error: (err) => {
      if (!isCancelled) {
        self.postMessage({ type: 'ERROR', error: 'VideoDecoder error: ' + err.message });
      }
    }
  });

  async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    try {
      while (frameQueue.length > 0) {
        if (isCancelled) {
          while (frameQueue.length > 0) {
            const f = frameQueue.shift();
            try { f.close(); } catch(e){}
          }
          break;
        }

        const frame = frameQueue.shift();
        let bitmap = null;
        let newFrame = null;

        try {
          // 1. Draw the VideoFrame onto the OffscreenCanvas context
          ctx.drawImage(frame, 0, 0, width, height);

          const timestamp = frame.timestamp;
          const duration = frame.duration;

          // 3. Extract pixel data with ctx.getImageData
          const imageData = ctx.getImageData(0, 0, width, height);

          // 4. Run the WASM engine's process_image_buffer to extract parametric lines
          const wasmOptions = {
            format: 'png',
            color: options.color !== false,
            mode: options.mode || 'spline',
            chaikin_iters: options.chaikin_iters !== undefined ? parseInt(options.chaikin_iters) : 3,
            terms: options.terms !== undefined ? parseInt(options.terms) : 20,
            detail: options.detail !== undefined ? parseInt(options.detail) : 50,
            min_path_len: options.min_path_len !== undefined ? parseInt(options.min_path_len) : 5,
            color_style: options.color_style || null,
            letter_spacing: options.letter_spacing || null
          };

          const result = await process_image_buffer(imageData, wasmOptions);

          // 5. Redraw the lines on the canvas
          ctx.fillStyle = wasmOptions.color ? "#000000" : "#ffffff";
          ctx.fillRect(0, 0, width, height);

          drawAST(ctx, result.ast, wasmOptions);

          // 6. Convert the canvas to a new VideoFrame using createImageBitmap(canvas)
          bitmap = await createImageBitmap(canvas);

          // 7. Submit it to VideoEncoder
          newFrame = new VideoFrame(bitmap, {
            timestamp: timestamp,
            duration: duration || (1000000 / fps)
          });

          const keyFrame = (processedFrames % 30 === 0);
          activeEncoder.encode(newFrame, { keyFrame });

          newFrame.close();
          newFrame = null;
          bitmap.close();
          bitmap = null;

          processedFrames++;

          // Send periodic progress updates
          self.postMessage({
            type: 'PROGRESS',
            current: processedFrames,
            total: totalFrames
          });

        } catch (err) {
          if (!isCancelled) {
            self.postMessage({ type: 'ERROR', error: 'Frame processing error: ' + err.toString() });
          }
          processedFrames++;
        } finally {
          try { frame.close(); } catch (e) {}
          if (newFrame) { try { newFrame.close(); } catch (e) {} }
          if (bitmap) { try { bitmap.close(); } catch (e) {} }
        }
      }
    } finally {
      isProcessingQueue = false;
    }

    if (decoderFlushed && processedFrames === decodedCount) {
      if (resolveProcessing) resolveProcessing();
    }
  }

  // Demux MP4/MOV files using MP4Box.createFile()
  const mp4boxfile = MP4Box.createFile();

  const decoderPromise = new Promise((resolve, reject) => {
    mp4boxfile.onReady = (info) => {
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        reject(new Error("No video track found in MP4 file"));
        return;
      }

      totalFrames = videoTrack.nb_samples;
      mp4boxfile.setExtractionOptions(videoTrack.id, null, { nbSamples: totalFrames });

      const description = getTrackDescription(mp4boxfile, videoTrack.id);

      const decoderConfig = {
        codec: videoTrack.codec,
        codedWidth: videoTrack.track_width,
        codedHeight: videoTrack.track_height,
      };
      if (description) {
        decoderConfig.description = description;
      }

      activeDecoder.configure(decoderConfig);
      mp4boxfile.start();
    };

    mp4boxfile.onSamples = (id, user, samples) => {
      for (const sample of samples) {
        if (isCancelled) break;
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: Math.round((sample.cts * 1000000) / sample.timescale),
          duration: Math.round((sample.duration * 1000000) / sample.timescale),
          data: sample.data
        });
        activeDecoder.decode(chunk);
      }
      activeDecoder.flush().then(() => {
        resolve();
      }).catch(reject);
    };

    mp4boxfile.onError = (err) => {
      reject(new Error("MP4Box error: " + err));
    };
  });

  // Feed buffer to MP4Box
  videoBuffer.fileStart = 0;
  mp4boxfile.appendBuffer(videoBuffer);
  mp4boxfile.flush();

  await decoderPromise;

  if (isCancelled) return;

  decoderFlushed = true;
  if (processedFrames === decodedCount) {
    if (resolveProcessing) resolveProcessing();
  }

  await processingPromise;

  if (isCancelled) return;

  // Flush encoder
  await activeEncoder.flush();

  // Finalize muxer
  activeMuxer.finalize();

  const finishedBuffer = activeMuxer.target.buffer;
  self.postMessage({ type: 'DONE', buffer: finishedBuffer }, [finishedBuffer]);

  cleanup();
}

function getTrackDescription(mp4boxfile, trackId) {
  const track = mp4boxfile.getTrackById(trackId);
  if (!track) return null;
  const entry = track.mdia.minf.stbl.stsd.entries[0];
  if (!entry) return null;
  const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
  if (box) {
    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8); // Skip box size and type header
  }
  return null;
}

async function process_image_buffer(imageData, options) {
  if (!tempCanvas || tempCanvas.width !== imageData.width || tempCanvas.height !== imageData.height) {
    tempCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    tempCtx = tempCanvas.getContext('2d');
  }
  tempCtx.putImageData(imageData, 0, 0);
  const blob = await tempCanvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  return wasm_bindgen.process_image(bytes, options);
}

function cleanup() {
  if (activeDecoder) {
    try { activeDecoder.close(); } catch(e){}
    activeDecoder = null;
  }
  if (activeEncoder) {
    try { activeEncoder.close(); } catch(e){}
    activeEncoder = null;
  }
  activeMuxer = null;

  if (frameQueue) {
    while (frameQueue.length > 0) {
      const f = frameQueue.shift();
      try { f.close(); } catch(e){}
    }
  }

  if (resolveProcessing) {
    try { resolveProcessing(); } catch(e){}
    resolveProcessing = null;
  }
}

function processColor(colorRgb, bitDepth, colorSpace) {
  if (!colorRgb) return [0, 0, 0];
  let [r, g, b] = colorRgb;

  // Scale from [0.0, 1.0] to [0.0, 255.0] if necessary
  const isFloat = colorRgb.every((v) => v <= 1.0001);
  if (isFloat) {
    r *= 255.0;
    g *= 255.0;
    b *= 255.0;
  }

  // 1. Color Space Conversion
  if (colorSpace === "grayscale") {
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    r = gray;
    g = gray;
    b = gray;
  }

  // 2. Bit Depth Quantization
  if (bitDepth === "8") {
    r = Math.round((r / 255) * 7) * (255 / 7);
    g = Math.round((g / 255) * 7) * (255 / 7);
    b = Math.round((b / 255) * 3) * (255 / 3);
  } else if (bitDepth === "16") {
    r = Math.round((r / 255) * 31) * (255 / 31);
    g = Math.round((g / 255) * 63) * (255 / 63);
    b = Math.round((b / 255) * 31) * (255 / 31);
  } else if (bitDepth === "4") {
    const palette = [
      [0, 0, 0],
      [255, 255, 255],
      [136, 0, 0],
      [170, 204, 238],
      [204, 68, 204],
      [0, 204, 85],
      [0, 0, 170],
      [238, 238, 51],
      [221, 136, 85],
      [102, 68, 0],
      [255, 119, 119],
      [51, 51, 51],
      [119, 119, 119],
      [170, 255, 102],
      [0, 136, 255],
      [187, 187, 187],
    ];
    let minD = Infinity;
    let bestCol = palette[0];
    for (const col of palette) {
      const d =
        Math.pow(r - col[0], 2) +
        Math.pow(g - col[1], 2) +
        Math.pow(b - col[2], 2);
      if (d < minD) {
        minD = d;
        bestCol = col;
      }
    }
    [r, g, b] = bestCol;
  } else if (bitDepth === "1") {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const bw = gray > 128 ? 255 : 0;
    r = bw;
    g = bw;
    b = bw;
  }

  r = Math.min(255, Math.max(0, Math.round(r)));
  g = Math.min(255, Math.max(0, Math.round(g)));
  b = Math.min(255, Math.max(0, Math.round(b)));

  return [r, g, b];
}

function drawAST(ctx, ast, options) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.5;
  const defCol = options.color ? "#fff" : "#000";
  const extractColor = options.color;

  const depth = "24";
  const space = "srgb";

  function getStrokeStyle(colorStyle, bbox) {
    if (!bbox || bbox.some((val) => !isFinite(val))) {
      bbox = [0, 0, 100, 100];
    }
    if (!colorStyle || !extractColor) return defCol;
    if (Array.isArray(colorStyle)) {
      const finalRgb = processColor(colorStyle, depth, space);
      return `rgb(${finalRgb.join(",")})`;
    } else if (colorStyle.stops) {
      const start_pos = colorStyle.start_pos || [0.0, 0.5];
      const end_pos = colorStyle.end_pos || [1.0, 0.5];
      const w = bbox[2] - bbox[0];
      const h = bbox[3] - bbox[1];
      const b0 = bbox[0];
      const b1 = bbox[1];

      let sx = parseFloat(start_pos[0]);
      let sy = parseFloat(start_pos[1]);
      let ex = parseFloat(end_pos[0]);
      let ey = parseFloat(end_pos[1]);

      if (isNaN(sx) || !isFinite(sx)) sx = 0.0;
      if (isNaN(sy) || !isFinite(sy)) sy = 0.5;
      if (isNaN(ex) || !isFinite(ex)) ex = 1.0;
      if (isNaN(ey) || !isFinite(ey)) ey = 0.5;

      const x0 = b0 + sx * w;
      const y0 = b1 + sy * h;
      const x1 = b0 + ex * w;
      const y1 = b1 + ey * h;

      if (
        !isFinite(x0) ||
        !isFinite(y0) ||
        !isFinite(x1) ||
        !isFinite(y1)
      ) {
        return defCol;
      }

      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      colorStyle.stops.forEach((stop) => {
        let offset = parseFloat(stop[0]);
        if (isNaN(offset) || !isFinite(offset)) {
          offset = 0.0;
        }
        offset = Math.max(0.0, Math.min(1.0, offset));
        const rgb = processColor(stop[1], depth, space);
        grad.addColorStop(offset, `rgb(${rgb.join(",")})`);
      });
      return grad;
    } else if (colorStyle.LinearGradient) {
      const start = processColor(
        colorStyle.LinearGradient.start,
        depth,
        space,
      );
      const end = processColor(
        colorStyle.LinearGradient.end,
        depth,
        space,
      );
      const angle = (colorStyle.LinearGradient.angle * Math.PI) / 180.0;
      const w = bbox ? bbox[2] - bbox[0] : 0;
      const h = bbox ? bbox[3] - bbox[1] : 0;
      const cx = bbox ? bbox[0] + w / 2 : 0;
      const cy = bbox ? bbox[1] + h / 2 : 0;
      const r = Math.sqrt(w * w + h * h) / 2;
      const x1 = cx - Math.cos(angle) * r,
        y1 = cy - Math.sin(angle) * r;
      const x2 = cx + Math.cos(angle) * r,
        y2 = cy + Math.sin(angle) * r;

      const fx1 = Number.isFinite(x1) ? x1 : 0;
      const fy1 = Number.isFinite(y1) ? y1 : 0;
      const fx2 = Number.isFinite(x2) ? x2 : 0;
      const fy2 = Number.isFinite(y2) ? y2 : 0;

      const grad = ctx.createLinearGradient(fx1, fy1, fx2, fy2);
      grad.addColorStop(0, `rgb(${start.join(",")})`);
      grad.addColorStop(1, `rgb(${end.join(",")})`);
      return grad;
    }
    return defCol;
  }

  if (ast.type === "Spline" || ast.type === "spline") {
    ast.equations.forEach((path) => {
      ctx.strokeStyle = getStrokeStyle(
        path.color_style || path.color_rgb,
        ast.bounding_box,
      );
      path.data.forEach((eq) => {
        ctx.beginPath();
        let first = true;
        for (let t = 0; t <= 1; t += 0.05) {
          let x =
            eq.x_poly[0] +
            eq.x_poly[1] * t +
            eq.x_poly[2] * t * t +
            eq.x_poly[3] * t * t * t;
          let y =
            eq.y_poly[0] +
            eq.y_poly[1] * t +
            eq.y_poly[2] * t * t +
            eq.y_poly[3] * t * t * t;
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    });
  } else if (ast.type === "Fourier" || ast.type === "fourier") {
    ast.strokes.forEach((stroke) => {
      if (!stroke.data || stroke.data.length === 0) return;
      ctx.strokeStyle = getStrokeStyle(
        stroke.color_style || stroke.color_rgb,
        ast.bounding_box,
      );
      ctx.beginPath();
      let first = true;
      const st = Math.min(stroke.data.length * 4, 1000);
      for (let i = 0; i <= st; i++) {
        let t = (i / st) * Math.PI * 2,
          x = 0,
          y = 0;
        stroke.data.forEach((term) => {
          x += term.amplitude * Math.cos(term.frequency * t + term.phase);
          y += term.amplitude * Math.sin(term.frequency * t + term.phase);
        });
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  } else if (ast.type === "Polyline" || ast.type === "polyline") {
    ast.paths.forEach((path) => {
      ctx.strokeStyle = getStrokeStyle(
        path.color_style || path.color_rgb,
        ast.bounding_box,
      );
      ctx.beginPath();
      let first = true;
      path.data.forEach((pt) => {
        if (first) {
          ctx.moveTo(pt.x, pt.y);
          first = false;
        } else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    });
  }
}
