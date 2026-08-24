// Progressive reveal ("delayed rendering") animator for Vectomancy ASTs.
//
// Paints an AST onto a canvas incrementally over time instead of all at once.
// Two orthogonal stages:
//   1. Shape stage - strokes appear according to a spatial or sequential
//      schedule (sweeps, radial expansion, draw order, random).
//   2. Color stage (optional) - the same strokes are re-drawn with their real
//      colors on a lagged schedule, so monochrome art "blooms" into color.
//
// Drawing is incremental: each frame only appends newly revealed segments to
// the target context, so total work over an animation is roughly one full
// redraw, and panning/zooming stays smooth because callers blit this canvas.

import { resolveStrokeStyle } from "/js/renderer.js";

export const REVEAL_MODES = [
  "instant",
  "ltr",
  "rtl",
  "ttb",
  "btt",
  "diag-tlbr",
  "diag-brtl",
  "radial-center",
  "radial-origin",
  "sequential",
  "random",
];

// Deterministic PRNG so "Random" replays identically for the same seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function validBBox(bbox) {
  if (!bbox || bbox.length < 4 || bbox.some((v) => !isFinite(v))) {
    return [0, 0, 100, 100];
  }
  return bbox;
}

// Evaluate a cubic polynomial coefficient array at t.
function cubicAt(poly, t) {
  return poly[0] + poly[1] * t + poly[2] * t * t + poly[3] * t * t * t;
}

