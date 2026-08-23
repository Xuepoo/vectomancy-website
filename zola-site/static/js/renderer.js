// static/js/renderer.js

export function processColor(colorRgb, bitDepth, colorSpace) {
  if (!colorRgb) return null;
  let [r, g, b] = colorRgb;

  const isFloat = colorRgb.every((v) => v <= 1.0001);
  if (isFloat) {
    r *= 255.0;
    g *= 255.0;
    b *= 255.0;
  }

  if (colorSpace === "grayscale" || colorSpace === "grayscale-mode") {
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    r = gray;
    g = gray;
    b = gray;
  }

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

export function resolveStrokeStyle(ctx, colorStyle, bbox, opts = {}) {
  const defCol = opts.defCol || "#000";
  const bitDepth = opts.bitDepth || "24";
  const colorSpace = opts.colorSpace || "srgb";
  const extractColor = opts.extractColor !== false;
  if (!bbox || bbox.some((val) => !isFinite(val))) {
    bbox = [0, 0, 100, 100];
  }
  if (!colorStyle || !extractColor) return defCol;
  if (Array.isArray(colorStyle)) {
    const finalRgb = processColor(colorStyle, bitDepth, colorSpace);
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
      if (isNaN(offset) || !isFinite(offset)) offset = 0.0;
      offset = Math.max(0.0, Math.min(1.0, offset));
      const rgb = processColor(stop[1], bitDepth, colorSpace);
      grad.addColorStop(offset, `rgb(${rgb.join(",")})`);
    });
    return grad;
  } else if (colorStyle.LinearGradient) {
    const start = processColor(colorStyle.LinearGradient.start, bitDepth, colorSpace);
    const end = processColor(colorStyle.LinearGradient.end, bitDepth, colorSpace);
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

export function drawAST(ctx, ast, options = {}) {
  let isThumb = false;
  let isDark = false;
  let isExport = false;
  let scale = 1.0;
  let bitDepth = "24";
  let colorSpace = "srgb";
  let strokeWidth = 1.0;
  let extractColor = true;

  if (typeof options === "boolean") {
    isThumb = options;
    isDark = !!arguments[3];
    isExport = !!arguments[4];
    const depthEl = document.getElementById("colorDepthSelect");
    const spaceEl = document.getElementById("colorSpaceSelect");
    const colorEl = document.getElementById("colorCheck");
    bitDepth = depthEl ? depthEl.value : "24";
    colorSpace = spaceEl ? spaceEl.value : "srgb";
    extractColor = colorEl ? colorEl.checked : true;
  } else {
    isThumb = !!options.isThumb;
    isDark = !!options.isDark;
    isExport = !!options.isExport;
    scale = options.scale || 1.0;
    bitDepth = options.bitDepth || "24";
    colorSpace = options.colorSpace || "srgb";
    strokeWidth = options.strokeWidth !== undefined ? options.strokeWidth : 1.0;
    extractColor = options.extractColor !== false;
  }

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = isThumb ? 3 : isExport ? strokeWidth : strokeWidth / scale;
  const defCol = isDark ? "#fff" : "#000";

  function getStrokeStyle(colorStyle, bbox) {
    return resolveStrokeStyle(ctx, colorStyle, bbox, {
      defCol,
      bitDepth,
      colorSpace,
      extractColor,
    });
  }

  if (ast.type === "Spline" || ast.type === "spline") {
    ast.equations.forEach((path) => {
      ctx.strokeStyle = getStrokeStyle(path.color_style || path.color_rgb, ast.bounding_box);
      path.data.forEach((eq) => {
        ctx.beginPath();
        let first = true;
        for (let t = 0; t <= 1; t += isThumb ? 0.2 : 0.05) {
          let x = eq.x_poly[0] + eq.x_poly[1] * t + eq.x_poly[2] * t * t + eq.x_poly[3] * t * t * t;
          let y = eq.y_poly[0] + eq.y_poly[1] * t + eq.y_poly[2] * t * t + eq.y_poly[3] * t * t * t;
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

// Export functions to global scope for templates that cannot use ES Modules
window.VectomancyRenderer = { processColor, drawAST };
