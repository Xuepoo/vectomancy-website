// typography-page.js — extracted from templates/typography.html (behavior must stay identical)
export function startTypographyPage(deps) {
  const { init, process_text, RevealAnimator } = deps;
  let isWasmLoaded = false;
  let currentFontBytes = null;
  let currentFontFilename = "";
  let previewDataStore = new Map();
  let activePreviewId = null;
  let cachedViewportCanvas = null;

  let currentGradient = {
    stops: [
      [0.0, [1.0, 0.1, 0.1]], // Reddish
      [0.5, [0.1, 1.0, 0.1]], // Greenish
      [1.0, [0.1, 0.1, 1.0]], // Blueish
    ],
    start_pos: [0.1, 0.5],
    end_pos: [0.9, 0.5],
  };
  let snapshotCount = 0;
  let pendingDeleteId = null;
  let zipFonts = [];
  let importedFontFamily = null;
  let importedFontBytes = null;

  window.__debug = {
    get currentFontBytes() {
      return currentFontBytes;
    },
    set currentFontBytes(val) {
      currentFontBytes = val;
    },
    get isWasmLoaded() {
      return isWasmLoaded;
    },
    get currentFontFilename() {
      return currentFontFilename;
    },
    process_text: process_text,
    get previewDataStore() {
      return previewDataStore;
    },
    saveSettings: () => saveSettings(),
    loadSettings: () => loadSettings(),
    get currentGradient() {
      return currentGradient;
    },
  };

  let scale = 1,
    offsetX = 0,
    offsetY = 0;
  let isDragging = false,
    dragStart = { x: 0, y: 0 };
  let renderRequested = false;
  let revealOrigin = null;
  let revealAnimator = null;

  const els = {
    textInput: document.getElementById("textInput"),
    fontInput: document.getElementById("fontInput"),
    fontImportUrl: document.getElementById("fontImportUrl"),
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
    colorTypeSelect: document.getElementById("colorTypeSelect"),
    solidColorInput: document.getElementById("solidColorInput"),
    solidColorEditor: document.getElementById("solidColorEditor"),
    paletteEditor: document.getElementById("paletteEditor"),
    palettePresets: document.getElementById("palettePresets"),
    customStopsContainer: document.getElementById("customStopsContainer"),
    addStopBtn: document.getElementById("addStopBtn"),
    flowSpeedRange: document.getElementById("flowSpeedRange"),
    flowSpeedVal: document.getElementById("flowSpeedVal"),
    colorStyleControls: document.getElementById("colorStyleControls"),
    gridCheck: document.getElementById("gridCheck"),
    detailRange: document.getElementById("detailRange"),
    minPathRange: document.getElementById("minPathRange"),
    strokeRange: document.getElementById("strokeRange"),
    letterSpacingRange: document.getElementById("letterSpacingRange"),
    termsRange: document.getElementById("termsRange"),
    chaikinRange: document.getElementById("chaikinRange"),
    fourierControls: document.getElementById("fourier-controls"),
    chaikinControls: document.getElementById("chaikin-controls"),
    detailVal: document.getElementById("detailVal"),
    minPathVal: document.getElementById("minPathVal"),
    letterSpacingVal: document.getElementById("letterSpacingVal"),
    termsVal: document.getElementById("termsVal"),
    chaikinVal: document.getElementById("chaikinVal"),
    overlayStats: document.getElementById("overlayStats"),
    exportFormat: document.getElementById("exportFormat"),
    bgTransparentCheck: document.getElementById("bgTransparentCheck"),
    hideHandlesCheck: document.getElementById("hideHandlesCheck"),
    downloadBtn: document.getElementById("downloadBtn"),
    copyBtn: document.getElementById("copyBtn"),
    restoreJsonInput: document.getElementById("restoreJsonInput"),
    loaderOverlay: document.getElementById("loaderOverlay"),
    loaderText: document.getElementById("loaderText"),
    progressContainer: document.getElementById("progressContainer"),
    progressBar: document.getElementById("progressBar"),
    deleteDialog: document.getElementById("delete-dialog"),
    clearDialog: document.getElementById("clear-dialog"),
    errorDialog: document.getElementById("error-dialog"),
    errorMessage: document.getElementById("error-message"),
    zipFontDialog: document.getElementById("zipFontDialog"),
    zipFontSelect: document.getElementById("zipFontSelect"),
    btnAccessLocalFonts: document.getElementById("btnAccessLocalFonts"),
    localFontSelectWrapper: document.getElementById("localFontSelectWrapper"),
    localFontSelect: document.getElementById("localFontSelect"),
    btnZoomIn: document.getElementById("btnZoomIn"),
    btnZoomOut: document.getElementById("btnZoomOut"),
    btnResetViewObj: document.getElementById("btnResetViewObj"),
    btnFocus: document.getElementById("btnFocus"),
    resetSettingsBtn: document.getElementById("resetSettingsBtn"),
    sizeModeSelect: document.getElementById("sizeModeSelect"),
    resolutionScaleRange: document.getElementById("resolutionScaleRange"),
    autoSizeControls: document.getElementById("auto-size-controls"),
    customSizeControls: document.getElementById("custom-size-controls"),
    customWidthInput: document.getElementById("customWidthInput"),
    customHeightInput: document.getElementById("customHeightInput"),
    keepAspectRatioCheck: document.getElementById("keepAspectRatioCheck"),
    targetSizeDisplay: document.getElementById("targetSizeDisplay"),
    resScaleVal: document.getElementById("resScaleVal"),
    revealModeSelect: document.getElementById("revealModeSelect"),
    revealDurationRange: document.getElementById("revealDurationRange"),
    revealDurationVal: document.getElementById("revealDurationVal"),
    revealStagedCheck: document.getElementById("revealStagedCheck"),
    revealColorOptions: document.getElementById("revealColorOptions"),
    revealColorStrategySelect: document.getElementById("revealColorStrategySelect"),
    revealColorLagRange: document.getElementById("revealColorLagRange"),
    revealColorLagVal: document.getElementById("revealColorLagVal"),
    replayBtn: document.getElementById("replayBtn"),
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
      await restoreCachedFont();

      // Set default input text if empty
      if (!els.textInput.value) {
        els.textInput.value = "Hello, World! ";
      }

      // If no font cached, trigger click on default "PressStart2P"
      if (!currentFontBytes) {
        const defaultPreset = document.querySelector(
          '.font-preset-btn[data-filename="PressStart2P"]',
        );
        if (defaultPreset) {
          defaultPreset.click();
        }
      } else {
        // Trigger render immediately
        els.generateBtn.click();
      }
    } catch (e) {
      els.statusText.innerText = window.t8("ERR: LOAD", "错误：加载失败");
      console.error(e);
    }
  }

  run();

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255.0;
    const g = parseInt(hex.slice(3, 5), 16) / 255.0;
    const b = parseInt(hex.slice(5, 7), 16) / 255.0;
    return [r, g, b];
  }

  function rgbToHex(r, g, b) {
    const hexR = Math.min(255, Math.max(0, Math.round(r * 255)))
      .toString(16)
      .padStart(2, "0");
    const hexG = Math.min(255, Math.max(0, Math.round(g * 255)))
      .toString(16)
      .padStart(2, "0");
    const hexB = Math.min(255, Math.max(0, Math.round(b * 255)))
      .toString(16)
      .padStart(2, "0");
    return `#${hexR}${hexG}${hexB}`;
  }

  const premiumPresets = [
    {
      name: "Sunset",
      stops: [
        [0.0, [1.0, 0.35, 0.11]],
        [0.5, [0.93, 0.11, 0.4]],
        [1.0, [0.47, 0.1, 0.61]],
      ],
    },
    {
      name: "Ocean",
      stops: [
        [0.0, [0.0, 0.73, 0.83]],
        [0.5, [0.0, 0.47, 0.8]],
        [1.0, [0.01, 0.18, 0.36]],
      ],
    },
    {
      name: "Neon",
      stops: [
        [0.0, [1.0, 0.0, 0.5]],
        [0.5, [0.5, 0.0, 1.0]],
        [1.0, [0.0, 1.0, 1.0]],
      ],
    },
    {
      name: "Retro",
      stops: [
        [0.0, [0.95, 0.77, 0.06]],
        [0.5, [0.91, 0.3, 0.24]],
        [1.0, [0.17, 0.45, 0.34]],
      ],
    },
  ];

  function renderPalettePresets() {
    if (!els.palettePresets) return;
    els.palettePresets.innerHTML = "";
    premiumPresets.forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nes-btn";
      btn.style.fontSize = "8px";
      btn.style.padding = "4px 6px";
      btn.innerText = preset.name;
      btn.onclick = () => {
        currentGradient.stops = preset.stops.map((s) => [s[0], [...s[1]]]);
        updateColorStyleOnAst();
        renderStopsEditor();
      };
      els.palettePresets.appendChild(btn);
    });
  }

  function renderStopsEditor() {
    if (!els.customStopsContainer) return;
    els.customStopsContainer.innerHTML = "";
    currentGradient.stops.forEach((stop, index) => {
      const offset = stop[0];
      const color = stop[1];
      const hexColor = rgbToHex(color[0], color[1], color[2]);

      const stopRow = document.createElement("div");
      stopRow.style.display = "flex";
      stopRow.style.alignItems = "center";
      stopRow.style.gap = "8px";

      // Color picker input
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.setAttribute(
        "aria-label",
        window.t8(`Gradient stop ${index + 1} color`, `渐变节点 ${index + 1} 颜色`),
      );
      colorInput.value = hexColor;
      colorInput.style.padding = "0";
      colorInput.style.border = "none";
      colorInput.style.width = "30px";
      colorInput.style.height = "20px";
      colorInput.style.cursor = "pointer";
      colorInput.onchange = (e) => {
        const rgb = hexToRgb(e.target.value);
        currentGradient.stops[index][1] = rgb;
        updateColorStyleOnAst();
      };

      // Offset slider
      const offsetInput = document.createElement("input");
      offsetInput.type = "range";
      offsetInput.min = "0";
      offsetInput.max = "100";
      offsetInput.value = Math.round(offset * 100);
      offsetInput.style.flex = "1";
      offsetInput.setAttribute(
        "aria-label",
        window.t8(`Gradient stop ${index + 1} position`, `渐变节点 ${index + 1} 位置`),
      );
      offsetInput.className = "nes-range";
      offsetInput.oninput = (e) => {
        currentGradient.stops[index][0] = parseFloat(e.target.value) / 100.0;
        updateColorStyleOnAst();
      };

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "nes-btn is-error";
      delBtn.style.fontSize = "8px";
      delBtn.style.padding = "2px 6px";
      delBtn.innerText = "X";
      delBtn.onclick = () => {
        currentGradient.stops.splice(index, 1);
        updateColorStyleOnAst();
        renderStopsEditor();
      };

      stopRow.appendChild(colorInput);
      stopRow.appendChild(offsetInput);
      if (currentGradient.stops.length > 2) {
        stopRow.appendChild(delBtn);
      }
      els.customStopsContainer.appendChild(stopRow);
    });
  }

  if (els.addStopBtn) {
    els.addStopBtn.onclick = () => {
      if (currentGradient.stops.length >= 2) {
        const lastStop = currentGradient.stops[currentGradient.stops.length - 1];
        const newOffset = Math.min(1.0, lastStop[0] + 0.1);
        const newColor = [...lastStop[1]];
        currentGradient.stops.push([newOffset, newColor]);
        currentGradient.stops.sort((a, b) => a[0] - b[0]);
        updateColorStyleOnAst();
        renderStopsEditor();
      }
    };
  }

  if (els.solidColorInput) {
    els.solidColorInput.addEventListener("change", updateColorStyleOnAst);
    els.solidColorInput.addEventListener("input", updateColorStyleOnAst);
  }

  function getActiveAspectRatio() {
    if (activePreviewId) {
      const res = previewDataStore.get(activePreviewId);
      if (res && res.width > 0 && res.height > 0) {
        return res.width / res.height;
      }
    }
    return 6.0;
  }

  function getTargetDimensions(baseWidth, baseHeight) {
    const sizeMode = els.sizeModeSelect.value;
    if (sizeMode === "auto") {
      const scale = parseInt(els.resolutionScaleRange.value) || 2;
      return {
        width: Math.round(baseWidth * scale),
        height: Math.round(baseHeight * scale),
      };
    } else {
      const w = parseInt(els.customWidthInput.value) || 1024;
      const h = parseInt(els.customHeightInput.value) || 256;
      return { width: w, height: h };
    }
  }

  function updateLabels() {
    els.detailVal.innerText = els.detailRange.value;
    els.minPathVal.innerText = els.minPathRange.value;
    els.letterSpacingVal.innerText = els.letterSpacingRange.value;
    els.termsVal.innerText = els.termsRange.value;
    els.chaikinVal.innerText = els.chaikinRange.value;
    els.revealDurationVal.innerText = `${parseFloat(els.revealDurationRange.value).toFixed(1)}s`;
    els.revealColorLagVal.innerText = `${els.revealColorLagRange.value}%`;
    if (els.flowSpeedVal && els.flowSpeedRange) {
      els.flowSpeedVal.innerText = els.flowSpeedRange.value;
    }
    const mode = els.modeSelect.value;
    els.fourierControls.classList.toggle("hidden", mode !== "fourier");
    els.chaikinControls.classList.toggle("hidden", mode !== "chaikin");

    const hasColor = els.colorCheck.checked;
    if (els.colorStyleControls) {
      els.colorStyleControls.classList.toggle("hidden", !hasColor);
    }
    const colorType = els.colorTypeSelect ? els.colorTypeSelect.value : "gradient";
    if (els.solidColorEditor) {
      els.solidColorEditor.classList.toggle("hidden", colorType !== "solid" || !hasColor);
    }
    if (els.paletteEditor) {
      els.paletteEditor.classList.toggle("hidden", colorType !== "gradient" || !hasColor);
    }
    const flowControls = document.getElementById("flow-controls");
    if (flowControls) {
      flowControls.classList.toggle("hidden", colorType !== "gradient" || !hasColor);
    }

    els.resScaleVal.innerText = `${els.resolutionScaleRange.value}x`;
    if (activePreviewId) {
      const res = previewDataStore.get(activePreviewId);
      if (res) {
        const dims = getTargetDimensions(res.width, res.height);
        els.targetSizeDisplay.innerText = `${dims.width} x ${dims.height} px`;
      } else {
        els.targetSizeDisplay.innerText = "-";
      }
    } else {
      els.targetSizeDisplay.innerText = window.t8("Waiting for render...", "等待渲染…");
    }
  }

  [
    els.detailRange,
    els.minPathRange,
    els.letterSpacingRange,
    els.termsRange,
    els.chaikinRange,
    els.modeSelect,
    els.colorCheck,
    els.colorTypeSelect,
    els.flowSpeedRange,
    els.revealDurationRange,
    els.revealColorLagRange,
  ].forEach((el) => {
    if (el) el.addEventListener("input", updateLabels);
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
      if (el === els.revealStagedCheck) {
        els.revealColorOptions.classList.toggle("hidden", !els.revealStagedCheck.checked);
      }
      recacheViewportCanvas();
      requestRender();
      saveSettings();
    }),
  );

  els.replayBtn.addEventListener("click", () => {
    recacheViewportCanvas();
    requestRender();
  });
  if (els.strokeRange) {
    els.strokeRange.addEventListener("input", () => {
      validateStrokeRange();
      recacheViewportCanvas();
      requestRender();
    });
  }

  function validateStrokeRange() {
    const input = els.strokeRange;
    const errorEl = document.getElementById("strokeError");
    if (!input || !errorEl) return;
    const v = parseFloat(input.value);
    const invalid = input.value === "" || isNaN(v) || v < 0 || v > 10;
    input.classList.toggle("is-error", invalid);
    errorEl.style.display = invalid ? "block" : "none";
  }

  function updateColorStyleOnAst() {
    saveSettings();
    if (!activePreviewId) return;
    const res = previewDataStore.get(activePreviewId);
    if (!res || !res.ast) return;

    const colorStyleVal = els.colorCheck.checked
      ? els.colorTypeSelect.value === "gradient"
        ? {
            stops: currentGradient.stops.map((s) => [s[0], s[1]]),
            start_pos: currentGradient.start_pos,
            end_pos: currentGradient.end_pos,
          }
        : hexToRgb(els.solidColorInput.value)
      : null;

    const paths = res.ast.equations || res.ast.strokes || res.ast.paths || [];
    paths.forEach((path) => {
      path.color_style = colorStyleVal;
      path.color_rgb = colorStyleVal;
    });

    res.cachedPaths = null; // Invalidate cache so it rebuilds!
    recacheViewportCanvas();
    requestRender();
  }

  if (els.colorCheck) els.colorCheck.addEventListener("change", updateColorStyleOnAst);
  if (els.colorTypeSelect) els.colorTypeSelect.addEventListener("change", updateColorStyleOnAst);

  els.sizeModeSelect.addEventListener("change", () => {
    const mode = els.sizeModeSelect.value;
    els.autoSizeControls.classList.toggle("hidden", mode !== "auto");
    els.customSizeControls.classList.toggle("hidden", mode !== "custom");
    updateLabels();
    recacheViewportCanvas();
    requestRender();
  });

  els.resolutionScaleRange.addEventListener("input", () => {
    updateLabels();
    recacheViewportCanvas();
    requestRender();
  });

  els.customWidthInput.addEventListener("input", () => {
    if (els.keepAspectRatioCheck.checked) {
      const ratio = getActiveAspectRatio();
      if (ratio > 0) {
        const w = parseInt(els.customWidthInput.value) || 0;
        els.customHeightInput.value = Math.max(1, Math.round(w / ratio));
      }
    }
    updateLabels();
    recacheViewportCanvas();
    requestRender();
  });

  els.customHeightInput.addEventListener("input", () => {
    if (els.keepAspectRatioCheck.checked) {
      const ratio = getActiveAspectRatio();
      if (ratio > 0) {
        const h = parseInt(els.customHeightInput.value) || 0;
        els.customWidthInput.value = Math.max(1, Math.round(h * ratio));
      }
    }
    updateLabels();
    recacheViewportCanvas();
    requestRender();
  });

  els.keepAspectRatioCheck.addEventListener("change", () => {
    if (els.keepAspectRatioCheck.checked) {
      const ratio = getActiveAspectRatio();
      if (ratio > 0) {
        const w = parseInt(els.customWidthInput.value) || 1024;
        els.customHeightInput.value = Math.max(1, Math.round(w / ratio));
      }
    }
    updateLabels();
    recacheViewportCanvas();
    requestRender();
  });

  els.themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    [els.deleteDialog, els.clearDialog, els.errorDialog, els.helpDialog].forEach((d) =>
      d.classList.toggle("is-dark"),
    );
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

  // --- Font IndexedDB Cache ---
  const DB_NAME = "VectomancyFontDB";
  const DB_VERSION = 1;
  function openFontDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("fonts")) db.createObjectStore("fonts");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveFontCache(name, arrayBuffer) {
    const db = await openFontDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("fonts", "readwrite");
      tx.objectStore("fonts").put(arrayBuffer, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function loadFontCache(name) {
    const db = await openFontDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("fonts", "readonly");
      const req = tx.objectStore("fonts").get(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(tx.error);
    });
  }
  async function deleteFontCache(name) {
    const db = await openFontDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("fonts", "readwrite");
      tx.objectStore("fonts").delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Returns true if the ArrayBuffer starts with a known TTF/OTF magic number.
  // ab_glyph only understands raw TTF/OTF — woff/woff2 will cause "InvalidFont".
  function isValidFontBuffer(buffer) {
    if (!buffer) return false;
    let buf = buffer;
    if (buffer.buffer instanceof ArrayBuffer) {
      buf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    if (buf.byteLength < 4) return false;
    const view = new DataView(buf);
    const magic = view.getUint32(0, false); // big-endian
    return (
      magic === 0x00010000 || // TrueType
      magic === 0x4f54544f || // 'OTTO' - CFF/OpenType
      magic === 0x74727565 || // 'true' - macOS TrueType
      magic === 0x74797031 || // 'typ1' - old PostScript
      magic === 0x774f4632 // 'wOF2' - WOFF2
    );
  }

  async function restoreCachedFont() {
    try {
      const buffer = await loadFontCache("last_font_bytes");
      const nameBuffer = await loadFontCache("last_font_name");
      if (buffer && nameBuffer) {
        if (!isValidFontBuffer(buffer)) {
          // Cached font is woff/woff2 or corrupted — discard it
          console.warn("Cached font has invalid format (not TTF/OTF). Clearing cache.");
          await deleteFontCache("last_font_bytes");
          await deleteFontCache("last_font_name");
          return;
        }
        currentFontBytes = new Uint8Array(buffer);
        currentFontFilename = new TextDecoder().decode(nameBuffer);
        els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
        if (currentFontFilename.endsWith(" (Web)")) {
          const cleanFamilyName = currentFontFilename.replace(" (Web)", "");
          try {
            const fontFace = new FontFace(cleanFamilyName, buffer);
            const loadedFace = await fontFace.load();
            document.fonts.add(loadedFace);

            importedFontFamily = cleanFamilyName;
            importedFontBytes = currentFontBytes;

            els.localFontSelectWrapper.style.display = "block";
            els.btnAccessLocalFonts.style.display = "none";

            const opt = document.createElement("option");
            opt.value = cleanFamilyName;
            opt.textContent = cleanFamilyName + " (Web)";
            opt.style.fontFamily = `"${cleanFamilyName}", sans-serif`;
            els.localFontSelect.appendChild(opt);

            els.localFontSelect.value = cleanFamilyName;
            els.localFontSelect.style.fontFamily = `"${cleanFamilyName}", sans-serif`;
          } catch (err) {
            console.error("Failed to register cached web font:", err);
          }
        }
      }
    } catch (e) {
      console.error("No cached font found.", e);
    }
  }

  // --- Local Font Access API ---
  let localFontsList = [];
  els.btnAccessLocalFonts.addEventListener("click", async () => {
    try {
      if (!("queryLocalFonts" in window)) {
        throw new Error(
          "Local Font Access API is not supported in your browser (try Chrome/Edge desktop).",
        );
      }
      els.loaderOverlay.classList.remove("hidden");
      els.loaderText.innerText = window.t8("Requesting Font Access...", "正在请求字体访问权限…");
      localFontsList = await window.queryLocalFonts();

      els.localFontSelectWrapper.style.display = "block";
      els.btnAccessLocalFonts.style.display = "none";
      els.localFontSelect.innerHTML =
        '<option value="" disabled selected>Select system font...</option>';

      const familyMap = new Map();
      for (const f of localFontsList) {
        if (!familyMap.has(f.family)) familyMap.set(f.family, f);
      }
      Array.from(familyMap.keys())
        .sort()
        .forEach((family) => {
          const opt = document.createElement("option");
          opt.value = family;
          opt.textContent = family;
          opt.style.fontFamily = `"${family}", sans-serif`;
          els.localFontSelect.appendChild(opt);
        });

      // Restore selection if currently loaded font is a system font
      if (currentFontFilename && currentFontFilename.endsWith(" (System)")) {
        const family = currentFontFilename.replace(" (System)", "");
        if (familyMap.has(family)) {
          els.localFontSelect.value = family;
          els.localFontSelect.style.fontFamily = `"${family}", sans-serif`;
        }
      }

      els.loaderOverlay.classList.add("hidden");
    } catch (err) {
      els.loaderOverlay.classList.add("hidden");
      showError(
        err.message ||
          window.t8(
            "Failed to access system fonts. Permission denied?",
            "无法访问系统字体。是否权限被拒？",
          ),
      );
    }
  });

  els.localFontSelect.addEventListener("change", async () => {
    const family = els.localFontSelect.value;
    els.localFontSelect.style.fontFamily = `"${family}", sans-serif`;

    if (family === importedFontFamily && importedFontBytes) {
      currentFontBytes = importedFontBytes;
      currentFontFilename = family + " (Web)";
      els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
      await saveFontCache("last_font_bytes", importedFontBytes.buffer);
      await saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);
      if (previewDataStore.size === 0 && els.textInput.value) {
        els.generateBtn.click();
      }
      return;
    }

    const fontObj = localFontsList.find((f) => f.family === family);
    if (!fontObj) return;

    els.loaderOverlay.classList.remove("hidden");
    els.loaderText.innerText = window.t8(`Extracting ${family}...`, `正在提取 ${family}…`);
    try {
      const blob = await fontObj.blob();
      const b = await blob.arrayBuffer();
      currentFontBytes = new Uint8Array(b);
      currentFontFilename = family + " (System)";
      els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
      await saveFontCache("last_font_bytes", b);
      await saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);
    } catch (err) {
      showError(window.t8("Could not extract font data.", "无法提取字体数据。"));
    }
    els.loaderOverlay.classList.add("hidden");
  });

  els.fontInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith(".zip")) {
      els.loaderOverlay.classList.remove("hidden");
      els.loaderText.innerText = window.t8("Decompressing ZIP...", "正在解压 ZIP…");
      try {
        const arrayBuffer = await file.arrayBuffer();
        const zipBytes = new Uint8Array(arrayBuffer);
        const unzipped = fflate.unzipSync(zipBytes);

        const fontFiles = [];
        for (const [filepath, bytes] of Object.entries(unzipped)) {
          if (filepath.endsWith("/")) continue;

          const parts = filepath.split("/");
          if (parts.some((part) => part.startsWith("._") || part === "__MACOSX")) {
            continue;
          }

          const lowerPath = filepath.toLowerCase();
          const hasFontExt =
            lowerPath.endsWith(".ttf") ||
            lowerPath.endsWith(".otf") ||
            lowerPath.endsWith(".woff") ||
            lowerPath.endsWith(".woff2");
          if (hasFontExt && isValidFontBuffer(bytes)) {
            fontFiles.push({
              name: parts[parts.length - 1],
              path: filepath,
              bytes: bytes,
            });
          }
        }

        if (fontFiles.length === 0) {
          showError("No valid TTF/OTF/WOFF2 font files found in the ZIP archive.");
          els.fontInput.value = "";
        } else if (fontFiles.length === 1) {
          const selectedFont = fontFiles[0];
          const b = selectedFont.bytes.buffer.slice(
            selectedFont.bytes.byteOffset,
            selectedFont.bytes.byteOffset + selectedFont.bytes.byteLength,
          );
          currentFontBytes = new Uint8Array(b);
          currentFontFilename = selectedFont.name;
          els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
          saveFontCache("last_font_bytes", b);
          saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);
          els.fontInput.value = "";
          if (previewDataStore.size === 0 && els.textInput.value) {
            els.generateBtn.click();
          }
        } else {
          zipFonts = fontFiles;
          els.zipFontSelect.innerHTML = "";
          zipFonts.forEach((font, idx) => {
            const opt = document.createElement("option");
            opt.value = idx.toString();
            opt.textContent = font.name;
            els.zipFontSelect.appendChild(opt);
          });
          els.zipFontDialog.showModal();
        }
      } catch (err) {
        showError(
          window.t8("Could not extract ZIP archive: ", "无法解压 ZIP 压缩包：") +
            (err.message || err),
        );
        els.fontInput.value = "";
      } finally {
        els.loaderOverlay.classList.add("hidden");
      }
    } else {
      try {
        const b = await file.arrayBuffer();
        if (!isValidFontBuffer(b)) {
          showError(
            window.t8(
              "Failed to load font: Invalid font file format.",
              "字体加载失败：无效的字体文件格式。",
            ),
          );
          els.fontInput.value = "";
          return;
        }
        currentFontBytes = new Uint8Array(b);
        currentFontFilename = file.name;
        els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
        saveFontCache("last_font_bytes", b);
        saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);
        if (previewDataStore.size === 0 && els.textInput.value) {
          els.generateBtn.click();
        }
      } catch (err) {
        showError(
          window.t8("Could not read font file: ", "无法读取字体文件：") + (err.message || err),
        );
        els.fontInput.value = "";
      }
    }
  });

  els.fontImportUrl.addEventListener("change", async (e) => {
    const inputValue = e.target.value.trim();
    if (!inputValue) return;

    els.loaderOverlay.classList.remove("hidden");
    els.loaderText.innerText = window.t8("Parsing font import...", "正在解析字体导入…");

    try {
      let cssUrl = null;
      let fontUrl = null;

      // 3. Implement HTML parser logic
      if (inputValue.includes("<") && inputValue.includes(">")) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(inputValue, "text/html");
          const linkTags = doc.querySelectorAll('link[rel="stylesheet"]');
          if (linkTags.length > 0) {
            cssUrl = linkTags[0].getAttribute("href");
          } else {
            const anyLink = doc.querySelector("link[href]");
            if (anyLink) {
              cssUrl = anyLink.getAttribute("href");
            }
          }
        } catch (err) {
          console.error("DOMParser error:", err);
        }
      }

      // Fallback to regex matching for @import statements or raw URLs
      if (!cssUrl) {
        const importRegex = /@import\s+(?:url\s*\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])/i;
        const match = inputValue.match(importRegex);
        if (match) {
          cssUrl = match[1] || match[2];
        }
      }

      if (!cssUrl && !fontUrl && !inputValue.includes("<") && !inputValue.includes(">")) {
        const cleanUrl = inputValue.replace(/['"\s]/g, "");
        if (cleanUrl.toLowerCase().match(/\.(ttf|otf|woff|woff2)(?:\?.*)?$/)) {
          fontUrl = cleanUrl;
        } else {
          cssUrl = cleanUrl;
        }
      }

      if (!cssUrl && !fontUrl) {
        throw new Error("Could not find a valid CSS URL or font file URL in the input.");
      }

      let cleanFamilyName = "";
      let absoluteFontUrl = "";

      if (cssUrl) {
        // 4. Call fetch(cssUrl) to retrieve CSS stylesheet
        els.loaderText.innerText = window.t8("Fetching stylesheet...", "正在获取样式表…");
        const response = await fetch(cssUrl);
        if (!response.ok) {
          const statusText = response.statusText || `HTTP ${response.status}`;
          throw new Error(
            window.t8(
              `Failed to fetch CSS stylesheet: ${statusText}`,
              `获取 CSS 样式表失败：${statusText}`,
            ),
          );
        }
        const cssText = await response.text();

        // 5. Parse @font-face rule blocks from the CSS
        const fontFaceBlocks = [];
        let pos = 0;
        while (true) {
          const index = cssText.indexOf("@font-face", pos);
          if (index === -1) break;

          const openBrace = cssText.indexOf("{", index);
          if (openBrace === -1) {
            pos = index + 10;
            continue;
          }

          const closeBrace = cssText.indexOf("}", openBrace);
          if (closeBrace === -1) {
            pos = openBrace + 1;
            continue;
          }

          const blockContent = cssText.slice(openBrace + 1, closeBrace);
          const precedingText = cssText.slice(Math.max(0, index - 150), index);

          fontFaceBlocks.push({
            precedingText,
            content: blockContent,
          });

          pos = closeBrace + 1;
        }

        const parsedBlocks = fontFaceBlocks
          .map((block) => {
            const familyMatch = block.content.match(/font-family\s*:\s*(['"]?)(.*?)\1\s*(?:;|$)/i);
            const srcMatch = block.content.match(/src\s*:\s*[^;]*url\s*\(\s*(['"]?)(.*?)\1\s*\)/i);

            const familyName = familyMatch ? familyMatch[2].trim() : null;
            const fontSrcUrl = srcMatch ? srcMatch[2].trim() : null;

            const hasLatinComment =
              block.precedingText.toLowerCase().includes("latin") ||
              block.content.toLowerCase().includes("latin");
            const hasLatinUnicodeRange =
              block.content.includes("U+0000-00FF") ||
              block.content.includes("U+0000-00ff") ||
              block.content.includes("u+0000-00ff");

            const isLatin = hasLatinComment || hasLatinUnicodeRange;

            return {
              familyName,
              fontSrcUrl,
              isLatin,
            };
          })
          .filter((b) => b.familyName && b.fontSrcUrl);

        if (parsedBlocks.length === 0) {
          throw new Error("No valid @font-face rules found in the fetched CSS.");
        }

        // Prioritize the rule block that matches the latin subset
        parsedBlocks.sort((a, b) => {
          if (a.isLatin && !b.isLatin) return -1;
          if (!a.isLatin && b.isLatin) return 1;
          return 0;
        });

        const selectedBlock = parsedBlocks[0];
        // Clean quotes from the parsed font-family name
        cleanFamilyName = selectedBlock.familyName.replace(/['"]/g, "").trim();
        fontUrl = selectedBlock.fontSrcUrl;

        // 6. Convert relative font source URLs into absolute URLs via new URL(relativeUrl, cssUrl).href
        absoluteFontUrl = new URL(fontUrl, cssUrl).href;
      } else {
        // Raw font URL
        absoluteFontUrl = new URL(fontUrl, window.location.href).href;
        const urlParts = absoluteFontUrl.split("/");
        let fileName = urlParts[urlParts.length - 1].split("?")[0];
        cleanFamilyName = fileName.replace(/\.(ttf|otf|woff|woff2)$/i, "").trim() || "ImportedFont";
      }

      // 7. Download the font binary once as an ArrayBuffer
      els.loaderText.innerText = window.t8("Downloading font binary...", "正在下载字体文件…");
      const fontResponse = await fetch(absoluteFontUrl);
      if (!fontResponse.ok) {
        throw new Error(
          window.t8(
            `Failed to fetch font binary: ${fontResponse.statusText}`,
            `获取字体文件失败：${fontResponse.statusText}`,
          ),
        );
      }
      const arrayBuffer = await fontResponse.arrayBuffer();

      if (!isValidFontBuffer(arrayBuffer)) {
        throw new Error(
          window.t8(
            "Invalid font binary format. Must be TTF/OTF/WOFF/WOFF2.",
            "无效的字体文件格式。必须为 TTF/OTF/WOFF/WOFF2。",
          ),
        );
      }

      // Register it using new FontFace in the document
      els.loaderText.innerText = window.t8("Registering font...", "正在注册字体…");
      const fontFace = new FontFace(cleanFamilyName, arrayBuffer);
      const loadedFace = await fontFace.load();
      document.fonts.add(loadedFace);

      // 8. Bridge bytes to currentFontBytes and cache it in IndexedDB
      currentFontBytes = new Uint8Array(arrayBuffer);
      currentFontFilename = cleanFamilyName + " (Web)";
      els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);

      await saveFontCache("last_font_bytes", arrayBuffer);
      await saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);

      importedFontFamily = cleanFamilyName;
      importedFontBytes = currentFontBytes;

      // 9. Append the new font name to the #localFontSelect dropdown menu as the active selection
      els.localFontSelectWrapper.style.display = "block";
      els.btnAccessLocalFonts.style.display = "none";

      let existingOption = Array.from(els.localFontSelect.options).find(
        (opt) => opt.value === cleanFamilyName,
      );
      if (!existingOption) {
        const opt = document.createElement("option");
        opt.value = cleanFamilyName;
        opt.textContent = cleanFamilyName + " (Web)";
        opt.style.fontFamily = `"${cleanFamilyName}", sans-serif`;
        els.localFontSelect.appendChild(opt);
      }

      els.localFontSelect.value = cleanFamilyName;
      els.localFontSelect.style.fontFamily = `"${cleanFamilyName}", sans-serif`;
      els.localFontSelect.dispatchEvent(new Event("change"));

      els.fontImportUrl.value = "";

      if (previewDataStore.size === 0 && els.textInput.value) {
        els.generateBtn.click();
      }
    } catch (err) {
      let msg = err.message || err.toString() || err;
      if (msg.includes("Failed to fetch")) {
        msg +=
          " " +
          window.t8(
            "(This is likely due to CORS restrictions on the font host. Please upload the font file directly instead.)",
            "（这可能是由字体主机的 CORS 限制导致。请直接上传字体文件。）",
          );
      }
      showError(window.t8("Font import failed: ", "字体导入失败：") + msg);
      els.fontImportUrl.value = "";
    } finally {
      els.loaderOverlay.classList.add("hidden");
    }
  });

  document.querySelectorAll(".font-preset-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const url = btn.dataset.url;
      const filename = btn.dataset.filename + " (CDN)";

      els.loaderOverlay.classList.remove("hidden");
      els.loaderText.innerText = window.t8(`Fetching ${filename}...`, `正在获取 ${filename}…`);
      try {
        const r = await fetch(url + (url.includes("?") ? "&" : "?") + "v=2");
        if (!r.ok) throw new Error("HTTP Error");
        const b = await r.arrayBuffer();
        if (!isValidFontBuffer(b)) {
          throw new Error("InvalidFontFormat");
        }
        currentFontBytes = new Uint8Array(b);
        currentFontFilename = filename;
        els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
        await saveFontCache("last_font_bytes", b);
        await saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);
      } catch (err) {
        if (err.message === "InvalidFontFormat") {
          showError(
            window.t8(
              "Failed to load font: Invalid font file format.",
              "字体加载失败：无效的字体文件格式。",
            ),
          );
        } else {
          showError(
            window.t8(
              "Failed to fetch font.\nPlease check your network.",
              "获取字体失败。\n请检查网络连接。",
            ),
          );
        }
      }
      els.loaderOverlay.classList.add("hidden");
      if (previewDataStore.size === 0 && els.textInput.value) {
        els.generateBtn.click();
      }
    });
  });

  els.generateBtn.addEventListener("click", () => {
    if (!isWasmLoaded) return;
    if (!currentFontBytes)
      return showError(
        window.t8(
          "No Font Selected!\nUse System Fonts, Upload, or Cloud Presets.",
          "未选择字体！\n请使用系统字体、上传或云端预设。",
        ),
      );
    if (!els.textInput.value) return showError(window.t8("No Text entered!", "未输入文字！"));

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
        const colorStyleVal = els.colorCheck.checked
          ? els.colorTypeSelect.value === "gradient"
            ? {
                stops: currentGradient.stops.map((s) => [s[0], s[1]]),
                start_pos: currentGradient.start_pos,
                end_pos: currentGradient.end_pos,
              }
            : hexToRgb(els.solidColorInput.value)
          : null;

        const options = {
          format: "jpg",
          color: els.colorCheck.checked,
          mode: els.modeSelect.value,
          chaikin_iters: parseInt(els.chaikinRange.value),
          terms: parseInt(els.termsRange.value),
          detail: parseInt(els.detailRange.value),
          min_path_len: parseInt(els.minPathRange.value),
          color_style: colorStyleVal,
          letter_spacing: parseFloat(els.letterSpacingRange.value),
        };

        const result = process_text(currentFontBytes, els.textInput.value, options);

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
        showError(window.t8("Render failed: ", "渲染失败：") + (e.message || e.toString() || e));
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
    div.innerHTML = `<img src="${src}" alt="${label}"><div class="gallery-label">${label}</div><div class="gallery-delete">X</div>`;
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
      if (activePreviewId === pendingDeleteId) setActivePreview(null);
    }
  });

  els.clearAllBtn.addEventListener("click", () => {
    if (previewDataStore.size > 0) els.clearDialog.showModal();
  });
  els.clearDialog.addEventListener("close", () => {
    if (els.clearDialog.returnValue === "confirm") {
      for (let k of previewDataStore.keys()) document.getElementById(`gallery-${k}`).remove();
      previewDataStore.clear();
      setActivePreview(null);
    }
  });

  els.helpBtn.addEventListener("click", () => {
    els.helpDialog.showModal();
  });

  els.zipFontDialog.addEventListener("close", () => {
    if (els.zipFontDialog.returnValue === "confirm") {
      const idx = parseInt(els.zipFontSelect.value, 10);
      const selectedFont = zipFonts[idx];
      if (selectedFont) {
        const b = selectedFont.bytes.buffer.slice(
          selectedFont.bytes.byteOffset,
          selectedFont.bytes.byteOffset + selectedFont.bytes.byteLength,
        );
        currentFontBytes = new Uint8Array(b);
        currentFontFilename = selectedFont.name;
        els.filenameDisplay.innerText = truncateMiddle(currentFontFilename, 20);
        saveFontCache("last_font_bytes", b);
        saveFontCache("last_font_name", new TextEncoder().encode(currentFontFilename).buffer);
        if (previewDataStore.size === 0 && els.textInput.value) {
          els.generateBtn.click();
        }
      }
    }
    zipFonts = [];
    els.fontInput.value = "";
  });

  function buildPath2DCache(ast) {
    if (!ast) return [];
    const cache = [];

    if (ast.type === "Spline" || ast.type === "spline") {
      ast.equations.forEach((path) => {
        const path2d = new Path2D();
        path.data.forEach((eq) => {
          let first = true;
          for (let t = 0; t <= 1; t += 0.05) {
            let x =
              eq.x_poly[0] + eq.x_poly[1] * t + eq.x_poly[2] * t * t + eq.x_poly[3] * t * t * t;
            let y =
              eq.y_poly[0] + eq.y_poly[1] * t + eq.y_poly[2] * t * t + eq.y_poly[3] * t * t * t;
            if (first) {
              path2d.moveTo(x, y);
              first = false;
            } else {
              path2d.lineTo(x, y);
            }
          }
        });
        cache.push({
          path2d: path2d,
          colorStyle: path.color_style || path.color_rgb,
        });
      });
    } else if (ast.type === "Fourier" || ast.type === "fourier") {
      ast.strokes.forEach((stroke) => {
        const path2d = new Path2D();
        let first = true;
        const st = 1000;
        for (let i = 0; i <= st; i++) {
          let t = (i / st) * Math.PI * 2,
            x = 0,
            y = 0;
          stroke.data.forEach((term) => {
            x += term.amplitude * Math.cos(term.frequency * t + term.phase);
            y += term.amplitude * Math.sin(term.frequency * t + term.phase);
          });
          if (first) {
            path2d.moveTo(x, y);
            first = false;
          } else {
            path2d.lineTo(x, y);
          }
        }
        cache.push({
          path2d: path2d,
          colorStyle: stroke.color_style || stroke.color_rgb,
        });
      });
    } else if (ast.type === "Polyline" || ast.type === "polyline") {
      ast.paths.forEach((path) => {
        const path2d = new Path2D();
        let first = true;
        path.data.forEach((pt) => {
          if (first) {
            path2d.moveTo(pt.x, pt.y);
            first = false;
          } else {
            path2d.lineTo(pt.x, pt.y);
          }
        });
        cache.push({
          path2d: path2d,
          colorStyle: path.color_style || path.color_rgb,
        });
      });
    }
    return cache;
  }

  function getStrokeStyle(ctx, colorStyle, bbox, isThumb, isDark, isExport) {
    const defCol = isDark ? "#f7b731" : "#2d2416";
    const extractColor = els.colorCheck.checked || isThumb || isExport;

    if (!bbox || bbox.some((val) => !isFinite(val))) {
      bbox = [0, 0, 100, 100];
    }
    if (!colorStyle || !extractColor) return defCol;
    if (Array.isArray(colorStyle)) {
      const r = Math.round(colorStyle[0] * 255);
      const g = Math.round(colorStyle[1] * 255);
      const b = Math.round(colorStyle[2] * 255);
      return `rgb(${r},${g},${b})`;
    }
    if (colorStyle.stops) {
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

        const colorVal = stop[1];
        const r = Math.round(colorVal[0] * 255);
        const g = Math.round(colorVal[1] * 255);
        const b = Math.round(colorVal[2] * 255);
        grad.addColorStop(offset, `rgb(${r},${g},${b})`);
      });
      return grad;
    }
    if (colorStyle.LinearGradient) {
      const startColor = `rgb(${Math.round(colorStyle.LinearGradient.start[0] * 255)},${Math.round(colorStyle.LinearGradient.start[1] * 255)},${Math.round(colorStyle.LinearGradient.start[2] * 255)})`;
      const endColor = `rgb(${Math.round(colorStyle.LinearGradient.end[0] * 255)},${Math.round(colorStyle.LinearGradient.end[1] * 255)},${Math.round(colorStyle.LinearGradient.end[2] * 255)})`;
      const grad = ctx.createLinearGradient(0, 0, 0, 100);
      grad.addColorStop(0, startColor);
      grad.addColorStop(1, endColor);
      return grad;
    }
    return defCol;
  }

  function drawCachedPaths(ctx, cache, ast, isThumb, isDark, isExport) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const visualScale = scale > 0 && isFinite(scale) ? scale : 1.0;
    const strokeWidth = els.strokeRange ? parseFloat(els.strokeRange.value) || 1.5 : 1.5;
    ctx.lineWidth = isThumb ? 3 : isExport ? strokeWidth : strokeWidth / visualScale;

    cache.forEach((item) => {
      ctx.strokeStyle = getStrokeStyle(
        ctx,
        item.colorStyle,
        ast.bounding_box,
        isThumb,
        isDark,
        isExport,
      );
      ctx.stroke(item.path2d);
    });
  }

  function readRevealOptions(isDark) {
    return {
      mode: els.revealModeSelect.value,
      durationMs: parseFloat(els.revealDurationRange.value) * 1000,
      colorMode: els.revealStagedCheck.checked ? "staged" : "together",
      colorStrategy: els.revealColorStrategySelect.value,
      colorLag: parseInt(els.revealColorLagRange.value, 10) / 100,
      monoColor: isDark ? "#fff" : "#000",
      // Match drawCachedPaths' final paint width (isExport=true → raw
      // stroke weight) so animated strokes are not thinner than the
      // resting frame; a mismatch makes the final repaint visibly pop.
      lineWidth: els.strokeRange ? parseFloat(els.strokeRange.value) || 1.5 : 1.5,
      seed: 1,
      origin: revealOrigin,
    };
  }

  function recacheViewportCanvas() {
    if (activePreviewId) {
      const res = previewDataStore.get(activePreviewId);
      if (!res) return;
      if (!cachedViewportCanvas) {
        cachedViewportCanvas = document.createElement("canvas");
      }
      const dims = getTargetDimensions(res.width, res.height);
      cachedViewportCanvas.width = dims.width;
      cachedViewportCanvas.height = dims.height;
      const cCtx = cachedViewportCanvas.getContext("2d");
      const isDark = document.body.classList.contains("dark-theme");

      if (revealAnimator) {
        revealAnimator.cancel();
        revealAnimator = null;
      }

      const scaleX = dims.width / res.width;
      const scaleY = dims.height / res.height;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = (dims.width - res.width * scale) / 2;
      const offsetY = (dims.height - res.height * scale) / 2;

      // Direct full draw; also the fallback for empty/instant reveals.
      const paintDirect = () => {
        cCtx.clearRect(0, 0, dims.width, dims.height);
        cCtx.save();
        cCtx.translate(offsetX, offsetY);
        cCtx.scale(scale, scale);
        if (!res.cachedPaths) {
          res.cachedPaths = buildPath2DCache(res.ast);
        }
        drawCachedPaths(cCtx, res.cachedPaths, res.ast, false, isDark, true);
        cCtx.restore();
      };

      const opts = readRevealOptions(isDark);
      if (opts.mode === "instant") {
        paintDirect();
      } else {
        revealAnimator = new RevealAnimator(res.ast, opts);
        if (revealAnimator.isEmpty) {
          revealAnimator = null;
          paintDirect();
        } else {
          // The animator snapshots this transform as its base and keeps
          // drawing incrementally on later frames, so it must stay applied.
          cCtx.translate(offsetX, offsetY);
          cCtx.scale(scale, scale);
          revealAnimator.play(cCtx, {
            onFrame: () => requestRender(),
            onDone: () => {
              revealAnimator = null;
              // Staged mode keeps its final accumulated frame as the resting
              // state (see image.html for rationale).
              if (opts.colorMode !== "staged") {
                cCtx.setTransform(1, 0, 0, 1, 0, 0);
                cCtx.clearRect(0, 0, dims.width, dims.height);
                cCtx.save();
                cCtx.translate(offsetX, offsetY);
                cCtx.scale(scale, scale);
                if (!res.cachedPaths) {
                  res.cachedPaths = buildPath2DCache(res.ast);
                }
                drawCachedPaths(cCtx, res.cachedPaths, res.ast, false, isDark, true);
                cCtx.restore();
              }
              updateStatsOverlay(res);
            },
          });
        }
      }
    }
  }

  function updateStatsOverlay(result) {
    if (!result) return;
    let stats = `${window.t8("RENDER STATS", "渲染统计")}\n${window.t8("SIZE", "尺寸")}: ${result.width}x${result.height}\n${window.t8("TIME", "耗时")}: ${result.computeTime}ms`;
    if (result.ast.type === "Spline" || result.ast.type === "spline")
      stats += `\n${window.t8("PATHS", "路径")}: ${result.ast.equations.length}`;
    els.overlayStats.innerText = stats;
  }

  function setActivePreview(id) {
    activePreviewId = id;
    document.querySelectorAll(".gallery-item").forEach((el) => el.classList.remove("active"));
    const item = id ? document.getElementById(`gallery-${id}`) : null;
    if (item) {
      item.classList.add("active");
      item.scrollIntoView({ behavior: "smooth", inline: "center" });
    }

    if (id) {
      const res = previewDataStore.get(id);
      if (els.keepAspectRatioCheck.checked && res.width > 0 && res.height > 0) {
        const ratio = res.width / res.height;
        const w = parseInt(els.customWidthInput.value) || 1024;
        els.customHeightInput.value = Math.max(1, Math.round(w / ratio));
      }
      recacheViewportCanvas();
      updateStatsOverlay(res);
    } else {
      cachedViewportCanvas = null;
      els.overlayStats.innerText = window.t8("Waiting for input...", "等待输入…");
    }
    updateLabels();
    resetViewport();
    requestRender();
  }

  function resetViewport() {
    if (!activePreviewId) return;
    const res = previewDataStore.get(activePreviewId);
    if (!res) return;
    const r = els.canvasArea.getBoundingClientRect();
    scale = Math.min((r.width * 0.8) / res.width, (r.height * 0.8) / res.height);
    offsetX = (r.width - res.width * scale) / 2;
    offsetY = (r.height - res.height * scale) / 2;
  }

  let isDraggingHandle = false;
  let activeHandleType = null; // 'start', 'end', or number (stop index)

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
    if (activePreviewId && !els.hideHandlesCheck.checked) {
      const res = previewDataStore.get(activePreviewId);
      if (res && res.ast) {
        const paths = res.ast.equations || res.ast.strokes || res.ast.paths || [];
        const firstPath = paths[0];
        const colorStyle = firstPath ? firstPath.color_style || firstPath.color_rgb : null;
        if (colorStyle && colorStyle.stops) {
          const start_pos = colorStyle.start_pos || [0.0, 0.5];
          const end_pos = colorStyle.end_pos || [1.0, 0.5];
          const bbox = res.ast.bounding_box;
          if (bbox) {
            const w = bbox[2] - bbox[0];
            const h = bbox[3] - bbox[1];
            if (w > 0 && h > 0) {
              const x0 = bbox[0] + start_pos[0] * w;
              const y0 = bbox[1] + start_pos[1] * h;
              const x1 = bbox[0] + end_pos[0] * w;
              const y1 = bbox[1] + end_pos[1] * h;

              // Convert to screen coords
              const screenX0 = offsetX + x0 * scale;
              const screenY0 = offsetY + y0 * scale;
              const screenX1 = offsetX + x1 * scale;
              const screenY1 = offsetY + y1 * scale;

              // Mouse position relative to canvas
              const rect = els.canvasArea.getBoundingClientRect();
              const screenX = e.clientX - rect.left;
              const screenY = e.clientY - rect.top;

              let bestDist = 15;
              let bestHandle = null;

              const dist0 = Math.hypot(screenX - screenX0, screenY - screenY0);
              if (dist0 < bestDist) {
                bestDist = dist0;
                bestHandle = "start";
              }

              const dist1 = Math.hypot(screenX - screenX1, screenY - screenY1);
              if (dist1 < bestDist) {
                bestDist = dist1;
                bestHandle = "end";
              }

              for (let i = 0; i < colorStyle.stops.length; i++) {
                const offset = colorStyle.stops[i][0];
                const screenCX = screenX0 + offset * (screenX1 - screenX0);
                const screenCY = screenY0 + offset * (screenY1 - screenY0);
                const distStop = Math.hypot(screenX - screenCX, screenY - screenCY);
                if (distStop < bestDist) {
                  bestDist = distStop;
                  bestHandle = i;
                }
              }

              if (bestHandle !== null) {
                isDraggingHandle = true;
                activeHandleType = bestHandle;
                return; // Don't trigger pan dragging
              }
            }
          }
        }
      }
    }
    // Fall back to viewport pan
    isDragging = true;
    dragStart = { x: e.clientX - offsetX, y: e.clientY - offsetY };
  });

  window.addEventListener("mousemove", (e) => {
    if (scale <= 0 || !isFinite(scale)) return;
    if (isDraggingHandle && activePreviewId) {
      const res = previewDataStore.get(activePreviewId);
      if (res && res.ast) {
        const bbox = res.ast.bounding_box;
        if (bbox) {
          const w = bbox[2] - bbox[0];
          const h = bbox[3] - bbox[1];
          if (w > 0 && h > 0) {
            const rect = els.canvasArea.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            // Convert to AST space
            const astX = (screenX - offsetX) / scale;
            const astY = (screenY - offsetY) / scale;

            // Relative position in bbox
            let relX = (astX - bbox[0]) / w;
            let relY = (astY - bbox[1]) / h;

            if (!Number.isFinite(relX)) relX = 0.0;
            if (!Number.isFinite(relY)) relY = 0.5;
            relX = Math.min(1.0, Math.max(0.0, relX));
            relY = Math.min(1.0, Math.max(0.0, relY));

            // Update all path color styles in the AST
            const paths = res.ast.equations || res.ast.strokes || res.ast.paths || [];
            paths.forEach((path) => {
              const style = path.color_style || path.color_rgb;
              if (style && style.stops) {
                if (activeHandleType === "start") {
                  style.start_pos = [relX, relY];
                  currentGradient.start_pos = [relX, relY];
                } else if (activeHandleType === "end") {
                  style.end_pos = [relX, relY];
                  currentGradient.end_pos = [relX, relY];
                } else if (typeof activeHandleType === "number") {
                  const start_pos = style.start_pos || [0.0, 0.5];
                  const end_pos = style.end_pos || [1.0, 0.5];
                  const ab_x = end_pos[0] - start_pos[0];
                  const ab_y = end_pos[1] - start_pos[1];
                  const ap_x = relX - start_pos[0];
                  const ap_y = relY - start_pos[1];

                  const ab_len_sq = ab_x * ab_x + ab_y * ab_y;
                  let t = 0.0;
                  if (ab_len_sq > 1e-6) {
                    t = (ap_x * ab_x + ap_y * ab_y) / ab_len_sq;
                  }
                  t = Math.min(1.0, Math.max(0.0, t));

                  style.stops[activeHandleType][0] = t;
                  currentGradient.stops[activeHandleType][0] = t;

                  // Update range slider in the sidebar UI directly to sync in real-time
                  const sliders = els.customStopsContainer
                    ? els.customStopsContainer.querySelectorAll('input[type="range"]')
                    : [];
                  if (sliders[activeHandleType]) {
                    sliders[activeHandleType].value = Math.round(t * 100);
                  }
                }
              }
            });

            recacheViewportCanvas();
            requestRender();
          }
        }
      }
    } else if (isDragging) {
      offsetX = e.clientX - dragStart.x;
      offsetY = e.clientY - dragStart.y;
      requestRender();
    }
  });

  window.addEventListener("mouseup", () => {
    if (isDraggingHandle && typeof activeHandleType === "number" && activePreviewId) {
      currentGradient.stops.sort((a, b) => a[0] - b[0]);
      updateColorStyleOnAst();
      renderStopsEditor();
    } else if (isDraggingHandle && (activeHandleType === "start" || activeHandleType === "end")) {
      updateColorStyleOnAst();
    }
    isDragging = false;
    isDraggingHandle = false;
    activeHandleType = null;
  });
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
    if (!activePreviewId || !cachedViewportCanvas) return;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const res = previewDataStore.get(activePreviewId);
    if (!res) {
      ctx.restore();
      return;
    }
    const w = res.width,
      h = res.height;

    if (!els.bgTransparentCheck.checked) {
      ctx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }

    ctx.drawImage(cachedViewportCanvas, 0, 0, w, h);

    // Add constant physical size handle rendering
    const paths = res.ast.equations || res.ast.strokes || res.ast.paths || [];
    const firstPath = paths[0];
    const colorStyle = firstPath ? firstPath.color_style || firstPath.color_rgb : null;
    if (!els.hideHandlesCheck.checked && colorStyle && colorStyle.stops) {
      const start_pos = colorStyle.start_pos || [0.0, 0.5];
      const end_pos = colorStyle.end_pos || [1.0, 0.5];
      const bbox = res.ast.bounding_box;
      if (bbox) {
        const bw = bbox[2] - bbox[0];
        const bh = bbox[3] - bbox[1];
        if (bw > 0 && bh > 0) {
          const x0 = bbox[0] + start_pos[0] * bw;
          const y0 = bbox[1] + start_pos[1] * bh;
          const x1 = bbox[0] + end_pos[0] * bw;
          const y1 = bbox[1] + end_pos[1] * bh;

          const visualScale = scale > 0 && isFinite(scale) ? scale : 1.0;

          // Thin dashed line connecting them
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.strokeStyle = "#e76e55";
          ctx.lineWidth = 1.5 / visualScale;
          ctx.setLineDash([4 / visualScale, 4 / visualScale]);
          ctx.stroke();
          ctx.setLineDash([]); // Reset

          // Determine start and end reference colors from stops
          let startColor = "#2beb82";
          let endColor = "#ff4757";
          if (colorStyle.stops && colorStyle.stops.length > 0) {
            const sortedStops = [...colorStyle.stops].sort((a, b) => a[0] - b[0]);
            const firstStop = sortedStops[0];
            const lastStop = sortedStops[sortedStops.length - 1];
            startColor = rgbToHex(firstStop[1][0], firstStop[1][1], firstStop[1][2]);
            endColor = rgbToHex(lastStop[1][0], lastStop[1][1], lastStop[1][2]);
          }

          // Draw all Stops along the line
          if (colorStyle.stops) {
            colorStyle.stops.forEach((stop) => {
              const offset = stop[0];
              const rgb = stop[1];
              const stopColor = rgbToHex(rgb[0], rgb[1], rgb[2]);
              const cx = x0 + offset * (x1 - x0);
              const cy = y0 + offset * (y1 - y0);

              // Stop node outer white circle
              ctx.beginPath();
              ctx.arc(cx, cy, 7.5 / visualScale, 0, Math.PI * 2);
              ctx.fillStyle = "#ffffff";
              ctx.fill();

              // Stop node inner color circle
              ctx.beginPath();
              ctx.arc(cx, cy, 5.0 / visualScale, 0, Math.PI * 2);
              ctx.fillStyle = stopColor;
              ctx.fill();

              // Outer dark stroke for visibility on light/dark backgrounds
              ctx.beginPath();
              ctx.arc(cx, cy, 7.5 / visualScale, 0, Math.PI * 2);
              ctx.strokeStyle = "#2d2416";
              ctx.lineWidth = 1.0 / visualScale;
              ctx.stroke();
            });
          }

          // Draw Start Handle (Green Outer Ring, White spacer, Start Color Inner)
          ctx.beginPath();
          ctx.arc(x0, y0, 11 / visualScale, 0, Math.PI * 2);
          ctx.fillStyle = "#2beb82";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x0, y0, 9 / visualScale, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x0, y0, 6.5 / visualScale, 0, Math.PI * 2);
          ctx.fillStyle = startColor;
          ctx.fill();

          // Draw End Handle (Red Outer Ring, White spacer, End Color Inner)
          ctx.beginPath();
          ctx.arc(x1, y1, 11 / visualScale, 0, Math.PI * 2);
          ctx.fillStyle = "#ff4757";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x1, y1, 9 / visualScale, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x1, y1, 6.5 / visualScale, 0, Math.PI * 2);
          ctx.fillStyle = endColor;
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function drawAST(ctx, ast, isThumb, isDark, isExport) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const visualScale = scale > 0 && isFinite(scale) ? scale : 1.0;
    const strokeWidth = els.strokeRange ? parseFloat(els.strokeRange.value) : 1.0;
    ctx.lineWidth = isThumb ? 3 : isExport ? strokeWidth : strokeWidth / visualScale;

    if (ast.type === "Spline" || ast.type === "spline") {
      ast.equations.forEach((path) => {
        ctx.strokeStyle = getStrokeStyle(
          ctx,
          path.color_style || path.color_rgb,
          ast.bounding_box,
          isThumb,
          isDark,
          isExport,
        );
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
        ctx.strokeStyle = getStrokeStyle(
          ctx,
          stroke.color_style || stroke.color_rgb,
          ast.bounding_box,
          isThumb,
          isDark,
          isExport,
        );
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
        ctx.strokeStyle = getStrokeStyle(
          ctx,
          path.color_style || path.color_rgb,
          ast.bounding_box,
          isThumb,
          isDark,
          isExport,
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

  els.resetViewBtn.addEventListener("click", () => {
    resetViewport();
    requestRender();
  });
  els.gridCheck.addEventListener("change", () => {
    els.canvasArea.classList.toggle("show-grid", els.gridCheck.checked);
  });
  els.bgTransparentCheck.addEventListener("change", () => {
    if (els.bgTransparentCheck.checked && els.exportFormat.value === "jpg")
      els.exportFormat.value = "png";
    Array.from(els.exportFormat.options).find((o) => o.value === "jpg").disabled =
      els.bgTransparentCheck.checked;
    requestRender();
  });
  els.hideHandlesCheck.addEventListener("change", () => {
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
    if (!activePreviewId) return showError(window.t8("No render selected!", "未选择渲染结果！"));
    const format = els.exportFormat.value;
    const res = previewDataStore.get(activePreviewId);
    const dims = getTargetDimensions(res.width, res.height);
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    const eCtx = canvas.getContext("2d");
    if (!els.bgTransparentCheck.checked || format === "jpg") {
      eCtx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
      eCtx.fillRect(0, 0, dims.width, dims.height);
    }
    eCtx.save();
    const scaleX = dims.width / res.width;
    const scaleY = dims.height / res.height;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (dims.width - res.width * scale) / 2;
    const offsetY = (dims.height - res.height * scale) / 2;
    eCtx.translate(offsetX, offsetY);
    eCtx.scale(scale, scale);
    drawAST(eCtx, res.ast, false, document.body.classList.contains("dark-theme"), true);
    eCtx.restore();
    const baseName = els.textInput.value.substring(0, 12).replace(/\s+/g, "_") || "text_render";
    let finalFilename = `${baseName}_vecto_${els.modeSelect.value.toUpperCase()}_D${els.detailRange.value}`;

    function triggerDownload(href, filename) {
      const link = document.createElement("a");
      link.download = filename;
      link.href = href;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    if (format === "json") {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.ast));
      triggerDownload(dataStr, `${finalFilename}.json`);
    } else {
      triggerDownload(
        canvas.toDataURL(format === "jpg" ? "image/jpeg" : "image/png"),
        `${finalFilename}.${format}`,
      );
    }
  });

  // ── COPY to clipboard ─────────────────────────────────────────────────
  if (els.copyBtn) {
    els.copyBtn.addEventListener("click", async () => {
      if (!activePreviewId) return showError(window.t8("No render selected!", "未选择渲染结果！"));
      const res = previewDataStore.get(activePreviewId);
      const dims = getTargetDimensions(res.width, res.height);
      const offscreen = document.createElement("canvas");
      offscreen.width = dims.width;
      offscreen.height = dims.height;
      const oCtx = offscreen.getContext("2d");
      if (!els.bgTransparentCheck.checked) {
        oCtx.fillStyle = document.body.classList.contains("dark-theme") ? "#000000" : "#ffffff";
        oCtx.fillRect(0, 0, dims.width, dims.height);
      }
      const scaleX = dims.width / res.width;
      const scaleY = dims.height / res.height;
      const scale = Math.min(scaleX, scaleY);
      oCtx.save();
      oCtx.translate((dims.width - res.width * scale) / 2, (dims.height - res.height * scale) / 2);
      oCtx.scale(scale, scale);
      drawAST(oCtx, res.ast, false, document.body.classList.contains("dark-theme"), true);
      oCtx.restore();
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
  }

  // ── Restore from JSON ─────────────────────────────────────────────────
  if (els.restoreJsonInput) {
    els.restoreJsonInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const ast = JSON.parse(text);
        if (!ast || !ast.type)
          return showError(
            window.t8("Invalid JSON: missing AST type.", "无效 JSON：缺少 AST 类型。"),
          );
        const id = "restored_" + Date.now();
        const bb = ast.bounding_box;
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
      } catch (err) {
        showError(window.t8("Failed to load JSON: ", "JSON 加载失败：") + err.message);
      }
      e.target.value = "";
    });
  }

  // Settings persistence
  const STORAGE_KEY = "vectomancy_typo_settings";
  function saveSettings() {
    try {
      const settings = {
        mode: els.modeSelect.value,
        color: els.colorCheck.checked,
        colorType: els.colorTypeSelect ? els.colorTypeSelect.value : "solid",
        solidColor: els.solidColorInput ? els.solidColorInput.value : "#e76e55",
        gradient: currentGradient,
        flowSpeed: els.flowSpeedRange ? els.flowSpeedRange.value : "0",
        grid: els.gridCheck.checked,
        transparent: els.bgTransparentCheck.checked,
        hideHandles: els.hideHandlesCheck.checked,
        detail: els.detailRange.value,
        minPath: els.minPathRange.value,
        strokeWeight: els.strokeRange.value,
        letterSpacing: els.letterSpacingRange.value,
        terms: els.termsRange.value,
        chaikin: els.chaikinRange.value,
        exportFormat: els.exportFormat.value,
        revealMode: els.revealModeSelect.value,
        revealDuration: els.revealDurationRange.value,
        revealStaged: els.revealStagedCheck.checked,
        revealColorStrategy: els.revealColorStrategySelect.value,
        revealColorLag: els.revealColorLagRange.value,
        sizeMode: els.sizeModeSelect.value,
        resScale: els.resolutionScaleRange.value,
        customWidth: els.customWidthInput.value,
        customHeight: els.customHeightInput.value,
        keepRatio: els.keepAspectRatioCheck.checked,
        theme: document.body.classList.contains("dark-theme") ? "dark" : "light",
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      localStorage.setItem("vectomancy_theme", settings.theme);
    } catch (e) {}
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
      if (settings.colorType !== undefined && els.colorTypeSelect)
        els.colorTypeSelect.value = settings.colorType;
      if (settings.solidColor !== undefined && els.solidColorInput)
        els.solidColorInput.value = settings.solidColor;
      if (settings.gradient !== undefined) currentGradient = settings.gradient;
      if (settings.flowSpeed !== undefined && els.flowSpeedRange)
        els.flowSpeedRange.value = settings.flowSpeed;
      if (settings.grid !== undefined) els.gridCheck.checked = settings.grid;
      if (settings.transparent !== undefined) els.bgTransparentCheck.checked = settings.transparent;
      if (settings.hideHandles !== undefined) els.hideHandlesCheck.checked = settings.hideHandles;
      if (settings.detail !== undefined) els.detailRange.value = settings.detail;
      if (settings.minPath !== undefined) els.minPathRange.value = settings.minPath;
      if (settings.strokeWeight !== undefined) els.strokeRange.value = settings.strokeWeight;
      if (settings.letterSpacing !== undefined)
        els.letterSpacingRange.value = settings.letterSpacing;
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

      if (settings.sizeMode !== undefined) {
        els.sizeModeSelect.value = settings.sizeMode;
        els.autoSizeControls.classList.toggle("hidden", settings.sizeMode !== "auto");
        els.customSizeControls.classList.toggle("hidden", settings.sizeMode !== "custom");
      }
      if (settings.resScale !== undefined) els.resolutionScaleRange.value = settings.resScale;
      if (settings.customWidth !== undefined) els.customWidthInput.value = settings.customWidth;
      if (settings.customHeight !== undefined) els.customHeightInput.value = settings.customHeight;
      if (settings.keepRatio !== undefined) els.keepAspectRatioCheck.checked = settings.keepRatio;

      validateStrokeRange();

      if (settings.theme === "dark") {
        document.body.classList.add("dark-theme");
        [els.deleteDialog, els.clearDialog, els.errorDialog, els.helpDialog].forEach((d) =>
          d.classList.add("is-dark"),
        );
        document
          .querySelectorAll(
            ".nes-input, .nes-checkbox, .nes-radio, .nes-select select, .nes-btn:not(.is-primary):not(.is-success):not(.is-error):not(.is-warning)",
          )
          .forEach((el) => el.classList.add("is-dark"));
      } else if (settings.theme === "light") {
        document.body.classList.remove("dark-theme");
        document
          .querySelectorAll(
            ".nes-input, .nes-checkbox, .nes-radio, .nes-select select, .nes-btn:not(.is-primary):not(.is-success):not(.is-error):not(.is-warning)",
          )
          .forEach((el) => el.classList.remove("is-dark"));
      }
    } catch (e) {}
  }
  [
    els.modeSelect,
    els.colorCheck,
    els.colorTypeSelect,
    els.flowSpeedRange,
    els.gridCheck,
    els.bgTransparentCheck,
    els.hideHandlesCheck,
    els.detailRange,
    els.minPathRange,
    els.strokeRange,
    els.letterSpacingRange,
    els.termsRange,
    els.chaikinRange,
    els.exportFormat,
    els.revealModeSelect,
    els.revealDurationRange,
    els.revealStagedCheck,
    els.revealColorStrategySelect,
    els.revealColorLagRange,
    els.solidColorInput,
    els.sizeModeSelect,
    els.resolutionScaleRange,
    els.customWidthInput,
    els.customHeightInput,
    els.keepAspectRatioCheck,
  ].forEach((el) => {
    if (el) {
      el.addEventListener("input", saveSettings);
      el.addEventListener("change", saveSettings);
    }
  });
  if (els.letterSpacingRange) {
    els.letterSpacingRange.addEventListener("change", () => {
      if (currentFontBytes && els.textInput.value) {
        els.generateBtn.click();
      }
    });
  }
  loadSettings();
  updateLabels();
  renderPalettePresets();
  renderStopsEditor();

  // 4. Add flow animation loop
  let lastAnimTime = performance.now();
  function animationLoop(timestamp) {
    requestAnimationFrame(animationLoop);

    const elapsed = (timestamp - lastAnimTime) / 1000.0; // in seconds
    lastAnimTime = timestamp;

    if (!activePreviewId) return;
    const res = previewDataStore.get(activePreviewId);
    if (!res || !res.ast) return;

    const speed = (els.flowSpeedRange ? parseFloat(els.flowSpeedRange.value) : 0) * 0.05;
    if (speed > 0 && els.colorCheck.checked) {
      // Shift stops offset values dynamically over time
      const paths = res.ast.equations || res.ast.strokes || res.ast.paths || [];
      let changed = false;
      paths.forEach((path) => {
        const style = path.color_style || path.color_rgb;
        if (style && style.stops) {
          style.stops = style.stops.map((stop) => {
            let offset = stop[0];
            offset = (offset + speed * elapsed) % 1.0;
            if (offset < 0) offset += 1.0;
            return [offset, stop[1]];
          });
          changed = true;
        }
      });

      if (changed) {
        recacheViewportCanvas();
        requestRender();
      }
    }
  }
  requestAnimationFrame(animationLoop);
}
