# Cloudflare Workers D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the album site so it can run on Cloudflare Workers Static Assets with D1-backed APIs while preserving the current Node deployment.

**Architecture:** Keep `public/` as static assets. Move API response logic into a shared module with a storage interface, implement one adapter for local files and one for D1, and expose a Worker `fetch()` entry that serves `/api/*` from D1 and all other routes from `env.ASSETS`.

**Tech Stack:** Node.js ESM, Cloudflare Workers, Wrangler, D1, built-in `node:test`.

---

### Task 1: Lock API Behavior With Worker Tests

**Files:**
- Create: `src/shared.js`
- Create: `src/worker.js`
- Create: `scripts/test-worker-api.js`
- Modify: `package.json`

- [ ] Add a test that constructs a D1-like in-memory store and calls the Worker `fetch()` handler for health, home, albums, album detail, photos, and likes.
- [ ] Run `npm run test:worker` and verify it fails because `src/worker.js` does not exist.

### Task 2: Add Shared API Logic and Worker Entry

**Files:**
- Create: `src/shared.js`
- Create: `src/worker.js`

- [ ] Implement deterministic random helpers, URL normalization, album pagination, photo offset lookup, and likes handling in storage-agnostic functions.
- [ ] Implement Worker routing: `/api/*` uses D1 storage and non-API requests use `env.ASSETS.fetch(request)`.
- [ ] Run `npm run test:worker` and verify it passes.

### Task 3: Add D1 Schema and Exporter

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `scripts/export-d1-sql.js`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] Define D1 tables: `meta`, `albums`, `album_details`, `likes_albums`, `likes_photos`.
- [ ] Generate escaped SQL inserts from existing `data/albums.json`, `data/manifest.json`, and `data/photos/*.json`.
- [ ] Support `--limit` so test deployments can import a small dataset quickly.

### Task 4: Configure Wrangler and Verify Locally

**Files:**
- Create: `wrangler.toml`
- Modify: `README.md`

- [ ] Configure `main = "src/worker.js"`, `assets.directory = "./public"`, and D1 binding `DB`.
- [ ] Add docs for local preview, D1 creation, import, and deployment.
- [ ] Run `npm run check`, `npm run test:photos`, `npm run test:worker`, and Wrangler dry-run/deploy checks.

### Task 5: Test Deploy

**Files:**
- Modify after Cloudflare returns IDs: `wrangler.toml`

- [ ] Create a D1 test database.
- [ ] Apply schema and import a small test data export.
- [ ] Deploy a test Worker and verify `/api/health`, `/api/albums`, `/api/photos`, and page load.
