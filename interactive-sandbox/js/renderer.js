export class Renderer {
  constructor(canvasId, themeClearColor) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.entities = [];
    this.themeClearColor = themeClearColor || "rgba(17, 17, 17, 0.2)";
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    let parent = this.canvas.parentElement;
    if (parent && parent.tagName !== "BODY") {
      const rect = parent.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
    } else {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
  }

  hitTest(x, y) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      let ent = this.entities[i];
      let localX = (x - ent.x) / ent.scale;
      let localY = (y - ent.y) / ent.scale;
      let hit = false;
      if (ent.ast && ent.ast.bounding_box) {
        let [minX, minY, maxX, maxY] = ent.ast.bounding_box;
        if (localX >= minX && localX <= maxX && localY >= minY && localY <= maxY) hit = true;
      } else {
        if (Math.hypot(localX, localY) < 50) hit = true;
      }
      if (hit) return ent;
    }
    return null;
  }

  render(deltaTime) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const ent of this.entities) {
      this.ctx.save();

      // If dragging, draw original position ghosted
      let drawX = ent.isDragging && ent.dragOriginX !== undefined ? ent.dragOriginX : ent.x;
      let drawY = ent.isDragging && ent.dragOriginY !== undefined ? ent.dragOriginY : ent.y;

      this.ctx.translate(drawX, drawY);
      this.ctx.scale(ent.scale, ent.scale);

      if (ent.isDragging) {
        this.ctx.globalAlpha = 0.3; // ghost effect for original
      }

      this.ctx.lineWidth = 2 / ent.scale;

      if (ent.offscreenCanvas) {
        this.ctx.drawImage(ent.offscreenCanvas, ent.drawOffsetX, ent.drawOffsetY);
      } else if (ent.paths && ent.paths.length > 0) {
        for (const p of ent.paths) {
          this.ctx.strokeStyle = p.color || "#fff";
          this.ctx.stroke(p.path);
        }
      } else if (ent.path) {
        this.ctx.strokeStyle = ent.ast.color || "#fff";
        this.ctx.stroke(ent.path);
      }

      this.ctx.restore();

      // If dragging, draw target outline bounding box
      if (ent.isDragging) {
        this.ctx.save();
        this.ctx.translate(ent.x, ent.y);
        let s = ent.scale;
        this.ctx.scale(s, s);

        this.ctx.shadowColor = "rgba(255,255,255,0.8)";
        this.ctx.shadowBlur = 10;
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        this.ctx.lineWidth = 4 / s;
        this.ctx.setLineDash([15 / s, 15 / s]);

        if (ent.ast && ent.ast.bounding_box) {
          let [minX, minY, maxX, maxY] = ent.ast.bounding_box;
          this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        } else {
          this.ctx.beginPath();
          this.ctx.arc(0, 0, 50, 0, Math.PI * 2);
          this.ctx.stroke();
        }
        this.ctx.restore();
      }
    }
  }
}