// Extract drawable strokes from any AST type as uniform descriptors:
// { colorStyle, cx, cy, draw(ctx, a, b) } where [a, b] is the revealed
// fraction range of that stroke (0..1). draw() appends geometry only.
export function extractStrokes(ast) {
  const strokes = [];
  if (!ast) return strokes;

  // Conservative per-stroke bounding box in AST coordinates, used by the
  // staged compositor to refresh only the region that changed this frame.
  const bboxOfPoints = (xs, ys) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < x0) x0 = xs[i];
      if (xs[i] > x1) x1 = xs[i];
      if (ys[i] < y0) y0 = ys[i];
      if (ys[i] > y1) y1 = ys[i];
    }
    return !isFinite(x0) ? null : [x0, y0, x1, y1];
  };

  if (ast.type === "Spline" || ast.type === "spline") {
    (ast.equations || []).forEach((path) => {
      const eqs = path.data || [];
      if (!eqs.length) return;
      let sx = 0;
      let sy = 0;
      let n = 0;
      const xs = [];
      const ys = [];
      eqs.forEach((eq) => {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          xs.push(cubicAt(eq.x_poly, t));
          ys.push(cubicAt(eq.y_poly, t));
        }
        sx += cubicAt(eq.x_poly, 0) + cubicAt(eq.x_poly, 1);
        sy += cubicAt(eq.y_poly, 0) + cubicAt(eq.y_poly, 1);
        n += 2;
      });
      strokes.push({
        colorStyle: path.color_style || path.color_rgb,
        cx: sx / n,
        cy: sy / n,
        bbox: bboxOfPoints(xs, ys),
        type: "spline",
        eqs,
        draw(ctx, a, b, out) {
          const E = eqs.length;
          const start = clamp01(a) * E;
          const end = Math.min(clamp01(b) * E, E);
          let ei = Math.min(Math.floor(start), E - 1);
          const lastEi = Math.min(Math.floor(end), E - 1);
          // Each equation is its own subpath (matches drawAST behaviour).
          while (ei <= lastEi && ei < E) {
            const eq = eqs[ei];
            const tStart = ei === Math.floor(start) ? start - ei : 0;
            const tEnd = ei === Math.floor(end) && end < E ? end - ei : 1;
            // Adaptive sampling: enough points for smooth curves at pixel
            // scale, but proportional to on-screen length instead of a fixed
            // 20-points-per-segment that chokes on many-path ASTs.
            const dx = cubicAt(eq.x_poly, tEnd) - cubicAt(eq.x_poly, tStart);
            const dy = cubicAt(eq.y_poly, tEnd) - cubicAt(eq.y_poly, tStart);
            const approxLen = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(4, Math.min(24, Math.ceil(approxLen / 6)));
            const target = out || ctx;
            if (!out) ctx.beginPath();
            for (let s = 0; s <= steps; s++) {
              const t = tStart + ((tEnd - tStart) * s) / steps;
              const x = cubicAt(eq.x_poly, t);
              const y = cubicAt(eq.y_poly, t);
              if (s === 0) target.moveTo(x, y);
              else target.lineTo(x, y);
            }
            if (!out) ctx.stroke();
            ei++;
          }
        },
      });
    });
  } else if (ast.type === "Fourier" || ast.type === "fourier") {
    (ast.strokes || []).forEach((stroke) => {
      const terms = stroke.data || [];
      if (!terms.length) return;
      const evalAt = (t) => {
        let x = 0;
        let y = 0;
        terms.forEach((term) => {
          x += term.amplitude * Math.cos(term.frequency * t + term.phase);
          y += term.amplitude * Math.sin(term.frequency * t + term.phase);
        });
        return [x, y];
      };
      const [cx, cy] = evalAt(0);
      const amp = terms.reduce((m, t) => m + Math.abs(t.amplitude), 0);
      strokes.push({
        colorStyle: stroke.color_style || stroke.color_rgb,
        cx,
        cy,
        bbox: [cx - amp, cy - amp, cx + amp, cy + amp],
        type: "fourier",
        terms,
        draw(ctx, a, b, out) {
          const st = Math.min(terms.length * 4, 1000);
          const iStart = Math.floor(clamp01(a) * st);
          const iEnd = Math.ceil(clamp01(b) * st);
          const target = out || ctx;
          if (!out) ctx.beginPath();
          for (let i = iStart; i <= iEnd; i++) {
            const t = ((i / st) % 1) * Math.PI * 2;
            const [x, y] = evalAt(t);
            if (i === iStart) target.moveTo(x, y);
            else target.lineTo(x, y);
          }
          if (!out) ctx.stroke();
        },
      });
    });
  } else if (ast.type === "Polyline" || ast.type === "polyline") {
    (ast.paths || []).forEach((path) => {
      const pts = path.data || [];
      if (pts.length < 2) return;
      let sx = 0;
      let sy = 0;
      let cnt = 0;
      const stride = Math.max(1, Math.floor(pts.length / 64));
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
        if (i % stride === 0) {
          sx += p.x;
          sy += p.y;
          cnt++;
        }
      }
      strokes.push({
        colorStyle: path.color_style || path.color_rgb,
        cx: sx / cnt,
        cy: sy / cnt,
        bbox: isFinite(x0) ? [x0, y0, x1, y1] : null,
        type: "polyline",
        pts,
        draw(ctx, a, b, out) {
          const segs = pts.length - 1;
          const fStart = clamp01(a) * segs;
          const fEnd = clamp01(b) * segs;
          const iStart = Math.floor(fStart);
          const iEnd = Math.ceil(fEnd);
          const target = out || ctx;
          if (!out) ctx.beginPath();
          const lerpPt = (i, f) => ({
            x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
            y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
          });
          const s0 = lerpPt(iStart, fStart - iStart);
          target.moveTo(s0.x, s0.y);
          for (let i = iStart; i < iEnd; i++) {
            if (i + 1 <= segs) {
              if (i === iEnd - 1 && fEnd < iEnd) {
                const e0 = lerpPt(i, fEnd - i);
                target.lineTo(e0.x, e0.y);
              } else {
                target.lineTo(pts[i + 1].x, pts[i + 1].y);
              }
            }
          }
          if (!out) ctx.stroke();
        },
      });
    });
  }
  return strokes;
}

