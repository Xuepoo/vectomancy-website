export class MathEntity {
  constructor(config, ast) {
    this.id = config.id;
    this.x = config.x;
    this.y = config.y;
    this.scale = config.scale || 1.0;
    this.targetUrl = config.targetUrl || null;
    this.ast = ast;
    this.vx = 0;
    this.vy = 0;
    this.isDragging = false;
    this.paths = []; // { path: Path2D, color: string }
    if (this.ast && this.ast.bounding_box) {
      let [minX, minY, maxX, maxY] = this.ast.bounding_box;
      this.cx = minX + (maxX - minX) / 2;
      this.cy = minY + (maxY - minY) / 2;
      this.halfW = (maxX - minX) / 2;
      this.halfH = (maxY - minY) / 2;
      this.radius = Math.max(this.halfW, this.halfH);
    } else {
      this.cx = 0;
      this.cy = 0;
      this.radius = 50;
    }
    this.buildPath();
  }

  buildPath() {
    if (!this.ast) return;

    // Support dummy mock format (Task 1)
    if (this.ast.paths) {
      this.path = new Path2D();
      for (const p of this.ast.paths) {
        for (const cmd of p.commands) {
          if (cmd.type === 'M') this.path.moveTo(cmd.x, cmd.y);
          else if (cmd.type === 'C') this.path.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
          else if (cmd.type === 'L') this.path.lineTo(cmd.x, cmd.y);
        }
      }
      return;
    }

    if (this.ast.type === "Spline" && this.ast.equations) {
      for (const eq of this.ast.equations) {
        let p2d = new Path2D();
        let color = '#fff';
        if (eq.color_rgb && eq.color_rgb.length >= 3) {
          // color_rgb is usually [r, g, b] 0-1 range
          let r = Math.round(eq.color_rgb[0] * 255);
          let g = Math.round(eq.color_rgb[1] * 255);
          let b = Math.round(eq.color_rgb[2] * 255);
          color = `rgb(${r},${g},${b})`;
        }

        for (const seg of eq.data) {
          const steps = 15;
          let first = true;
          for (let i = 0; i <= steps; i++) {
            let local_t = i / steps;
            let x = 0;
            for (let j = 0; j < seg.x_poly.length; j++) x += seg.x_poly[j] * Math.pow(local_t, j);
            let y = 0;
            for (let j = 0; j < seg.y_poly.length; j++) y += seg.y_poly[j] * Math.pow(local_t, j);

            if (first) { p2d.moveTo(x, y); first = false; }
            else { p2d.lineTo(x, y); }
          }
        }
        this.paths.push({ path: p2d, color: color });
      }
    }

    // Cache to OffscreenCanvas for 60fps performance
    if (this.paths.length > 0 && this.ast.bounding_box) {
      let [minX, minY, maxX, maxY] = this.ast.bounding_box;
      let w = maxX - minX;
      let h = maxY - minY;

      // Ensure canvas is at least 1x1 to prevent errors
      w = Math.max(1, Math.ceil(w));
      h = Math.max(1, Math.ceil(h));

      // Pad slightly for strokes
      const padding = 10;
      this.offscreenCanvas = new OffscreenCanvas(w + padding * 2, h + padding * 2);
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
      this.offscreenCtx.translate(-minX + padding, -minY + padding);

      for (const p of this.paths) {
        this.offscreenCtx.strokeStyle = p.color || '#fff';
        this.offscreenCtx.lineWidth = 2; // Original logic
        this.offscreenCtx.stroke(p.path);
      }

      // We can drop the paths to save memory since we have the rasterized canvas now
      this.paths = null;
      this.drawOffsetX = minX - padding;
      this.drawOffsetY = minY - padding;
    }
  }
}
