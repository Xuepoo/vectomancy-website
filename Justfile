default:
    @just --list

# ── Development ───────────────────────────────────────────────────────────────

# Start Zola local preview server
dev:
    @echo "=== Starting local Zola preview server ==="
    cd zola-site && zola serve

# Build the WASM engine bridge
build-wasm:
    @echo "=== Building WASM Engine ==="
    cd wasm-engine && wasm-pack build --target web --out-dir ../zola-site/static/wasm

# Build Zola static site
build:
    @echo "=== Building Zola site ==="
    cd zola-site && zola build

# ── Quality Gates ─────────────────────────────────────────────────────────────

# Run all pre-commit hooks (lint + format + type checks)
test:
    @echo "=== Running quality gates ==="
    pre-commit run --all-files

# Run only prettier formatting on JS/CSS/YAML/JSON
fmt:
    @echo "=== Formatting JS/CSS/YAML/JSON ==="
    pre-commit run prettier --all-files

# Run only rust formatter on WASM engine
fmt-rust:
    @echo "=== Formatting Rust (WASM engine) ==="
    cd wasm-engine && cargo fmt

# Run clippy linter on WASM engine
lint-rust:
    @echo "=== Linting Rust (WASM engine) ==="
    cd wasm-engine && cargo clippy -- -D warnings

# Run markdownlint on all Markdown files
lint-md:
    @echo "=== Linting Markdown ==="
    pre-commit run markdownlint --all-files

# ── Git workflow ──────────────────────────────────────────────────────────────

# Git status
status:
    @git status

# Stage all and commit with a message (usage: just commit "feat(web): message")
commit message="":
    @if [ -z "{{message}}" ]; then \
        echo "Error: Commit message required. Usage: just commit \"feat(web): description\""; \
        exit 1; \
    fi
    @git add -A
    @git commit -m "{{message}}"

# Push to remote
push:
    @echo "=== Pushing commits to GitHub ==="
    HTTPS_PROXY=http://127.0.0.1:1080 git push origin main

# ── Deployment ────────────────────────────────────────────────────────────────

# Full deploy pipeline: quality gate → build → CF Pages deploy
deploy: test build
    @echo "=== Deploying to Cloudflare Pages ==="
    cd zola-site && wrangler pages deploy public --project-name vectomancy --branch main --commit-dirty=true

# Deploy without running tests (quick re-deploy)
deploy-fast: build
    @echo "=== Quick deploy (no tests) ==="
    cd zola-site && wrangler pages deploy public --project-name vectomancy --branch main --commit-dirty=true

# Run D1 migration remotely
migrate:
    @echo "=== Running D1 migration ==="
    cd zola-site && wrangler d1 migrations apply vectomancy_db --remote
