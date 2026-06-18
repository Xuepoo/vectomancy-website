export function updatePhysics(entities, canvasWidth, canvasHeight, dt) {
  const friction = 0.9;
  for (let i = 0; i < entities.length; i++) {
    let a = entities[i];
    if (!a.isDragging) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.vx *= Math.pow(friction, dt * 60);
      a.vy *= Math.pow(friction, dt * 60);

      const halfW = (a.halfW || a.radius || 50) * a.scale;
      const halfH = (a.halfH || a.radius || 50) * a.scale;
      const cx = (a.cx || 0) * a.scale;
      const cy = (a.cy || 0) * a.scale;
      // Keep within bounds, but only if the object actually fits on screen!
      if (halfW * 2 <= canvasWidth) {
        if (a.x + cx - halfW < 0) { a.vx *= -0.5; a.x = halfW - cx; }
        else if (a.x + cx + halfW > canvasWidth) { a.vx *= -0.5; a.x = canvasWidth - halfW - cx; }
      }

      if (halfH * 2 <= canvasHeight) {
        if (a.y + cy - halfH < 0) { a.vy *= -0.5; a.y = halfH - cy; }
        else if (a.y + cy + halfH > canvasHeight) { a.vy *= -0.5; a.y = canvasHeight - halfH - cy; }
      }
    }
  }
}
