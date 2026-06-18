#!/bin/bash
# Vectomancy Website Deploy Script
# Usage: ./deploy.sh

set -e

PROJECT_DIR="/mnt/data/Workspace/Projects/vectomancy/vectomancy-web"
WASM_DIR="$PROJECT_DIR/wasm-engine"
ZOLA_DIR="$PROJECT_DIR/zola-site"

echo "=== Building WASM Engine ==="
cd "$WASM_DIR"
RUSTFLAGS="" wasm-pack build --target web --out-dir ../zola-site/static/wasm
echo "✓ WASM built"

echo "=== Building Zola Site ==="
cd "$ZOLA_DIR"
zola build
echo "✓ Site built"

echo "=== Deploying to Cloudflare Pages ==="
cd "$ZOLA_DIR"
wrangler pages deploy public --project-name=vectomancy --branch=main --commit-dirty=true
echo "✓ Deployed!"

echo "=== Done! ==="
echo "https://vectomancy.xuepoo.xyz"
