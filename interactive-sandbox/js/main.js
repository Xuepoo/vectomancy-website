import { MathEntity } from './entity.js';
import { Renderer } from './renderer.js';
import { InputHandler } from './input.js';
import { updatePhysics } from './physics.js';

let renderer;
let lastTime = 0;

async function init() {
  try {
    const scene = await fetch('./js/scene.json').then(r => r.json());
    renderer = new Renderer('app', scene.theme);
    new InputHandler(renderer);

    const a11yTree = document.getElementById('a11y-tree');
    for (const cfg of scene.entities) {
      const ast = await fetch(`./${cfg.url}`).then(r => r.json());
      const ent = new MathEntity(cfg, ast);
      renderer.entities.push(ent);

      if (ent.targetUrl) {
        const link = document.createElement('a');
        link.href = ent.targetUrl;
        link.textContent = `Navigate to ${ent.id}`;
        link.addEventListener('focus', () => { ent.isDragging = true; });
        link.addEventListener('blur', () => { ent.isDragging = false; });
        a11yTree.appendChild(link);
      }
    }

    document.getElementById('loader').style.display = 'none';
  const feedbackBtn = document.getElementById('feedback-btn');
  const feedbackModal = document.getElementById('feedback-modal');
  const closeFeedback = document.getElementById('close-feedback');
  const submitFeedback = document.getElementById('submit-feedback');
  const feedbackText = document.getElementById('feedback-text');

  feedbackBtn.addEventListener('click', () => {
    feedbackModal.classList.remove('hidden');
    feedbackText.focus();
  });

  closeFeedback.addEventListener('click', () => {
    feedbackModal.classList.add('hidden');
  });

  submitFeedback.addEventListener('click', async () => {
    const text = feedbackText.value.trim();
    if (!text) return;

    submitFeedback.textContent = "Sending...";
    submitFeedback.disabled = true;

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (res.ok) {
        feedbackText.value = '';
        feedbackModal.classList.add('hidden');
        alert("Thanks for your feedback!");
      } else {
        alert("Failed to send feedback.");
      }
    } catch (e) {
      alert("Network error.");
    } finally {
      submitFeedback.textContent = "Submit";
      submitFeedback.disabled = false;
    }
  });

  requestAnimationFrame(loop);
  } catch (e) {
    document.getElementById('loader').textContent = "Error: " + e.message;
  }
}

function loop(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  updatePhysics(renderer.entities, renderer.canvas.width, renderer.canvas.height, dt);
  renderer.render(dt);

  requestAnimationFrame(loop);
}

init();
