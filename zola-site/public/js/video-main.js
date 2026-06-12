document.addEventListener('DOMContentLoaded', () => {
  // 1. WebCodecs check
  const isWebCodecsSupported = !!(window.VideoFrame && window.VideoEncoder && window.VideoDecoder);

  const sidebar = document.querySelector('.sidebar');
  const exportBtn = document.getElementById('export-btn');

  if (!isWebCodecsSupported) {
    if (sidebar) {
      const warning = document.createElement('div');
      warning.className = 'nes-container is-error with-title';
      warning.style.fontSize = '8px';
      warning.style.marginBottom = '12px';
      warning.style.padding = '8px';
      warning.innerHTML = '<p class="title" style="font-size: 8px; margin: 0; background: #2d1b4e;">WebCodecs Error</p><p style="margin: 0; color: #ff3860;">Your browser does not support WebCodecs. Video export is disabled.</p>';
      sidebar.insertBefore(warning, sidebar.firstChild);
    }
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.classList.add('is-disabled');
    }
  }

  // 2. Setup Web Worker
  let worker = null;
  try {
    worker = new Worker('/js/video-worker.js', { type: 'module' });
    worker.postMessage({
      type: 'INIT',
      data: {
        wasmJsUrl: '/wasm/wasm_engine.js',
        wasmWasmUrl: '/wasm/wasm_engine_bg.wasm'
      }
    });
  } catch (e) {
    console.error('Failed to create Web Worker:', e);
  }

  // DOM Elements
  const dropZone = document.getElementById('drop-zone');
  const videoInput = document.getElementById('video-input');
  const infoName = document.getElementById('info-name');
  const infoResolution = document.getElementById('info-resolution');
  const infoFps = document.getElementById('info-fps');
  const infoFrames = document.getElementById('info-frames');
  const videoInfo = document.getElementById('video-info');
  const timelineControls = document.getElementById('timeline-controls');
  const timelineSlider = document.getElementById('timeline-slider');
  const timeDisplay = document.getElementById('time-display');
  const frameDisplay = document.getElementById('frame-display');
  const playBtn = document.getElementById('play-btn');
  const previewCanvas = document.getElementById('preview-canvas');
  const detailSlider = document.getElementById('detail-slider');
  const detailVal = document.getElementById('detail-val');
  const minPathSlider = document.getElementById('min-path-slider');
  const minPathVal = document.getElementById('min-path-val');
  const modeSelect = document.getElementById('mode-select');
  const colorCheckbox = document.getElementById('color-checkbox');
  const exportFormat = document.getElementById('export-format');
  const progressDialog = document.getElementById('progress-dialog');
  const progressStatus = document.getElementById('progress-status');
  const exportProgress = document.getElementById('export-progress');
  const cancelExportBtn = document.getElementById('cancel-export-btn');

  let currentVideoFile = null;
  let videoUrl = null;
  let hiddenVideo = null;
  let isPlaying = false;
  let animationFrameId = null;
  const fps = 30;

  // Sliders display updating
  if (detailSlider && detailVal) {
    detailSlider.addEventListener('input', () => {
      detailVal.textContent = detailSlider.value;
    });
  }
  if (minPathSlider && minPathVal) {
    minPathSlider.addEventListener('input', () => {
      minPathVal.textContent = minPathSlider.value;
    });
  }

  // Drag & drop / Click handlers
  if (dropZone && videoInput) {
    dropZone.addEventListener('click', () => {
      videoInput.click();
    });

    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        videoInput.click();
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#ffffff';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'var(--accent-color)';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--accent-color)';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleVideoFile(e.dataTransfer.files[0]);
      }
    });

    videoInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleVideoFile(e.target.files[0]);
      }
    });
  }

  // Reset UI elements when video load fails
  function resetUI() {
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.classList.add('is-disabled');
    }
    if (timelineControls) {
      timelineControls.style.display = 'none';
    }
    if (videoInfo) {
      videoInfo.style.display = 'none';
    }
    if (playBtn) {
      playBtn.textContent = 'Play';
    }
    if (previewCanvas) {
      const ctx = previewCanvas.getContext('2d');
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    isPlaying = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // Handle Video File loading
  function handleVideoFile(file) {
    if (!file) return;

    // Check file extension/MIME type (Only MP4 and MOV allowed)
    const fileName = file.name.toLowerCase();
    const isMp4OrMov = fileName.endsWith('.mp4') || fileName.endsWith('.mov');
    const isMimeMp4OrQuicktime = file.type === 'video/mp4' || file.type === 'video/quicktime' || file.type === 'video/mov';

    if (!isMp4OrMov && !isMimeMp4OrQuicktime) {
      alert('Invalid file format. Please upload an MP4 or MOV video file.');
      return;
    }

    currentVideoFile = file;

    // Cleanup previous video element & object url
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    if (hiddenVideo) {
      hiddenVideo.pause();
      hiddenVideo.src = '';
      hiddenVideo.load();
      if (hiddenVideo.parentNode) {
        hiddenVideo.parentNode.removeChild(hiddenVideo);
      }
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    isPlaying = false;
    if (playBtn) playBtn.textContent = 'Play';

    videoUrl = URL.createObjectURL(file);
    hiddenVideo = document.createElement('video');
    hiddenVideo.style.display = 'none';
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;

    // Add error event listener
    hiddenVideo.addEventListener('error', () => {
      alert('Error loading video. The file may be corrupt or unsupported.');
      resetUI();
    });

    hiddenVideo.src = videoUrl;
    document.body.appendChild(hiddenVideo);

    hiddenVideo.addEventListener('loadedmetadata', () => {
      const width = hiddenVideo.videoWidth;
      const height = hiddenVideo.videoHeight;
      const duration = hiddenVideo.duration;

      // Configure canvas dimensions
      if (previewCanvas) {
        previewCanvas.width = width;
        previewCanvas.height = height;
        previewCanvas.style.aspectRatio = `${width} / ${height}`;
      }

      // Display file stats
      const totalFrames = Math.round(duration * fps);
      if (infoName) infoName.textContent = `File: ${file.name}`;
      if (infoResolution) infoResolution.textContent = `Resolution: ${width}x${height}`;
      if (infoFps) infoFps.textContent = `FPS: ${fps}`;
      if (infoFrames) infoFrames.textContent = `Frames: ${totalFrames}`;
      if (videoInfo) videoInfo.style.display = 'block';

      // Show timeline controls
      if (timelineControls) timelineControls.style.display = 'flex';

      // Setup timeline slider
      if (timelineSlider) {
        timelineSlider.max = totalFrames;
        timelineSlider.value = 0;
      }

      updateTimeDisplay(0, duration, 0, totalFrames);

      // Render first frame
      hiddenVideo.currentTime = 0;

      // Enable export button if supported
      if (isWebCodecsSupported && exportBtn) {
        exportBtn.disabled = false;
        exportBtn.classList.remove('is-disabled');
      }
    });

    hiddenVideo.addEventListener('seeked', () => {
      renderPreviewFrame();
    });
  }

  function renderPreviewFrame() {
    if (!hiddenVideo || !previewCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    ctx.drawImage(hiddenVideo, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  // Time & frame displays
  function updateTimeDisplay(currentTime, duration, currentFrame, totalFrames) {
    if (timeDisplay) {
      timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
    if (frameDisplay) {
      frameDisplay.textContent = `Frame ${currentFrame} / ${totalFrames}`;
    }
  }

  // Format time utility (MM:SS)
  function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // Play / Pause logic
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (!hiddenVideo) return;
      if (isPlaying) {
        pauseVideo();
      } else {
        playVideo();
      }
    });
  }

  function playVideo() {
    if (!hiddenVideo) return;
    isPlaying = true;
    if (playBtn) playBtn.textContent = 'Pause';
    hiddenVideo.play();
    animationFrameId = requestAnimationFrame(updateTimelineLoop);
  }

  function pauseVideo() {
    if (!hiddenVideo) return;
    isPlaying = false;
    if (playBtn) playBtn.textContent = 'Play';
    hiddenVideo.pause();
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function updateTimelineLoop() {
    if (!hiddenVideo || !isPlaying) return;

    const currentTime = hiddenVideo.currentTime;
    const duration = hiddenVideo.duration;
    const currentFrame = Math.round(currentTime * fps);
    const totalFrames = Math.round(duration * fps);

    if (timelineSlider) {
      timelineSlider.value = currentFrame;
    }

    updateTimeDisplay(currentTime, duration, currentFrame, totalFrames);
    renderPreviewFrame();

    if (hiddenVideo.ended || currentTime >= duration) {
      pauseVideo();
      if (timelineSlider) timelineSlider.value = totalFrames;
      updateTimeDisplay(duration, duration, totalFrames, totalFrames);
    } else {
      animationFrameId = requestAnimationFrame(updateTimelineLoop);
    }
  }

  // Timeline slider interaction
  if (timelineSlider) {
    timelineSlider.addEventListener('input', () => {
      if (!hiddenVideo) return;
      const targetFrame = parseInt(timelineSlider.value);
      const targetTime = targetFrame / fps;

      hiddenVideo.currentTime = targetTime;

      const duration = hiddenVideo.duration;
      const totalFrames = Math.round(duration * fps);
      updateTimeDisplay(targetTime, duration, targetFrame, totalFrames);
    });
  }

  // Export button action
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!currentVideoFile || !hiddenVideo || !worker) return;

      const format = exportFormat ? exportFormat.value : 'webm';
      const width = hiddenVideo.videoWidth;
      const height = hiddenVideo.videoHeight;
      const options = {
        mode: modeSelect ? modeSelect.value : 'spline',
        detail: detailSlider ? parseInt(detailSlider.value) : 50,
        min_path_len: minPathSlider ? parseInt(minPathSlider.value) : 5,
        color: colorCheckbox ? colorCheckbox.checked : true,
        chaikin_iters: 3,
        terms: 20
      };

      if (progressStatus) progressStatus.textContent = 'Reading video file...';
      if (exportProgress) exportProgress.value = 0;
      if (progressDialog) progressDialog.showModal();

      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target.result;
        if (progressStatus) progressStatus.textContent = 'Export starting...';
        worker.postMessage({
          type: 'START_EXPORT',
          data: {
            videoBuffer: buffer,
            format: format,
            width: width,
            height: height,
            fps: fps,
            options: options
          }
        }, [buffer]);
      };
      reader.onerror = (err) => {
        if (progressDialog) progressDialog.close();
        alert('Failed to read video file.');
      };
      reader.readAsArrayBuffer(currentVideoFile);
    });
  }

  // Cancel export action
  if (cancelExportBtn) {
    cancelExportBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (worker) {
        worker.postMessage({ type: 'CANCEL' });
      }
      if (progressDialog) {
        progressDialog.close();
      }
    });
  }

  // Worker message receiver
  if (worker) {
    worker.onmessage = (e) => {
      const { type } = e.data;

      if (type === 'INIT_DONE') {
        console.log('Web Worker loaded successfully.');
      } else if (type === 'PROGRESS') {
        const current = e.data.current;
        const total = e.data.total;
        const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
        if (exportProgress) exportProgress.value = percent;
        if (progressStatus) progressStatus.textContent = `Processing frame ${current} of ${total}... (${percent}%)`;
      } else if (type === 'DONE') {
        if (progressDialog) progressDialog.close();

        const format = exportFormat ? exportFormat.value : 'webm';
        const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';

        const blob = new Blob([e.data.buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `vectomancy_export.${format}`;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      } else if (type === 'ERROR') {
        if (progressDialog) progressDialog.close();
        alert(`Export failed: ${e.data.error}`);
      } else if (type === 'CANCELLED') {
        if (progressDialog) progressDialog.close();
      }
    };
  }
});
