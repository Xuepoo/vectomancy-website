export class InputHandler {
  constructor(renderer) {
    this.r = renderer;
    this.dragTarget = null;
    this.startX = 0;
    this.startY = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.activeTouchId = null;

    const cvs = this.r.canvas;
    cvs.addEventListener("mousedown", (e) => this.down(e.clientX, e.clientY));
    cvs.addEventListener("mousemove", (e) => this.move(e.clientX, e.clientY));
    cvs.addEventListener("mouseup", (e) => this.up(e.clientX, e.clientY));
    cvs.addEventListener("mouseleave", (e) => this.up(e.clientX, e.clientY));

    cvs.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (this.activeTouchId !== null) return;
        this.activeTouchId = e.changedTouches[0].identifier;
        this.down(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      },
      { passive: false },
    );

    cvs.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.activeTouchId) {
            this.move(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
          }
        }
      },
      { passive: false },
    );

    const handleTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.activeTouchId) {
          this.activeTouchId = null;
          this.up(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
        }
      }
    };
    cvs.addEventListener("touchend", handleTouchEnd);
    cvs.addEventListener("touchcancel", handleTouchEnd);
  }

  down(x, y) {
    this.startX = x;
    this.startY = y;
    let ent = this.r.hitTest(x, y);
    if (ent) {
      this.dragTarget = ent;
      ent.isDragging = true;
      ent.dragOriginX = ent.x;
      ent.dragOriginY = ent.y;
      ent.vx = 0;
      ent.vy = 0;
      this.offsetX = x - ent.x;
      this.offsetY = y - ent.y;

      // Promote Z-index
      let i = this.r.entities.indexOf(ent);
      if (i !== -1) {
        this.r.entities.splice(i, 1);
        this.r.entities.push(ent);
      }
      document.body.style.cursor = "grabbing";
    }
  }

  move(x, y) {
    if (this.dragTarget) {
      // Historical speed for inertia
      this.dragTarget.vx = (x - this.offsetX - this.dragTarget.x) * 0.5;
      this.dragTarget.vy = (y - this.offsetY - this.dragTarget.y) * 0.5;
      this.dragTarget.x = x - this.offsetX;
      this.dragTarget.y = y - this.offsetY;
    }
  }

  up(x, y) {
    if (this.dragTarget) {
      let dist = Math.hypot(x - this.startX, y - this.startY);
      if (dist < 5 && this.dragTarget.targetUrl) {
        window.location.href = this.dragTarget.targetUrl; // Click
      }
      this.dragTarget.isDragging = false;
      this.dragTarget = null;
      document.body.style.cursor = "default";
    }
  }
}