// Schedule key per stroke in [0, 1]: when along the shared timeline it starts.
export function computeScheduleKeys(mode, strokes, bbox, origin, rng) {
  const n = strokes.length;
  if (!n) return [];
  const [b0, b1, b2, b3] = validBBox(bbox);
  const w = Math.max(b2 - b0, 1e-6);
  const h = Math.max(b3 - b1, 1e-6);
  const maxDistFrom = (ox, oy) =>
    Math.max(...strokes.map((s) => Math.hypot(s.cx - ox, s.cy - oy)), 1e-6);

  switch (mode) {
    case "ltr":
      return strokes.map((s) => clamp01((s.cx - b0) / w));
    case "rtl":
      return strokes.map((s) => clamp01(1 - (s.cx - b0) / w));
    case "ttb":
      return strokes.map((s) => clamp01((s.cy - b1) / h));
    case "btt":
      return strokes.map((s) => clamp01(1 - (s.cy - b1) / h));
    case "diag-tlbr":
      return strokes.map((s) => clamp01(((s.cx - b0) / w + (s.cy - b1) / h) / 2));
    case "diag-brtl":
      return strokes.map((s) => clamp01(1 - ((s.cx - b0) / w + (s.cy - b1) / h) / 2));
    case "radial-center": {
      const ox = b0 + w / 2;
      const oy = b1 + h / 2;
      const maxD = maxDistFrom(ox, oy);
      return strokes.map((s) => clamp01(Math.hypot(s.cx - ox, s.cy - oy) / maxD));
    }
    case "radial-origin": {
      const ox = origin ? origin[0] : b0 + w / 2;
      const oy = origin ? origin[1] : b1 + h / 2;
      const maxD = maxDistFrom(ox, oy);
      return strokes.map((s) => clamp01(Math.hypot(s.cx - ox, s.cy - oy) / maxD));
    }
    case "sequential":
      return strokes.map((_, i) => (n > 1 ? i / (n - 1) : 0));
    case "random": {
      const order = strokes.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const ranks = Array.from({ length: n }, () => 0);
      order.forEach((strokeIdx, rank) => {
        ranks[strokeIdx] = n > 1 ? rank / (n - 1) : 0;
      });
      return ranks;
    }
    default:
      return strokes.map(() => 0);
  }
}

const DEFAULTS = {
  mode: "ltr",
  durationMs: 3000,
  seed: 1,
  origin: null, // [x, y] in AST coords for radial-origin
  colorMode: "together", // "together" | "staged"
  colorStrategy: "follow", // "follow" | any reveal mode
  colorLag: 0.45, // fraction of timeline before color stage begins
  monoColor: "#000",
  lineWidth: 1,
  bitDepth: "24",
  colorSpace: "srgb",
  extractColor: true,
};

// A single scheduled pass over all strokes (shape or color stage).
class RevealPass {
  constructor(strokes, keys, styleFor, hooks = {}) {
    this.strokes = strokes;
    this.styleFor = styleFor;
    this.onStrokeStart = hooks.onStrokeStart || null;
    this.onAdvance = hooks.onAdvance || null;
    // Batch mode: all strokes share one style (the monochrome pass), so the
    // frame's advancing strokes are accumulated into a single Path2D and
    // stroked once — hundreds of beginPath/stroke round-trips per frame are
    // what makes many-path ASTs janky.
    this.batch = hooks.batch || false;
    const n = keys.length;
    // Window width: how much of the timeline each individual stroke takes.
    const wf = Math.min(0.5, Math.max(0.06, 1.6 / Math.max(n, 1)));
    this.windows = keys.map((k) => {
      const span = 1 - wf;
      const s0 = k * span;
      return { s0, s1: s0 + wf };
    });
    this.drawn = keys.map(() => 0);
    this.complete = false;
  }

  // Draw everything between previous global progress and current one.
  // Returns true when any stroke advanced (i.e. new pixels were emitted).
  drawRange(ctx, fromT, toT) {
    if (this.complete) return false;
    let advanced = false;
    const P = this.batch ? new Path2D() : null;
    if (P) ctx.strokeStyle = this.styleFor(this.strokes[0]);
    for (let i = 0; i < this.strokes.length; i++) {
      const { s0, s1 } = this.windows[i];
      if (s0 >= toT) continue;
      const prevP = clamp01((fromT - s0) / (s1 - s0));
      const curP = clamp01((toT - s0) / (s1 - s0));
      if (curP <= prevP || curP <= this.drawn[i]) continue;
      if (this.drawn[i] === 0 && this.onStrokeStart) this.onStrokeStart(i);
      const from = Math.max(prevP, this.drawn[i]);
      if (P) this.strokes[i].draw(ctx, from, curP, P);
      else {
        ctx.strokeStyle = this.styleFor(this.strokes[i]);
        this.strokes[i].draw(ctx, from, curP);
      }
      this.drawn[i] = curP;
      advanced = true;
      if (this.onAdvance) this.onAdvance(this.strokes[i]);
    }
    if (P && advanced) ctx.stroke(P);
    if (toT >= 1) {
      // Force-complete any rounding leftovers.
      const PF = this.batch ? new Path2D() : null;
      let forced = false;
      for (let i = 0; i < this.strokes.length; i++) {
        if (this.drawn[i] < 1) {
          if (this.drawn[i] === 0 && this.onStrokeStart) this.onStrokeStart(i);
          if (PF) this.strokes[i].draw(ctx, this.drawn[i], 1, PF);
          else {
            ctx.strokeStyle = this.styleFor(this.strokes[i]);
            this.strokes[i].draw(ctx, this.drawn[i], 1);
          }
          this.drawn[i] = 1;
          forced = true;
          advanced = true;
          if (this.onAdvance) this.onAdvance(this.strokes[i]);
        }
      }
      if (PF && forced) ctx.stroke(PF);
      this.complete = true;
    }
    return advanced;
  }
}

