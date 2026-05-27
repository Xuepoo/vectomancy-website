# 🌐 Vectomancy Web

![Vectomancy Pro](https://img.shields.io/badge/Status-Production%20Ready-success)
![Lighthouse](https://img.shields.io/badge/Lighthouse-100%2F100-brightgreen)
![Tech Stack](https://img.shields.io/badge/Tech-Rust%20%7C%20WASM%20%7C%20Zola-blue)

The official web frontend for the **Vectomancy** mathematical engine. This repository houses a blazing-fast, static, zero-server Single Page Application (SPA) that compiles the core Rust engine into WebAssembly (WASM) to run complex mathematical calculations (Spline, Fourier, Chaikin) directly in the browser.

🔗 **Live Site:** [https://vectomancy.xuepoo.xyz](https://vectomancy.xuepoo.xyz)

---

## 🏗️ Architecture

This repository is split into two primary components:

1. **`wasm-engine/` (The Brain)**
   - A Rust crate that bridges the core `vectomancy` parser and math engine to JavaScript using `wasm-bindgen` and `serde-wasm-bindgen`.
   - Modifies file I/O to use zero-copy `Uint8Array` memory buffers (`parse_memory(&[u8])`).
   - Gracefully strips out multithreading (`rayon`) and hardware GPU APIs (`wgpu`) to ensure seamless compilation to `wasm32-unknown-unknown`.

2. **`zola-site/` (The Face)**
   - A statically generated website built with Zola.
   - Utilizes `nes.css` for a nostalgic 8-bit aesthetic.
   - Features an "Offscreen Canvas" rendering pipeline to handle tens of thousands of generated mathematical vectors at 60 FPS without DOM lag.
   - Strictly optimized for Lighthouse scores (97~100): assets are highly compressed, and fonts/CSS are strictly self-hosted via a Cloudflare R2 CDN (`cdn.xuepoo.xyz`) to eliminate render-blocking requests.

---

## 🚀 Development Setup

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Zola](https://www.getzola.org/documentation/getting-started/installation/)
- [Bun](https://bun.sh/) or npm (for Wrangler deployment)

### 1. Build the WASM Engine
You must compile the Rust code into WebAssembly before starting the frontend server.

```bash
cd wasm-engine
wasm-pack build --target web --out-dir ../zola-site/static/wasm
```

### 2. Run the Local Development Server
Serve the frontend locally to test changes.

```bash
cd zola-site
zola serve
```
The site will be available at `http://127.0.0.1:1111`.

---

## 📦 Deployment (Cloudflare Pages)

The production environment is hosted on **Cloudflare Pages**.

**CRITICAL RULE:** Cloudflare Pages restricts SEO indexing on preview branches. To deploy to the live production domain (`vectomancy.xuepoo.xyz`), you **must** deploy explicitly to the `main` branch.

```bash
cd zola-site
zola build
wrangler pages deploy public --project-name vectomancy --branch main
```

### Asset Management (R2)
Heavy assets like gallery images and presets are hosted on Cloudflare R2 and served via the edge-cached custom domain `https://cdn.xuepoo.xyz`.

Upload new assets via:
```bash
wrangler r2 object put "cdn-xuepoo-xyz/vectomancy/path/to/file" --file "./local/file" --remote
```

---

## ♿ Performance & SEO Constraints

When contributing to this repository, you must adhere to the following standards:

1. **No External Blocking Resources:** Do not link to `fonts.googleapis.com` or `unpkg.com`. Download fonts/CSS and host them in `zola-site/static/`.
2. **Preloading:** Ensure critical WASM, font, and CSS files are preloaded in the `<head>` of HTML templates.
3. **Accessibility (A11y):** All UI controls (buttons, inputs, sliders) must have explicit `aria-label` attributes for screen readers.
4. **Layout Stability:** All images (especially in the gallery) must have explicit `width` and `height` attributes to prevent Cumulative Layout Shift (CLS).

---
*Powered by Rust, Math, and a love for the retro web.*
