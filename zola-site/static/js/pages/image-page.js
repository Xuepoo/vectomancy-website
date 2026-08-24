// image-page.js — extracted from templates/image.html (behavior must stay identical)
export function startImagePage(deps) {
  const { init, process_image, process_text, RevealAnimator } = deps;

  let isWasmLoaded = false;
  let originalImageObj = null;
  let currentImageBytes = null;
  let currentFilename = "";
  let previewDataStore = new Map();
  let activePreviewId = null;
  let cachedViewportCanvas = null;
  let snapshotCount = 0;
  let pendingDeleteId = null;

  let scale = 1,
    offsetX = 0,
    offsetY = 0;
  let isDragging = false,
    dragStart = { x: 0, y: 0 };
  let renderRequested = false;
  let revealOrigin = null;
  let revealAnimator = null;

  const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "svg"];

  const els = {
    fileInput: document.getElementById("fileInput"),
    urlInput: document.getElementById("urlInput"),
    fetchUrlBtn: document.getElementById("fetchUrlBtn"),
    filenameDisplay: document.getElementById("filename-display"),
    statusText: document.getElementById("status-text"),
    generateBtn: document.getElementById("generateBtn"),
    mainCanvas: document.getElementById("mainCanvas"),
    canvasArea: document.getElementById("canvasArea"),
    gallery: document.getElementById("gallery"),
    resetViewBtn: document.getElementById("resetViewBtn"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    helpBtn: document.getElementById("helpBtn"),
    helpDialog: document.getElementById("help-dialog"),
    modeSelect: document.getElementById("modeSelect"),
    colorCheck: document.getElementById("colorCheck"),
    simplifyCheck: document.getElementById("simplifyCheck"),
    colorDepthSelect: document.getElementById("colorDepthSelect"),
    colorSpaceSelect: document.getElementById("colorSpaceSelect"),
    gridCheck: document.getElementById("gridCheck"),
    detailRange: document.getElementById("detailRange"),
    minPathRange: document.getElementById("minPathRange"),
    strokeRange: document.getElementById("strokeRange"),
    termsRange: document.getElementById("termsRange"),
    chaikinRange: document.getElementById("chaikinRange"),
    fourierControls: document.getElementById("fourier-controls"),
    chaikinControls: document.getElementById("chaikin-controls"),
    detailVal: document.getElementById("detailVal"),
    minPathVal: document.getElementById("minPathVal"),
    termsVal: document.getElementById("termsVal"),
    chaikinVal: document.getElementById("chaikinVal"),
    overlayStats: document.getElementById("overlayStats"),
    exportFormat: document.getElementById("exportFormat"),
    bgTransparentCheck: document.getElementById("bgTransparentCheck"),
    revealModeSelect: document.getElementById("revealModeSelect"),
    revealDurationRange: document.getElementById("revealDurationRange"),
    revealDurationVal: document.getElementById("revealDurationVal"),
    revealStagedCheck: document.getElementById("revealStagedCheck"),
    revealColorOptions: document.getElementById("revealColorOptions"),
    revealColorStrategySelect: document.getElementById("revealColorStrategySelect"),
    revealColorLagRange: document.getElementById("revealColorLagRange"),
    revealColorLagVal: document.getElementById("revealColorLagVal"),
    replayBtn: document.getElementById("replayBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    copyBtn: document.getElementById("copyBtn"),
    restoreJsonInput: document.getElementById("restoreJsonInput"),
    shareBtn: document.getElementById("shareBtn"),
    shareDialog: document.getElementById("shareDialog"),
    loaderOverlay: document.getElementById("loaderOverlay"),
    loaderText: document.getElementById("loaderText"),
    progressContainer: document.getElementById("progressContainer"),
    progressBar: document.getElementById("progressBar"),
    deleteDialog: document.getElementById("delete-dialog"),
    clearDialog: document.getElementById("clear-dialog"),
    errorDialog: document.getElementById("error-dialog"),
    errorMessage: document.getElementById("error-message"),
    radioLocal: document.querySelector('input[value="local"]'),
    radioUrl: document.querySelector('input[value="url"]'),
    btnZoomIn: document.getElementById("btnZoomIn"),
    btnZoomOut: document.getElementById("btnZoomOut"),
    btnResetViewObj: document.getElementById("btnResetViewObj"),
    btnFocus: document.getElementById("btnFocus"),
    resetSettingsBtn: document.getElementById("resetSettingsBtn"),
  };

  const ctx = els.mainCanvas.getContext("2d");

  function showError(msg) {
    els.errorMessage.innerText = msg;
    els.errorDialog.showModal();
  }

  function truncateMiddle(str, maxLength) {
    if (str.length <= maxLength) return str;
    return (
      str.substr(0, Math.ceil(maxLength / 2)) +
      "..." +
      str.substr(str.length - Math.floor(maxLength / 2))
    );
  }

  async function run() {
    try {
      await init(await window.__wasmBytes);
      isWasmLoaded = true;
      els.loaderOverlay.classList.add("hidden");
      console.log("WASM Initialized!");
    } catch (e) {
      els.statusText.innerText = window.t8("ERR: LOAD", "错误：加载失败");
      console.error(e);
    }
  }

  run();

  function updateLabels() {
    els.detailVal.innerText = els.detailRange.value;
    els.minPathVal.innerText = els.minPathRange.value;
    els.termsVal.innerText = els.termsRange.value;
    els.chaikinVal.innerText = els.chaikinRange.value;
    els.revealDurationVal.innerText = `${parseFloat(els.revealDurationRange.value).toFixed(1)}s`;
    els.revealColorLagVal.innerText = `${els.revealColorLagRange.value}%`;
    const mode = els.modeSelect.value;
    els.fourierControls.classList.toggle("hidden", mode !== "fourier");
    els.chaikinControls.classList.toggle("hidden", mode !== "chaikin");
  }

  [
    els.detailRange,
    els.minPathRange,
    els.termsRange,
    els.chaikinRange,
    els.modeSelect,
    els.revealDurationRange,
    els.revealColorLagRange,
  ].forEach((el) => el.addEventListener("input", updateLabels));
  els.strokeRange.addEventListener("input", () => {
    recacheViewportCanvas();
    requestRender();
  });

  // Reveal controls restart the current animation when a value settles.
  [
    els.revealModeSelect,
    els.revealStagedCheck,
    els.revealColorStrategySelect,
    els.revealColorLagRange,
    els.revealDurationRange,
  ].forEach((el) =>
    el.addEventListener("change", () => {
      recacheViewportCanvas();
      requestRender();
      saveSettings();
    }),
  );
  // Toggling staged color also shows/hides the color spread sub-panel.
  els.revealStagedCheck.addEventListener("change", () => {
    els.revealColorOptions.classList.toggle("hidden", !els.revealStagedCheck.checked);
  });

  els.replayBtn.addEventListener("click", () => {
    recacheViewportCanvas();
    requestRender();
  });

  els.themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    [els.deleteDialog, els.clearDialog, els.errorDialog, els.helpDialog].forEach((d) =>
      d.classList.toggle("is-dark"),
    );

    // Toggle is-dark class on all inputs, checkboxes, radios, select dropdowns, and basic non-colored buttons
    document
      .querySelectorAll(
        ".nes-input, .nes-checkbox, .nes-radio, .nes-select select, .nes-btn:not(.is-primary):not(.is-success):not(.is-error):not(.is-warning)",
      )
      .forEach((el) => {
        el.classList.toggle("is-dark");
      });

    recacheViewportCanvas();
    requestRender();
    saveSettings();
  });

  if (els.resetSettingsBtn) {
    els.resetSettingsBtn.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const isTextarea = e.target.tagName === "TEXTAREA";
      if (isTextarea) {
        if (!e.shiftKey) {
          e.preventDefault();
          els.generateBtn.click();
        }
      } else if (e.target.tagName === "INPUT" || e.target === document.body) {
        els.generateBtn.click();
      }
    }
  });

  function updateInputView() {
    document
      .getElementById("localInputWrapper")
      .classList.toggle("hidden", !els.radioLocal.checked);
    document.getElementById("urlInputWrapper").classList.toggle("hidden", !els.radioUrl.checked);
  }
  [els.radioLocal, els.radioUrl].forEach((r) => r.addEventListener("change", updateInputView));

  // Image page: hardcode image partner links
  const partnerContent = document.getElementById("partnerContent");
  partnerContent.innerHTML = `
          <p style="margin-bottom: 8px; color: var(--accent-color); font-size: 9px;">${window.t8("Image Tools", "图片工具")}</p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
              <a href="https://www.waifu2x.net/" target="_blank" class="nes-btn is-primary" style="font-size: 9px; padding: 4px 8px;">Waifu2x</a>
              <a href="https://vectorizer.ai/" target="_blank" class="nes-btn is-primary" style="font-size: 9px; padding: 4px 8px;">Vectorizer</a>
              <a href="https://www.photopea.com/" target="_blank" class="nes-btn is-primary" style="font-size: 9px; padding: 4px 8px;">Photopea</a>
          </div>
      `;
  updateInputView();

  async function handleImageBytes(buffer, filename) {
    // Extension validation
    const ext = filename.split(".").pop().toLowerCase();
    if (filename.includes(".") && !SUPPORTED_EXTS.includes(ext)) {
      return showError(
        window.t8(
          `Unsupported file: .${ext}\nPlease use PNG, JPG, WebP or SVG.`,
          `不支持的文件：.${ext}\n请使用 PNG、JPG、WebP 或 SVG。`,
        ),
      );
    }

    let prevBlobUrl = originalImageObj?.dataset?.blobUrl;
    if (prevBlobUrl) {
      try {
        URL.revokeObjectURL(prevBlobUrl);
      } catch (_) {}
    }
    const blob = new Blob([buffer]);
    const blobUrl = URL.createObjectURL(blob);

    const tempImg = new Image();
    tempImg.dataset.blobUrl = blobUrl;
    tempImg.onerror = () => {
      showError(
        window.t8(
          "Invalid Image Data!\nThe file could not be parsed as an image.",
          "图片数据无效！\n无法将文件解析为图像。",
        ),
      );
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (_) {}
      els.loaderOverlay.classList.add("hidden");
    };
    tempImg.onload = () => {
      currentImageBytes = new Uint8Array(buffer);
      currentFilename = filename;
      els.filenameDisplay.innerText = truncateMiddle(filename, 20);
      originalImageObj = tempImg;
      const old = document.getElementById("gallery-original");
      if (old) old.remove();
      addGalleryItem("original", blobUrl, window.t8("ORIGINAL", "原图"));
      setActivePreview("original");
      els.loaderOverlay.classList.add("hidden");
    };
    tempImg.src = blobUrl;
  }

  els.fileInput.addEventListener("change", async (e) => {
    if (e.target.files[0]) {
      const b = await e.target.files[0].arrayBuffer();
      handleImageBytes(b, e.target.files[0].name);
    }
  });

  els.fetchUrlBtn.addEventListener("click", async () => {
    const url = els.urlInput.value;
    if (!url) return;
    els.loaderOverlay.classList.remove("hidden");
    els.loaderText.innerText = window.t8("Fetching URL...", "正在获取 URL…");
    try {
      const proxyBase =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.protocol === "file:"
          ? "https://vectomancy.pages.dev/proxy"
          : "/proxy";
      const r = await fetch(proxyBase + "?url=" + encodeURIComponent(url));
      if (!r.ok) throw new Error("HTTP Error");
      const b = await r.arrayBuffer();
      handleImageBytes(b, url.split("/").pop().split("?")[0] || "remote_image.png");
    } catch (e) {
      showError(
        window.t8(
          "Fetch Failed!\nCheck the URL or CORS proxy status.",
          "获取失败！\n请检查 URL 或 CORS 代理状态。",
        ),
      );
      els.loaderOverlay.classList.add("hidden");
    }
  });

  // Clipboard Paste Support
  window.addEventListener("paste", async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        els.loaderOverlay.classList.remove("hidden");
        els.loaderText.innerText = window.t8("Pasting Image...", "正在粘贴图片…");
        const blob = item.getAsFile();
        const buffer = await blob.arrayBuffer();
        handleImageBytes(buffer, `pasted_img_${Date.now()}.png`);
        break;
      }
    }
  });

  els.generateBtn.addEventListener("click", () => {
    if (!isWasmLoaded) return;
    if (!currentImageBytes) return showError(window.t8("No Image!", "没有图片！"));

    els.progressContainer.classList.remove("hidden");
    let p = 0;
    const pInt = setInterval(() => {
      p += 20;
      if (p >= 90) {
        p = 90;
        clearInterval(pInt);
      }
      els.progressBar.value = p;
    }, 10);

    setTimeout(() => {
      try {
        const start = performance.now();
        // Optional style configs can be added here
        const options = {
          format: "jpg",
          color: els.colorCheck.checked,
          mode: els.modeSelect.value,
          chaikin_iters: parseInt(els.chaikinRange.value),
          terms: parseInt(els.termsRange.value),
          detail: parseInt(els.detailRange.value),
          min_path_len: parseInt(els.minPathRange.value),
          simplify_math: els.simplifyCheck.checked,
        };

        const result = process_image(currentImageBytes, options);

        snapshotCount++;
        const id = `snap-${snapshotCount}`;
        createSnapshot(
          id,
          result,
          `${options.mode.substring(0, 3).toUpperCase()} D${options.detail}`,
          Math.round(performance.now() - start),
        );
      } catch (e) {
        console.error(e);
      }
      clearInterval(pInt);
      els.progressBar.value = 100;
      setTimeout(() => els.progressContainer.classList.add("hidden"), 200);
    }, 50);
  });

  function createSnapshot(id, result, label, time) {
    const size = 128;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const oCtx = off.getContext("2d");
    oCtx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
    oCtx.fillRect(0, 0, size, size);
    const s = Math.min(size / result.width, size / result.height) * 0.9;
    oCtx.translate((size - result.width * s) / 2, (size - result.height * s) / 2);
    oCtx.scale(s, s);
    drawAST(oCtx, result.ast, true, document.body.classList.contains("dark-theme"));
    result.computeTime = time;
    previewDataStore.set(id, result);
    addGalleryItem(id, off.toDataURL(), label);
    setActivePreview(id);
  }

  function addGalleryItem(id, src, label) {
    const div = document.createElement("div");
    div.className = "gallery-item";
    div.id = `gallery-${id}`;
    div.innerHTML =
      `<img src="${src}"><div class="gallery-label">${label}</div>` +
      (id !== "original" ? '<div class="gallery-delete">X</div>' : "");
    div.onclick = (e) => {
      if (e.target.classList.contains("gallery-delete")) {
        e.stopPropagation();
        pendingDeleteId = id;
        els.deleteDialog.showModal();
      } else setActivePreview(id);
    };
    els.gallery.prepend(div);
  }

  els.deleteDialog.addEventListener("close", () => {
    if (els.deleteDialog.returnValue === "confirm" && pendingDeleteId) {
      previewDataStore.delete(pendingDeleteId);
      document.getElementById(`gallery-${pendingDeleteId}`).remove();
      if (activePreviewId === pendingDeleteId) setActivePreview("original");
    }
  });

  els.clearAllBtn.addEventListener("click", () => {
    if (previewDataStore.size > 0) els.clearDialog.showModal();
  });
  els.clearDialog.addEventListener("close", () => {
    if (els.clearDialog.returnValue === "confirm") {
      for (let k of previewDataStore.keys()) document.getElementById(`gallery-${k}`).remove();
      previewDataStore.clear();
      setActivePreview("original");
    }
  });

  els.helpBtn.addEventListener("click", () => {
    els.helpDialog.showModal();
  });

  function readRevealOptions(isDark) {
    return {
      mode: els.revealModeSelect.value,
      durationMs: parseFloat(els.revealDurationRange.value) * 1000,
      colorMode: els.revealStagedCheck.checked ? "staged" : "together",
      colorStrategy: els.revealColorStrategySelect.value,
      colorLag: parseInt(els.revealColorLagRange.value, 10) / 100,
      monoColor: isDark ? "#fff" : "#000",
      // Match the final paint exactly (drawAST runs with
      // isExport=true, i.e. raw stroke weight): otherwise animated
      // strokes render thinner than the resting frame and the last
      // frame visibly "thickens" when the clean repaint lands.
      lineWidth: els.strokeRange ? parseFloat(els.strokeRange.value) : 1.0,
      seed: 1,
      origin: revealOrigin,
    };
  }

  function recacheViewportCanvas() {
    if (activePreviewId && activePreviewId !== "original") {
      const res = previewDataStore.get(activePreviewId);
      if (!cachedViewportCanvas) {
        cachedViewportCanvas = document.createElement("canvas");
      }
      cachedViewportCanvas.width = res.width;
      cachedViewportCanvas.height = res.height;
      const cCtx = cachedViewportCanvas.getContext("2d");
      const isDark = document.body.classList.contains("dark-theme");
      if (revealAnimator) {
        revealAnimator.cancel();
        revealAnimator = null;
      }
      const renderStart = performance.now();
      const opts = readRevealOptions(isDark);
      const finishInstant = () => {
        drawAST(cCtx, res.ast, false, isDark, true);
        res.renderTime = Math.round(performance.now() - renderStart);
        updateStatsOverlay(res);
      };
      if (opts.mode === "instant") {
        finishInstant();
      } else {
        revealAnimator = new RevealAnimator(res.ast, opts);
        if (revealAnimator.isEmpty) {
          revealAnimator = null;
          finishInstant();
        } else {
          res.renderTime = Math.round(opts.durationMs);
          updateStatsOverlay(res);
          revealAnimator.play(cCtx, {
            onFrame: () => requestRender(),
            onDone: () => {
              revealAnimator = null;
              // Staged mode keeps its final accumulated frame as the
              // resting state: with dense art, a clean single-pass
              // repaint accumulates alpha differently than the animated
              // layers and reads as a sudden darkening jump. Non-staged
              // reveals still get the clean repaint (their last frame is
              // nearly identical to it).
              if (opts.colorMode !== "staged") {
                cCtx.clearRect(0, 0, res.width, res.height);
                drawAST(cCtx, res.ast, false, isDark, true);
              }
              res.renderTime = Math.round(performance.now() - renderStart);
              updateStatsOverlay(res);
            },
          });
        }
      }
    }
  }

  function updateStatsOverlay(res) {
    let stats = `${window.t8("RENDER STATS", "渲染统计")}\n${window.t8("SIZE", "尺寸")}: ${res.width}x${res.height}\n${window.t8("CONVERT", "转换")}: ${res.computeTime}ms\n${window.t8("RENDER", "渲染")}: ${res.renderTime || 0}ms`;
    if (res.ast.type === "Spline" || res.ast.type === "spline")
      stats += `\n${window.t8("PATHS", "路径")}: ${res.ast.equations.length}`;
    else if (res.ast.type === "Fourier" || res.ast.type === "fourier")
      stats += `\n${window.t8("STROKES", "笔画")}: ${res.ast.strokes.length}`;
    else if (res.ast.type === "Polyline" || res.ast.type === "polyline")
      stats += `\n${window.t8("PATHS", "路径")}: ${res.ast.paths.length}`;
    els.overlayStats.innerText = stats;
  }

  function setActivePreview(id) {
    activePreviewId = id;
    document.querySelectorAll(".gallery-item").forEach((el) => el.classList.remove("active"));
    const item = document.getElementById(`gallery-${id}`);
    if (item) {
      item.classList.add("active");
      item.scrollIntoView({ behavior: "smooth", inline: "center" });
    }

    if (id !== "original") {
      recacheViewportCanvas();
      updateStatsOverlay(previewDataStore.get(id));
    } else {
      cachedViewportCanvas = null;
      if (originalImageObj) {
        els.overlayStats.innerText = `${window.t8("ORIGINAL IMAGE", "原始图像")}\n${window.t8("SIZE", "尺寸")}: ${originalImageObj.width}x${originalImageObj.height}`;
      } else {
        els.overlayStats.innerText = window.t8("Waiting for input...", "等待输入…");
      }
    }
    resetViewport();
    requestRender();
  }

  function resetViewport() {
    if (!originalImageObj && activePreviewId === "original") return;
    const w =
      activePreviewId === "original"
        ? originalImageObj.width
        : previewDataStore.get(activePreviewId).width;
    const h =
      activePreviewId === "original"
        ? originalImageObj.height
        : previewDataStore.get(activePreviewId).height;
    const r = els.canvasArea.getBoundingClientRect();
    scale = Math.min((r.width * 0.8) / w, (r.height * 0.8) / h);
    offsetX = (r.width - w * scale) / 2;
    offsetY = (r.height - h * scale) / 2;
  }

  els.canvasArea.addEventListener("mousedown", (e) => {
    if (e.altKey) {
      e.preventDefault();
      const r = els.canvasArea.getBoundingClientRect();
      revealOrigin = [
        (e.clientX - r.left - offsetX) / scale,
        (e.clientY - r.top - offsetY) / scale,
      ];
      // Always switch so the action has visible feedback, even from the
      // default Instant mode (otherwise ALT+click looks like a no-op).
      els.revealModeSelect.value = "radial-origin";
      saveSettings();
      els.statusText.innerText = window.t8("REVEAL ORIGIN SET", "已设置渐显起点");
      recacheViewportCanvas();
      requestRender();
      return;
    }
    isDragging = true;
    dragStart = { x: e.clientX - offsetX, y: e.clientY - offsetY };
  });
  window.addEventListener("mousemove", (e) => {
    if (isDragging) {
      offsetX = e.clientX - dragStart.x;
      offsetY = e.clientY - dragStart.y;
      requestRender();
    }
  });
  window.addEventListener("mouseup", () => (isDragging = false));
  els.canvasArea.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = Math.exp((e.deltaY < 0 ? 1 : -1) * 0.1);
    zoomAt(e.clientX, e.clientY, factor);
  });

  function zoomAt(clientX, clientY, factor) {
    const r = els.canvasArea.getBoundingClientRect();
    const mx = clientX - r.left,
      my = clientY - r.top;
    offsetX = mx - (mx - offsetX) * factor;
    offsetY = my - (my - offsetY) * factor;
    scale *= factor;
    requestRender();
  }

  function requestRender() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(renderViewport);
    }
  }

  function renderViewport() {
    renderRequested = false;
    const r = els.canvasArea.getBoundingClientRect();
    const targetWidth = Math.floor(r.width);
    const targetHeight = Math.floor(r.height);
    if (els.mainCanvas.width !== targetWidth || els.mainCanvas.height !== targetHeight) {
      els.mainCanvas.width = targetWidth;
      els.mainCanvas.height = targetHeight;
    }
    ctx.clearRect(0, 0, els.mainCanvas.width, els.mainCanvas.height);
    if (!activePreviewId) return;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const w =
      activePreviewId === "original"
        ? originalImageObj.width
        : previewDataStore.get(activePreviewId).width;
    const h =
      activePreviewId === "original"
        ? originalImageObj.height
        : previewDataStore.get(activePreviewId).height;

    if (!els.bgTransparentCheck.checked) {
      ctx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }

    if (activePreviewId === "original") {
      if (originalImageObj) ctx.drawImage(originalImageObj, 0, 0);
    } else if (cachedViewportCanvas) {
      ctx.drawImage(cachedViewportCanvas, 0, 0);
    }
    ctx.restore();
  }

  function processColor(colorRgb, bitDepth, colorSpace) {
    if (!colorRgb) return null;
    let [r, g, b] = colorRgb;

    // Scale from [0.0, 1.0] to [0.0, 255.0] if necessary
    // Because our Rust engine serialization provides normalized floats for colorStyle Solid.
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
        const d = Math.pow(r - col[0], 2) + Math.pow(g - col[1], 2) + Math.pow(b - col[2], 2);
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

  function drawAST(ctx, ast, isThumb, isDark, isExport) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const strokeWidth = els.strokeRange ? parseFloat(els.strokeRange.value) : 1.0;
    ctx.lineWidth = isThumb ? 3 : isExport ? strokeWidth : strokeWidth / scale;
    const defCol = isDark ? "#fff" : "#000";
    const extractColor = els.colorCheck.checked || isThumb || isExport;

    const depth = els.colorDepthSelect ? els.colorDepthSelect.value : "24";
    const space = els.colorSpaceSelect ? els.colorSpaceSelect.value : "srgb";

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

        if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) {
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
        const start = processColor(colorStyle.LinearGradient.start, depth, space);
        const end = processColor(colorStyle.LinearGradient.end, depth, space);
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
        ctx.strokeStyle = getStrokeStyle(path.color_style || path.color_rgb, ast.bounding_box);
        path.data.forEach((eq) => {
          ctx.beginPath();
          let first = true;
          for (let t = 0; t <= 1; t += isThumb ? 0.2 : 0.05) {
            let x =
              eq.x_poly[0] + eq.x_poly[1] * t + eq.x_poly[2] * t * t + eq.x_poly[3] * t * t * t;
            let y =
              eq.y_poly[0] + eq.y_poly[1] * t + eq.y_poly[2] * t * t + eq.y_poly[3] * t * t * t;
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
        ctx.strokeStyle = getStrokeStyle(stroke.color_style || stroke.color_rgb, ast.bounding_box);
        ctx.beginPath();
        let first = true;
        const st = Math.min(stroke.data.length * 4, isThumb ? 100 : 1000);
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
        ctx.strokeStyle = getStrokeStyle(path.color_style || path.color_rgb, ast.bounding_box);
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

  function astToSvgString(ast, width, height, isDark) {
    const strokeWidth = els.strokeRange ? parseFloat(els.strokeRange.value) : 1.0;
    const depth = els.colorDepthSelect ? els.colorDepthSelect.value : "24";
    const space = els.colorSpaceSelect ? els.colorSpaceSelect.value : "srgb";
    const defCol = isDark ? "#ffffff" : "#000000";
    const bbox =
      ast.bounding_box && !ast.bounding_box.some((v) => !isFinite(v))
        ? ast.bounding_box
        : [0, 0, width, height];

    const defs = [];
    let gradCounter = 0;

    function fmtNum(v) {
      return (Math.round(v * 10000) / 10000).toString();
    }

    function resolveStroke(colorStyle) {
      if (!colorStyle) return defCol;
      if (Array.isArray(colorStyle)) {
        const rgb = processColor(colorStyle, depth, space);
        return rgb ? `rgb(${rgb.join(",")})` : defCol;
      }
      if (colorStyle.stops) {
        const id = `vecto-svg-grad-${gradCounter++}`;
        const start_pos = colorStyle.start_pos || [0.0, 0.5];
        const end_pos = colorStyle.end_pos || [1.0, 0.5];
        const w = bbox[2] - bbox[0];
        const h = bbox[3] - bbox[1];
        const x0 = bbox[0] + (parseFloat(start_pos[0]) || 0) * w;
        const y0 = bbox[1] + (parseFloat(start_pos[1]) || 0.5) * h;
        const x1 = bbox[0] + (parseFloat(end_pos[0]) || 1) * w;
        const y1 = bbox[1] + (parseFloat(end_pos[1]) || 0.5) * h;
        const stops = colorStyle.stops
          .map((stop) => {
            let offset = parseFloat(stop[0]);
            if (isNaN(offset) || !isFinite(offset)) offset = 0.0;
            offset = Math.max(0.0, Math.min(1.0, offset));
            const rgb = processColor(stop[1], depth, space);
            return `<stop offset="${fmtNum(offset)}" stop-color="rgb(${rgb.join(",")})"/>`;
          })
          .join("");
        defs.push(
          `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmtNum(x0)}" y1="${fmtNum(y0)}" x2="${fmtNum(x1)}" y2="${fmtNum(y1)}">${stops}</linearGradient>`,
        );
        return `url(#${id})`;
      }
      if (colorStyle.LinearGradient) {
        const id = `vecto-svg-grad-${gradCounter++}`;
        const start = processColor(colorStyle.LinearGradient.start, depth, space);
        const end = processColor(colorStyle.LinearGradient.end, depth, space);
        const angle = ((colorStyle.LinearGradient.angle || 0) * Math.PI) / 180.0;
        const w = bbox[2] - bbox[0],
          h = bbox[3] - bbox[1];
        const cx = bbox[0] + w / 2,
          cy = bbox[1] + h / 2;
        const r = Math.sqrt(w * w + h * h) / 2;
        const x1 = cx - Math.cos(angle) * r,
          y1 = cy - Math.sin(angle) * r;
        const x2 = cx + Math.cos(angle) * r,
          y2 = cy + Math.sin(angle) * r;
        defs.push(
          `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmtNum(x1)}" y1="${fmtNum(y1)}" x2="${fmtNum(x2)}" y2="${fmtNum(y2)}"><stop offset="0" stop-color="rgb(${start.join(",")})"/><stop offset="1" stop-color="rgb(${end.join(",")})"/></linearGradient>`,
        );
        return `url(#${id})`;
      }
      return defCol;
    }

    function pathTag(points, stroke) {
      if (points.length === 0) return "";
      let d = `M ${fmtNum(points[0][0])} ${fmtNum(points[0][1])}`;
      for (let i = 1; i < points.length; i++) {
        d += ` L ${fmtNum(points[i][0])} ${fmtNum(points[i][1])}`;
      }
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${fmtNum(strokeWidth)}"/>`;
    }

    let body = "";

    if (ast.type === "Spline" || ast.type === "spline") {
      ast.equations.forEach((path) => {
        const stroke = resolveStroke(path.color_style || path.color_rgb);
        path.data.forEach((eq) => {
          const points = [];
          for (let t = 0; t <= 1; t += 0.02) {
            const x =
              eq.x_poly[0] + eq.x_poly[1] * t + eq.x_poly[2] * t * t + eq.x_poly[3] * t * t * t;
            const y =
              eq.y_poly[0] + eq.y_poly[1] * t + eq.y_poly[2] * t * t + eq.y_poly[3] * t * t * t;
            points.push([x, y]);
          }
          body += pathTag(points, stroke);
        });
      });
    } else if (ast.type === "Fourier" || ast.type === "fourier") {
      ast.strokes.forEach((stroke) => {
        const strokeColor = resolveStroke(stroke.color_style || stroke.color_rgb);
        const points = [];
        const steps = Math.min(stroke.data.length * 4, 2000);
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          let x = 0,
            y = 0;
          stroke.data.forEach((term) => {
            x += term.amplitude * Math.cos(term.frequency * t + term.phase);
            y += term.amplitude * Math.sin(term.frequency * t + term.phase);
          });
          points.push([x, y]);
        }
        body += pathTag(points, strokeColor);
      });
    } else if (ast.type === "Polyline" || ast.type === "polyline") {
      ast.paths.forEach((path) => {
        const stroke = resolveStroke(path.color_style || path.color_rgb);
        const points = path.data.map((pt) => [pt.x, pt.y]);
        body += pathTag(points, stroke);
      });
    }

    const defsMarkup = defs.length ? `<defs>${defs.join("")}</defs>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${defsMarkup}${body}\n</svg>\n`;
  }

  // --- Event Listeners ---
  els.resetViewBtn.addEventListener("click", () => {
    resetViewport();
    requestRender();
  });
  els.gridCheck.addEventListener("change", () => {
    els.canvasArea.classList.toggle("show-grid", els.gridCheck.checked);
  });
  function syncExportFormatState() {
    if (els.bgTransparentCheck.checked && els.exportFormat.value === "jpg")
      els.exportFormat.value = "png";
    Array.from(els.exportFormat.options).find((o) => o.value === "jpg").disabled =
      els.bgTransparentCheck.checked;
  }
  els.bgTransparentCheck.addEventListener("change", () => {
    syncExportFormatState();
    requestRender();
  });

  els.colorCheck.addEventListener("change", () => {
    document
      .getElementById("colorOptionsContainer")
      .classList.toggle("hidden", !els.colorCheck.checked);
    recacheViewportCanvas();
    requestRender();
  });

  els.colorDepthSelect.addEventListener("change", () => {
    recacheViewportCanvas();
    requestRender();
  });

  els.colorSpaceSelect.addEventListener("change", () => {
    recacheViewportCanvas();
    requestRender();
  });

  els.btnZoomIn.onclick = () => {
    const r = els.canvasArea.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
  };
  els.btnZoomOut.onclick = () => {
    const r = els.canvasArea.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8);
  };
  els.btnResetViewObj.onclick = () => {
    resetViewport();
    requestRender();
  };
  els.btnFocus.onclick = () => {
    document.body.classList.toggle("focus-mode");
    els.btnFocus.innerText = document.body.classList.contains("focus-mode") ? "X" : "F";
    setTimeout(() => {
      resetViewport();
      requestRender();
    }, 100);
  };

  els.downloadBtn.addEventListener("click", () => {
    if (!activePreviewId) return showError(window.t8("No Image Selected!", "未选择图片！"));
    const format = els.exportFormat.value;
    const isOriginal = activePreviewId === "original";
    const res = isOriginal
      ? { width: originalImageObj.width, height: originalImageObj.height }
      : previewDataStore.get(activePreviewId);
    const baseName = currentFilename.split(".")[0] || "image";
    let finalFilename =
      baseName +
      (isOriginal
        ? "_original"
        : `_vecto_${els.modeSelect.value.toUpperCase()}_D${els.detailRange.value}`);

    function triggerDownload(href, filename) {
      const link = document.createElement("a");
      link.download = filename;
      link.href = href;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    if (format === "json") {
      if (isOriginal)
        return showError(window.t8("No JSON for original!", "原图没有可导出的 JSON！"));
      const blob = new Blob([JSON.stringify(res.ast)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${finalFilename}.json`);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      return;
    }

    if (format === "svg") {
      if (isOriginal) return showError(window.t8("No SVG for original!", "原图没有可导出的 SVG！"));
      const svgString = astToSvgString(
        res.ast,
        res.width,
        res.height,
        document.body.classList.contains("dark-theme"),
      );
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${finalFilename}.svg`);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = res.width;
    canvas.height = res.height;
    const eCtx = canvas.getContext("2d");
    if (!els.bgTransparentCheck.checked || format === "jpg") {
      eCtx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
      eCtx.fillRect(0, 0, res.width, res.height);
    }
    if (isOriginal) eCtx.drawImage(originalImageObj, 0, 0);
    else drawAST(eCtx, res.ast, false, document.body.classList.contains("dark-theme"), true);
    triggerDownload(
      canvas.toDataURL(format === "jpg" ? "image/jpeg" : "image/png"),
      `${finalFilename}.${format}`,
    );
  });

  // ── COPY to clipboard ─────────────────────────────────────────────────
  els.copyBtn.addEventListener("click", async () => {
    if (!activePreviewId || activePreviewId === "original")
      return showError(window.t8("No render selected!", "未选择渲染结果！"));
    const res = previewDataStore.get(activePreviewId);
    const offscreen = document.createElement("canvas");
    offscreen.width = res.width;
    offscreen.height = res.height;
    const oCtx = offscreen.getContext("2d");
    if (!els.bgTransparentCheck.checked) {
      oCtx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
      oCtx.fillRect(0, 0, res.width, res.height);
    }
    drawAST(oCtx, res.ast, false, document.body.classList.contains("dark-theme"), true);
    try {
      offscreen.toBlob(async (blob) => {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        const orig = els.copyBtn.innerText;
        els.copyBtn.innerText = window.t8("COPIED!", "已复制！");
        setTimeout(() => {
          els.copyBtn.innerText = orig;
        }, 1500);
      }, "image/png");
    } catch (e) {
      showError(window.t8("Copy failed: ", "复制失败：") + e.message);
    }
  });

  // ── Restore from JSON ─────────────────────────────────────────────────
  els.restoreJsonInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const ast = JSON.parse(text);
      if (!ast || !ast.type)
        return showError(
          window.t8("Invalid JSON: missing AST type field.", "无效的 JSON：缺少 AST 类型字段。"),
        );
      const id = "restored_" + Date.now();
      // Width/height: infer from bounding_box if present, else fallback
      const bb = ast.bounding_box || ast.equations?.[0]?.bounding_box;
      const w = bb ? Math.round(Math.abs(bb[2] - bb[0])) || 800 : 800;
      const h = bb ? Math.round(Math.abs(bb[3] - bb[1])) || 400 : 400;
      const result = { ast, width: w, height: h };
      previewDataStore.set(id, result);
      const thumb = document.createElement("canvas");
      thumb.width = 120;
      thumb.height = 60;
      const tCtx = thumb.getContext("2d");
      tCtx.fillStyle = document.body.classList.contains("dark-theme") ? "#000" : "#fff";
      tCtx.fillRect(0, 0, 120, 60);
      const scale = Math.min(120 / w, 60 / h);
      tCtx.save();
      tCtx.scale(scale, scale);
      drawAST(tCtx, ast, true, document.body.classList.contains("dark-theme"));
      tCtx.restore();
      addGalleryItem(id, thumb.toDataURL(), file.name.replace(/\.json$/i, ""));
      setActivePreview(id);
      currentFilename = file.name.replace(/\.json$/i, ".png");
    } catch (err) {
      showError(window.t8("Failed to load JSON: ", "JSON 加载失败：") + err.message);
    }
    e.target.value = "";
  });
  document.getElementById("cancelShareBtn").addEventListener("click", () => {
    if (window.turnstile) window.turnstile.reset("#turnstile-widget");
    els.shareDialog.close();
  });

  els.shareBtn.addEventListener("click", () => {
    if (!activePreviewId || activePreviewId === "original") {
      return showError(
        window.t8(
          "Generate a mathematical rendering first, then select it to share!",
          "请先生成数学渲染结果，再选中它进行分享！",
        ),
      );
    }
    if (window.turnstile) window.turnstile.reset("#turnstile-widget");
    els.shareDialog.showModal();
  });

  document.getElementById("confirmShareBtn").addEventListener("click", async () => {
    const title = document.getElementById("share_title").value.trim();
    const author = document.getElementById("share_author").value.trim();
    const source = document.getElementById("share_source").value.trim();

    if (!title || !author) {
      return showError(window.t8("Title and Author Name are required!", "标题和作者名为必填项！"));
    }

    // Verify Turnstile Token
    const turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value;
    if (!turnstileToken) {
      return showError(
        window.t8("Security check (Turnstile) is incomplete!", "安全验证（Turnstile）未完成！"),
      );
    }

    const res = previewDataStore.get(activePreviewId);
    if (!res || !res.ast)
      return showError(window.t8("No rendered preview found!", "未找到已渲染的预览！"));

    const confirmBtn = document.getElementById("confirmShareBtn");
    confirmBtn.innerText = window.t8("UPLOADING...", "上传中…");
    confirmBtn.disabled = true;

    try {
      // Generate 300px-wide WebP thumbnail
      const thumbSize = 300;
      const aspect = res.width / res.height;
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = thumbSize;
      thumbCanvas.height = Math.round(thumbSize / aspect);
      const tCtx = thumbCanvas.getContext("2d");
      tCtx.fillStyle = "#ffffff";
      tCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      const s = thumbSize / res.width;
      tCtx.scale(s, s);
      drawAST(tCtx, res.ast, true, false);

      const thumbBlob = await new Promise((resolve) =>
        thumbCanvas.toBlob(resolve, "image/webp", 0.82),
      );
      const astJson = JSON.stringify(res.ast);
      // Gzip-compress AST to reduce payload (fflate loaded as global script)
      let astBlob;
      try {
        const enc = new TextEncoder();
        const raw = enc.encode(astJson);
        const compressed = window.fflate.gzipSync(raw, { level: 1 });
        // Use octet-stream (not application/gzip) for CF Workers multipart compat
        astBlob = new Blob([compressed], { type: "application/octet-stream" });
      } catch (_) {
        // Fallback: send uncompressed as octet-stream for CF Workers compat
        // (application/json or text/* types get parsed as strings, not Files)
        astBlob = new Blob([astJson], { type: "application/octet-stream" });
      }

      const formData = new FormData();
      formData.append("title", title);
      formData.append("author_name", author);
      formData.append("source_url", source);
      formData.append("aspect_ratio", String(aspect));
      formData.append("cf-turnstile-response", turnstileToken);
      formData.append(
        "ast_json",
        astBlob,
        astBlob.type === "application/gzip" ? "ast.json.gz" : "ast.json",
      );
      formData.append("thumbnail", thumbBlob, "thumb.webp");

      const postRes = await fetch("/api/gallery/submit", {
        method: "POST",
        body: formData,
      });

      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}));
        throw new Error(err.error || window.t8("Submission failed.", "提交失败。"));
      }

      alert(
        window.t8(
          "Artwork shared! It will appear in the gallery after review.",
          "分享成功！作品将在审核通过后出现在画廊。",
        ),
      );
      els.shareDialog.close();
      document.getElementById("share_title").value = "";
      document.getElementById("share_author").value = "";
      document.getElementById("share_source").value = "";
    } catch (err) {
      showError(window.t8("Share error: ", "分享出错：") + err.message);
    } finally {
      if (window.turnstile) window.turnstile.reset("#turnstile-widget");
      confirmBtn.innerText = window.t8("Submit", "提交");
      confirmBtn.disabled = false;
    }
  });

  const STORAGE_KEY = "vectomancy_user_settings";
  function saveSettings() {
    try {
      const settings = {
        mode: els.modeSelect.value,
        color: els.colorCheck.checked,
        simplify_math: els.simplifyCheck.checked,
        colorDepth: els.colorDepthSelect.value,
        colorSpace: els.colorSpaceSelect.value,
        grid: els.gridCheck.checked,
        transparent: els.bgTransparentCheck.checked,
        detail: els.detailRange.value,
        minPath: els.minPathRange.value,
        strokeWeight: els.strokeRange.value,
        terms: els.termsRange.value,
        chaikin: els.chaikinRange.value,
        exportFormat: els.exportFormat.value,
        revealMode: els.revealModeSelect.value,
        revealDuration: els.revealDurationRange.value,
        revealStaged: els.revealStagedCheck.checked,
        revealColorStrategy: els.revealColorStrategySelect.value,
        revealColorLag: els.revealColorLagRange.value,
        theme: document.body.classList.contains("dark-theme") ? "dark" : "light",
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      localStorage.setItem("vectomancy_theme", settings.theme);
    } catch (e) {
      console.error("Failed to save settings to localStorage:", e);
    }
  }

  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      let settings = {};
      if (stored) {
        try {
          settings = JSON.parse(stored);
        } catch (e) {}
      }
      const sharedTheme = localStorage.getItem("vectomancy_theme");
      if (sharedTheme) {
        settings.theme = sharedTheme;
      }
      if (settings.mode !== undefined) els.modeSelect.value = settings.mode;
      if (settings.color !== undefined) els.colorCheck.checked = settings.color;
      if (settings.simplify_math !== undefined) els.simplifyCheck.checked = settings.simplify_math;
      if (settings.colorDepth !== undefined) els.colorDepthSelect.value = settings.colorDepth;
      if (settings.colorSpace !== undefined) els.colorSpaceSelect.value = settings.colorSpace;
      if (settings.grid !== undefined) els.gridCheck.checked = settings.grid;
      if (settings.transparent !== undefined) els.bgTransparentCheck.checked = settings.transparent;
      if (settings.detail !== undefined) els.detailRange.value = settings.detail;
      if (settings.minPath !== undefined) els.minPathRange.value = settings.minPath;
      if (settings.strokeWeight !== undefined) els.strokeRange.value = settings.strokeWeight;
      if (settings.terms !== undefined) els.termsRange.value = settings.terms;
      if (settings.chaikin !== undefined) els.chaikinRange.value = settings.chaikin;
      if (settings.exportFormat !== undefined) els.exportFormat.value = settings.exportFormat;
      if (settings.revealMode !== undefined) els.revealModeSelect.value = settings.revealMode;
      if (settings.revealDuration !== undefined)
        els.revealDurationRange.value = settings.revealDuration;
      if (settings.revealStaged !== undefined) {
        els.revealStagedCheck.checked = settings.revealStaged;
        els.revealColorOptions.classList.toggle("hidden", !els.revealStagedCheck.checked);
      }
      if (settings.revealColorStrategy !== undefined)
        els.revealColorStrategySelect.value = settings.revealColorStrategy;
      if (settings.revealColorLag !== undefined)
        els.revealColorLagRange.value = settings.revealColorLag;

      if (settings.theme === "dark") {
        document.body.classList.add("dark-theme");
        [els.deleteDialog, els.clearDialog, els.errorDialog, els.helpDialog].forEach((d) =>
          d.classList.add("is-dark"),
        );
        document
          .querySelectorAll(
            ".nes-input, .nes-checkbox, .nes-radio, .nes-select select, .nes-btn:not(.is-primary):not(.is-success):not(.is-error):not(.is-warning)",
          )
          .forEach((el) => {
            el.classList.add("is-dark");
          });
      } else if (settings.theme === "light") {
        document.body.classList.remove("dark-theme");
        [els.deleteDialog, els.clearDialog, els.errorDialog, els.helpDialog].forEach((d) =>
          d.classList.remove("is-dark"),
        );
        document
          .querySelectorAll(
            ".nes-input, .nes-checkbox, .nes-radio, .nes-select select, .nes-btn:not(.is-primary):not(.is-success):not(.is-error):not(.is-warning)",
          )
          .forEach((el) => {
            el.classList.remove("is-dark");
          });
      }
    } catch (e) {
      console.error("Failed to load settings from localStorage:", e);
    }
  }

  // Listen for setting updates to persist them
  [
    els.modeSelect,
    els.colorCheck,
    els.simplifyCheck,
    els.colorDepthSelect,
    els.colorSpaceSelect,
    els.gridCheck,
    els.bgTransparentCheck,
    els.detailRange,
    els.minPathRange,
    els.strokeRange,
    els.termsRange,
    els.chaikinRange,
    els.exportFormat,
  ].forEach((el) => {
    el.addEventListener("input", saveSettings);
    el.addEventListener("change", saveSettings);
  });

  // Load settings and synchronize state
  loadSettings();
  updateLabels();
  syncExportFormatState();
  document
    .getElementById("colorOptionsContainer")
    .classList.toggle("hidden", !els.colorCheck.checked);

  // Listen to changes to adjust visibility of color depth/space containers
  els.colorCheck.addEventListener("change", () => {
    document
      .getElementById("colorOptionsContainer")
      .classList.toggle("hidden", !els.colorCheck.checked);
  });

  run();
}