export class RevealAnimator {
  constructor(ast, options = {}) {
    this.ast = ast;
    this.opts = Object.assign({}, DEFAULTS, options);
    this.strokes = extractStrokes(ast);
    this._rafId = null;
    this.running = false;
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  play(ctx, hooks = {}) {
    if (this.isEmpty) {
      if (hooks.onDone) hooks.onDone();
      return;
    }
    this.cancel();
    const o = this.opts;

    // Staged color composites two separate layers (mono + color) so a color
    // stroke is never blended on top of its monochrome underlayer — stacking
    // them darkens AA edges and stroke crossings. Each mono stroke is retired
    // with an exact-footprint destination-out erase (same path, same width):
    // a wider erase would punch a white halo around every colorized stroke and
    // make the whole frame look washed out until the final repaint.
    const staged = o.colorMode === "staged" && o.extractColor !== false;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const baseTransform = ctx.getTransform();
    let monoCanvas = null;
    let monoCtx = null;
    let colorCanvas = null;
    let colorCtx = null;
    if (staged) {
      monoCanvas = document.createElement("canvas");
      colorCanvas = document.createElement("canvas");
      monoCanvas.width = colorCanvas.width = width;
      monoCanvas.height = colorCanvas.height = height;
      monoCtx = monoCanvas.getContext("2d");
      colorCtx = colorCanvas.getContext("2d");
      for (const c of [monoCtx, colorCtx]) {
        c.setTransform(baseTransform);
        c.lineJoin = "round";
        c.lineCap = "round";
        c.lineWidth = o.lineWidth;
      }
    }
    const shapeCtx = staged ? monoCtx : ctx;
    const colorTargetCtx = staged ? colorCtx : ctx;

    const bbox = validBBox(this.ast.bounding_box);

    const styleOpts = {
      bitDepth: o.bitDepth,
      colorSpace: o.colorSpace,
      extractColor: o.extractColor,
    };
    const coloredStyle = (stroke) =>
      resolveStrokeStyle(ctx, stroke.colorStyle, bbox, {
        ...styleOpts,
        defCol: o.monoColor,
      });
    const monoStyle = () => o.monoColor;

    const rng = mulberry32(o.seed);
    const shapeKeys = computeScheduleKeys(o.mode, this.strokes, bbox, o.origin, rng);
    this.shapePass = new RevealPass(
      this.strokes,
      shapeKeys,
      o.colorMode === "staged" ? monoStyle : coloredStyle,
      staged ? { onAdvance: markDirty, batch: true } : {},
    );

    this.colorPass = null;
    if (staged) {
      const cMode = o.colorStrategy === "follow" ? o.mode : o.colorStrategy;
      const colorKeys = computeScheduleKeys(cMode, this.strokes, bbox, o.origin, rng);
      const lag = clamp01(o.colorLag);
      // Compress the color schedule into the tail of the timeline.
      const shifted = colorKeys.map((k) => lag + k * (1 - lag));
      this.colorPass = new RevealPass(this.strokes, shifted, coloredStyle, {
        onStrokeStart: (i) => {
          monoCtx.save();
          monoCtx.globalCompositeOperation = "destination-out";
          monoCtx.strokeStyle = "#000";
          monoCtx.lineWidth = o.lineWidth;
          this.strokes[i].draw(monoCtx, 0, 1);
          monoCtx.restore();
        },
        onAdvance: markDirty,
      });
    }

    // Dirty-rect tracking: compositing two full-size layers every frame is
    // the dominant cost on large canvases and the reason staged reveals felt
    // janky with many paths. Instead, remember which strokes advanced this
    // frame and refresh only their (padded) screen-space bounding rect.
    let dirty = null; // [x0, y0, x1, y1] device pixels, or "full"
    const PAD = 4;
    function markDirty(stroke) {
      if (dirty === "full" || !stroke.bbox || !baseTransform) {
        dirty = "full";
        return;
      }
      const m = baseTransform;
      const xs = [
        m.a * stroke.bbox[0] + m.c * stroke.bbox[1] + m.e,
        m.a * stroke.bbox[2] + m.c * stroke.bbox[1] + m.e,
        m.a * stroke.bbox[0] + m.c * stroke.bbox[3] + m.e,
        m.a * stroke.bbox[2] + m.c * stroke.bbox[3] + m.e,
      ];
      const ys = [
        m.b * stroke.bbox[0] + m.d * stroke.bbox[1] + m.f,
        m.b * stroke.bbox[2] + m.d * stroke.bbox[1] + m.f,
        m.b * stroke.bbox[0] + m.d * stroke.bbox[3] + m.f,
        m.b * stroke.bbox[2] + m.d * stroke.bbox[3] + m.f,
      ];
      const r = [
        Math.min(...xs) - PAD,
        Math.min(...ys) - PAD,
        Math.max(...xs) + PAD,
        Math.max(...ys) + PAD,
      ];
      if (!dirty) dirty = r;
      else {
        dirty[0] = Math.min(dirty[0], r[0]);
        dirty[1] = Math.min(dirty[1], r[1]);
        dirty[2] = Math.max(dirty[2], r[2]);
        dirty[3] = Math.max(dirty[3], r[3]);
      }
    }
    const composite = () => {
      if (!staged || !dirty) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (dirty === "full") {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(monoCanvas, 0, 0);
        ctx.drawImage(colorCanvas, 0, 0);
      } else {
        const x = Math.max(0, Math.floor(dirty[0]));
        const y = Math.max(0, Math.floor(dirty[1]));
        const w = Math.min(width, Math.ceil(dirty[2])) - x;
        const h = Math.min(height, Math.ceil(dirty[3])) - y;
        if (w > 0 && h > 0) {
          ctx.clearRect(x, y, w, h);
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.drawImage(monoCanvas, 0, 0);
          ctx.drawImage(colorCanvas, 0, 0);
        }
      }
      ctx.restore();
      dirty = null;
    };

    this.running = true;
    this._start = performance.now();
    this._prevT = 0;
    const tick = (now) => {
      if (!this.running) return;
      const duration = Math.max(this.opts.durationMs, 1);
      const t = clamp01((now - this._start) / duration);
      this.shapePass.drawRange(shapeCtx, this._prevT, t);
      if (this.colorPass) this.colorPass.drawRange(colorTargetCtx, this._prevT, t);
      composite();
      this._prevT = t;
      if (hooks.onFrame) hooks.onFrame();
      if (t >= 1 && this.shapePass.complete && (!this.colorPass || this.colorPass.complete)) {
        this.running = false;
        if (staged) {
          // The staged resting frame IS the final accumulated animation frame:
          // callers keep it as-is (no clean repaint), so there is nothing to
          // dissolve and no brightness step at completion.
          dirty = "full";
          composite();
          if (hooks.onDone) hooks.onDone();
          return;
        }
        composite();
        this._startCompletionFade(ctx, hooks);
        return;
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // Non-staged reveals end with a caller clean repaint whose per-pixel alpha
  // accumulation can differ slightly from the incremental frame. Dissolve the
  // pre-done frame into the freshly repainted one over ~400ms; the final fade
  // frame IS the clean repaint, so nothing is left behind. Staged reveals skip
  // this entirely (their resting frame is the last animation frame).
  _startCompletionFade(ctx, hooks) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const snap = () => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      c.getContext("2d").drawImage(ctx.canvas, 0, 0);
      return c;
    };
    const before = snap();
    if (hooks.onDone) hooks.onDone();
    const after = snap();
    const FADE_MS = 400;
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp01((now - t0) / FADE_MS);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(after, 0, 0);
      if (k < 1) {
        ctx.globalAlpha = 1 - k;
        ctx.drawImage(before, 0, 0);
        ctx.restore();
        this._fadeId = requestAnimationFrame(step);
      } else {
        ctx.restore();
        this._fadeId = null;
        this._fade = null;
      }
    };
    this._fade = { before, after, ctx };
    this._fadeId = requestAnimationFrame(step);
  }

  cancel() {
    this.running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    // Finalize an in-flight completion fade to its end state so a cancelled
    // animator never leaves a stale overlay on the caller's canvas.
    if (this._fadeId !== null) {
      cancelAnimationFrame(this._fadeId);
      this._fadeId = null;
    }
    if (this._fade) {
      const { after, ctx } = this._fade;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.drawImage(after, 0, 0);
      ctx.restore();
      this._fade = null;
    }
  }
}
