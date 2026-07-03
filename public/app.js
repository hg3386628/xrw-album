const app = document.querySelector("#app");
const imageSizeCache = new Map();
const pendingLikes = new Map();

const PAGE_SIZE = 32;
const PHOTO_PAGE_SIZE = 72;
const PHOTO_ROWS_PER_PAGE = 8;
const DETAIL_ROWS_PER_PAGE = 8;
const DETAIL_SIZE_KEY = "xrw-album-detail-size";
const PREFETCH_DELAY = 120;
const ALBUM_PAGE_RENDER_MARGIN = 900;
const PHOTO_PAGE_RENDER_MARGIN = 650;
const DETAIL_PAGE_RENDER_MARGIN = 650;
const IMAGE_SIZE_CACHE_LIMIT = 1600;
const MAX_RENDERED_ALBUM_PAGES = 2;
const MAX_RENDERED_PHOTO_PAGES = 2;
const MAX_RENDERED_DETAIL_PAGES = 2;
const STATIC_DATA_BASE = window.__XRW_STATIC_DATA_BASE || "";
const BASE_PATH = normalizeBasePath(window.__XRW_BASE_PATH || "");

let homeManifest = null;
let activeTab = "photos";
let infiniteObserver = null;
let searchTimer = null;
let searchPage = 1;
let searchQuery = "";
let currentAlbum = null;
let lightboxIndex = null;
let touchStart = null;
let lastTap = 0;
let detailImageScale = readDetailImageScale();
let tabs = createTabsState();
let albumSyncFrame = null;
let photoSyncFrame = null;
let photoResizeTimer = null;
let photoRelayoutTimer = null;
let detailSyncFrame = null;
let detailResizeTimer = null;
let detailRelayoutTimer = null;
let lastAutoLoadAt = 0;

const staticData = {
  manifest: null,
  albums: null,
  details: new Map(),
  shards: new Map(),
  albumOffsets: null,
  randomAlbums: new Map(),
  likes: readStaticLikes()
};

function normalizeBasePath(value) {
  const path = String(value || "").replace(/\/+$/, "");
  return path === "/" ? "" : path;
}

function appPathname() {
  const pathname = location.pathname || "/";
  if (BASE_PATH && (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`))) {
    return pathname.slice(BASE_PATH.length) || "/";
  }
  return pathname;
}

function appUrl(path) {
  if (!BASE_PATH || /^https?:\/\//i.test(path)) return path;
  return `${BASE_PATH}${path === "/" ? "" : path}`;
}

function dataUrl(path) {
  const base = STATIC_DATA_BASE || `${BASE_PATH || ""}/data`;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function readStaticLikes() {
  try {
    return JSON.parse(localStorage.getItem("xrw-album-static-likes") || '{"albums":{},"photos":{}}');
  } catch {
    return { albums: {}, photos: {} };
  }
}

function saveStaticLikes() {
  try {
    localStorage.setItem("xrw-album-static-likes", JSON.stringify(staticData.likes));
  } catch {
    // Static GitHub Pages builds keep likes local when storage is available.
  }
}

function createTabsState() {
  return {
    photos: {
      photos: [],
      pages: [],
      page: 0,
      total: 0,
      hasMore: true,
      loading: false,
      prefetch: null,
      prefetching: false,
      prefetchKey: "",
      prefetchPromise: null,
      mode: "random",
      seed: String(Date.now()),
      photoLayoutKey: ""
    },
    recent: {
      albums: [],
      pages: [],
      page: 0,
      total: 0,
      hasMore: true,
      loading: false,
      prefetch: null,
      prefetching: false,
      prefetchKey: "",
      prefetchPromise: null,
      seed: "recent"
    },
    random: {
      albums: [],
      pages: [],
      page: 0,
      total: 0,
      hasMore: true,
      loading: false,
      prefetch: null,
      prefetching: false,
      prefetchKey: "",
      prefetchPromise: null,
      seed: String(Date.now())
    }
  };
}

const icons = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.2A8 8 0 0 1 9.8 4a6.5 6.5 0 1 0 10.2 10.2z" stroke-linejoin="round"></path></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>',
  search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8.8" cy="8.8" r="5.6"></circle><path d="m13 13 4 4"></path></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 8a6 6 0 1 1-1.76-4.24" stroke-linecap="round"></path><path d="M14 2v3.5h-3.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  arrow: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 11L11 3M11 3H5M11 3V9" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 2L3 7L9 12" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 2L12 12M12 2L2 12" stroke-linecap="round"></path></svg>',
  prev: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M10 2L4 8L10 14" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2L12 8L6 14" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  heart: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.2C.7 9.1 1.6 5.6 4.7 4.5c2-.7 4 .1 5.1 1.8l.2.3.2-.3c1.1-1.7 3.1-2.5 5.1-1.8 3.1 1.1 4 4.6 2.7 7.3C19.5 16.4 12 21 12 21z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"></path></svg>'
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeImageUrl(value) {
  return String(value || "")
    .replace("https://telegra.phhttps://legra.ph/file/", "https://telegra.ph/file/")
    .replace("https://telegra.phhttps//legra.ph/file/", "https://telegra.ph/file/");
}

function seedFrom(value) {
  const input = String(value || Date.now());
  let seed = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    seed ^= input.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function random(seed) {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function sample(source, count, seedValue) {
  const result = [];
  const used = new Set();
  const rand = random(seedFrom(seedValue));
  const limit = Math.min(count, source.length);

  while (result.length < limit) {
    const index = Math.floor(rand() * source.length);
    if (used.has(index)) continue;
    used.add(index);
    result.push(source[index]);
  }

  return result;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function coprimePhotoStep(total, seedValue) {
  if (total <= 1) return 0;
  let step = seedFrom(`step:${seedValue}`) % total;
  if (!step) step = 1;

  while (greatestCommonDivisor(step, total) !== 1) {
    step += 1;
    if (step >= total) step = 1;
  }

  return step;
}

function randomPhotoOffset(position, total, seedValue) {
  if (total <= 1) return 0;
  const step = coprimePhotoStep(total, seedValue);
  const shift = seedFrom(`shift:${seedValue}`) % total;
  return (position * step + shift) % total;
}

async function getJson(url, options) {
  if (STATIC_DATA_BASE && String(url).startsWith("/api/")) {
    return staticGetJson(url, options);
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    ...options
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function staticGetJson(url, options = {}) {
  const requestUrl = new URL(url, location.origin);
  const path = requestUrl.pathname;

  if ((options.method || "GET").toUpperCase() === "POST" && path === "/api/like") {
    return staticLikeResponse(options);
  }

  if (path === "/api/health") {
    const manifest = await staticManifest();
    return {
      ok: true,
      albumCount: manifest.albumCount,
      photoCount: manifest.photoCount,
      builtAt: manifest.builtAt
    };
  }

  if (path === "/api/home") {
    const manifest = await staticManifest();
    const albums = await staticAlbums();
    const seed = requestUrl.searchParams.get("seed") || Date.now();
    const recentSeed = requestUrl.searchParams.get("recentSeed");
    const recentAlbums = [...albums].reverse();
    return {
      ok: true,
      manifest,
      recentAlbums: (recentSeed ? sample(recentAlbums, 16, recentSeed) : recentAlbums.slice(0, 16)).map(withStaticLike),
      albums: sample(albums, 16, seed).map(withStaticLike)
    };
  }

  if (path === "/api/albums") {
    return staticAlbumsResponse(requestUrl);
  }

  if (path === "/api/photos") {
    return staticPhotosResponse(requestUrl);
  }

  if (path.startsWith("/api/album/")) {
    const id = decodeURIComponent(path.slice("/api/album/".length));
    const albums = await staticAlbums();
    const album = albums.find((item) => item.id === id);
    if (!album) throw new Error("Not found");
    const detail = await staticAlbumDetail(id);
    return {
      ok: true,
      album: withStaticLike(album),
      photos: detail.photos.map((photo) => ({
        ...photo,
        url: normalizeImageUrl(photo.url)
      })),
      likeCount: staticData.likes.albums[id] || 0
    };
  }

  throw new Error(`Static route not found: ${path}`);
}

async function fetchStaticJson(path) {
  const response = await fetch(dataUrl(path), {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Static data failed: ${response.status}`);
  return response.json();
}

async function staticManifest() {
  if (!staticData.manifest) {
    staticData.manifest = await fetchStaticJson("manifest.json");
  }
  return staticData.manifest;
}

async function staticAlbums() {
  if (!staticData.albums) {
    staticData.albums = await fetchStaticJson("albums.json");
  }
  return staticData.albums;
}

async function staticAlbumDetail(id) {
  if (!staticData.details.has(id)) {
    const shardKey = id.slice(0, 3);
    if (!staticData.shards.has(shardKey)) {
      staticData.shards.set(shardKey, await fetchStaticJson(`photo-shards/${encodeURIComponent(shardKey)}.json`));
    }
    const detail = staticData.shards.get(shardKey)?.[id];
    if (!detail) throw new Error(`Static album detail not found: ${id}`);
    staticData.details.set(id, detail);
  }
  return staticData.details.get(id);
}

function withStaticLike(album) {
  return {
    ...album,
    cover: normalizeImageUrl(album.cover),
    likes: staticData.likes.albums[album.id] || 0
  };
}

function staticShuffledAlbums(albums, seedValue) {
  const key = String(seedValue || "default");
  if (staticData.randomAlbums.has(key)) return staticData.randomAlbums.get(key);

  const result = [...albums];
  const rand = random(seedFrom(key));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  staticData.randomAlbums.set(key, result);
  while (staticData.randomAlbums.size > 8) {
    staticData.randomAlbums.delete(staticData.randomAlbums.keys().next().value);
  }
  return result;
}

async function staticAlbumsResponse(requestUrl) {
  const albums = await staticAlbums();
  const query = (requestUrl.searchParams.get("q") || "").trim().toLocaleLowerCase();
  const mode = requestUrl.searchParams.get("mode") || "all";
  const seed = requestUrl.searchParams.get("seed") || "default";
  const page = Math.max(1, Number(requestUrl.searchParams.get("page") || 1));
  const limit = Math.min(48, Math.max(8, Number(requestUrl.searchParams.get("limit") || 24)));
  const matched = query
    ? albums.filter((album) => album.title.toLocaleLowerCase().includes(query))
    : mode === "recent"
      ? [...albums].reverse()
      : mode === "random"
        ? staticShuffledAlbums(albums, seed)
        : albums;
  const start = (page - 1) * limit;

  return {
    ok: true,
    mode,
    seed,
    page,
    limit,
    total: matched.length,
    albums: matched.slice(start, start + limit).map(withStaticLike)
  };
}

async function staticPhotoOffsets() {
  if (staticData.albumOffsets) return staticData.albumOffsets;

  const albums = [...await staticAlbums()].reverse();
  let running = 0;
  staticData.albumOffsets = albums.map((album) => {
    const entry = {
      album,
      start: running,
      end: running + album.count
    };
    running = entry.end;
    return entry;
  });
  return staticData.albumOffsets;
}

async function staticPhotoFromOffset(offset) {
  const offsets = await staticPhotoOffsets();
  const entry = offsets.find((item) => offset >= item.start && offset < item.end);
  if (!entry) return null;
  const detail = await staticAlbumDetail(entry.album.id);
  const photo = detail.photos[offset - entry.start];
  if (!photo) return null;
  return {
    id: `${entry.album.id}-${photo.id}`,
    albumId: entry.album.id,
    albumTitle: entry.album.title,
    albumHref: entry.album.href,
    photoId: photo.id,
    url: normalizeImageUrl(photo.url)
  };
}

async function staticPhotosResponse(requestUrl) {
  const manifest = await staticManifest();
  const requestedMode = requestUrl.searchParams.get("mode");
  const mode = requestedMode === "random" ? "random" : "sequence";
  const seed = requestUrl.searchParams.get("seed") || "photos";
  const page = Math.max(1, Number(requestUrl.searchParams.get("page") || 1));
  const limit = Math.min(120, Math.max(24, Number(requestUrl.searchParams.get("limit") || 72)));
  const total = manifest.photoCount || 0;
  const start = (page - 1) * limit;
  const end = Math.min(start + limit, total);
  const photos = [];

  for (let position = start; position < end; position += 1) {
    const offset = mode === "random" ? randomPhotoOffset(position, total, seed) : position;
    const photo = await staticPhotoFromOffset(offset);
    if (photo) photos.push(photo);
  }

  return {
    ok: true,
    mode,
    seed,
    page,
    limit,
    total,
    photos
  };
}

async function staticLikeResponse(options) {
  let body = {};
  try {
    body = JSON.parse(options.body || "{}");
  } catch {
    throw new Error("Invalid request body");
  }

  const albumId = String(body.albumId || "");
  const albumDelta = Math.min(25, Math.max(0, Number(body.albumDelta || 0)));
  staticData.likes.albums[albumId] = (staticData.likes.albums[albumId] || 0) + albumDelta;

  if (Array.isArray(body.likes)) {
    for (const like of body.likes.slice(0, 100)) {
      const photoId = Number(like.photoId);
      const delta = Math.min(25, Math.max(0, Number(like.delta || 0)));
      if (!Number.isFinite(photoId) || delta <= 0) continue;
      const key = `${albumId}:${photoId}`;
      staticData.likes.photos[key] = (staticData.likes.photos[key] || 0) + delta;
    }
  }

  saveStaticLikes();
  return {
    ok: true,
    count: staticData.likes.albums[albumId] || 0
  };
}

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function rememberImageSize(key, size) {
  if (!key || imageSizeCache.has(key)) return false;
  imageSizeCache.set(key, size);
  while (imageSizeCache.size > IMAGE_SIZE_CACHE_LIMIT) {
    imageSizeCache.delete(imageSizeCache.keys().next().value);
  }
  return true;
}

function readDetailImageScale() {
  let stored = 100;
  try {
    stored = Number(localStorage.getItem(DETAIL_SIZE_KEY) || 100);
  } catch {
    stored = 100;
  }
  return Number.isFinite(stored) ? Math.min(300, Math.max(100, stored)) : 100;
}

function setDetailImageScale(value) {
  detailImageScale = Math.min(300, Math.max(100, Number(value) || 100));
  try {
    localStorage.setItem(DETAIL_SIZE_KEY, String(detailImageScale));
  } catch {
    // Storage can be blocked in private or restricted browser contexts.
  }
}

function setTheme(nextTheme) {
  document.documentElement.setAttribute("data-theme", nextTheme);
  try {
    localStorage.setItem("theme", nextTheme);
  } catch {
    // Theme still applies for the current page when storage is unavailable.
  }
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.innerHTML = nextTheme === "dark" ? icons.sun : icons.moon;
    button.setAttribute("aria-label", nextTheme === "dark" ? "切换到亮色模式" : "切换到暗色模式");
    button.setAttribute("title", nextTheme === "dark" ? "切换到亮色模式" : "切换到暗色模式");
  });
}

function currentTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    stored = null;
  }
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function themeButton() {
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="切换主题">${currentTheme() === "dark" ? icons.sun : icons.moon}</button>`;
}

function bindThemeButtons(root = document) {
  root.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  });
  setTheme(currentTheme());
}

function lazyImage(src, alt, eager = false) {
  const priority = eager ? "high" : "low";
  return `<img src="${escapeHtml(src)}" data-src-key="${escapeHtml(src)}" alt="${escapeHtml(alt)}" referrerpolicy="no-referrer" decoding="async" fetchpriority="${priority}" ${eager ? 'loading="eager"' : 'loading="lazy"'}>`;
}

function markLoadedImages(root = document, onSize) {
  root.querySelectorAll("img").forEach((image) => {
    const done = () => {
      const key = image.dataset.srcKey || image.currentSrc || image.src;
      const changed = image.naturalWidth > 0 && image.naturalHeight > 0
        ? rememberImageSize(key, {
            width: image.naturalWidth,
            height: image.naturalHeight
          })
        : false;
      image.classList.add("loaded");
      if (changed && onSize) onSize();
    };
    const failed = () => {
      image.classList.add("loaded", "broken");
      image.alt = image.alt || "图片加载失败";
    };
    if (image.complete && image.naturalWidth > 0) done();
    if (image.dataset.loadBound === "true") return;
    image.dataset.loadBound = "true";
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", failed, { once: true });
  });
}

function pageItemCount(page) {
  if (page.rows) return page.rows.reduce((total, row) => total + row.length, 0);
  return page.photos?.length || page.albums?.length || 0;
}

function tabLoadedCount(state) {
  if (state === tabs.photos) return state.photos.length;
  if (state.pages) return state.pages.reduce((total, page) => total + pageItemCount(page), 0);
  return state.photos?.length ?? state.albums?.length ?? 0;
}

function albumCard(album, index, eager = index < 8) {
  return `
    <button type="button" class="album-card" data-album-id="${escapeHtml(album.id)}" style="animation-delay:${Math.min(index * 38, 600)}ms">
      <span class="album-cover">
        ${album.cover ? lazyImage(album.cover, album.title, eager) : ""}
        <span class="album-overlay">
          <span class="album-overlay-title">${escapeHtml(album.title)}</span>
          <span class="album-overlay-count">${formatCount(album.count)} 张</span>
        </span>
        <span class="hover-arrow" aria-hidden="true">${icons.arrow}</span>
      </span>
    </button>
  `;
}

function headerTemplate(manifest) {
  return `
    <header class="home-header">
      <div class="brand" aria-label="墨影集">
        <span class="brand-mark"></span>
        <span class="brand-title">墨影集</span>
        <span class="brand-sub">MM Archive</span>
      </div>
      <label class="search-box">
        ${icons.search}
        <input class="search-input" name="q" type="search" placeholder="搜索图集" value="${escapeHtml(searchQuery)}" autocomplete="off">
      </label>
      <div class="header-actions">
        <span class="archive-count">${formatCount(manifest.albumCount)} Sets</span>
        ${themeButton()}
      </div>
    </header>
  `;
}

function resetPhotosState(mode = tabs.photos.mode || "sequence") {
  tabs.photos = {
    photos: [],
    pages: [],
    page: 0,
    total: homeManifest?.photoCount || tabs.photos.total || 0,
    hasMore: true,
    loading: false,
    prefetch: null,
    prefetching: false,
    prefetchKey: "",
    prefetchPromise: null,
    mode,
    seed: mode === "random" ? String(Date.now()) : "photos",
    photoLayoutKey: ""
  };
}

function updatePhotoOrderButtons() {
  app.querySelectorAll("[data-photo-mode]").forEach((button) => {
    const selected = button.dataset.photoMode === tabs.photos.mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function tabButtonTemplate(tab, title, sub) {
  const selected = activeTab === tab;
  const state = tabs[tab];
  return `
    <button
      type="button"
      class="home-tab ${selected ? "active" : ""}"
      data-tab="${tab}"
      role="tab"
      aria-selected="${selected}"
    >
      <span class="home-tab-title">${title}</span>
      <span class="home-tab-sub">${sub}</span>
      <span class="home-tab-count">${state.total ? formatCount(state.total) : ""}</span>
    </button>
  `;
}

function homeTemplate(data) {
  return `
    <div class="page-enter">
      ${headerTemplate(data.manifest)}
      <main class="home-body">
        <div id="search-results" class="search-results" hidden></div>
        <div id="home-tabs">
          <section class="home-tabs-section" aria-label="图库">
            <div class="tabs-head">
              <div class="home-tabs" role="tablist" aria-label="图库分类">
                ${tabButtonTemplate("photos", "全部图片", "All Photos")}
                ${tabButtonTemplate("recent", "最近更新", "Telegraph Archive")}
                ${tabButtonTemplate("random", "随机漫游", "Original Archive")}
              </div>
              <div class="tab-tools">
                <div class="photo-order-control ${activeTab === "photos" ? "" : "is-hidden"}" data-photo-order-control role="group" aria-label="全部图片排序">
                  <button type="button" class="photo-order-btn ${tabs.photos.mode === "sequence" ? "active" : ""}" data-photo-mode="sequence" aria-pressed="${tabs.photos.mode === "sequence"}">顺序</button>
                  <button type="button" class="photo-order-btn ${tabs.photos.mode === "random" ? "active" : ""}" data-photo-mode="random" aria-pressed="${tabs.photos.mode === "random"}">随机</button>
                </div>
                <label class="detail-size-control photo-size-control ${activeTab === "photos" ? "" : "is-hidden"}" data-photo-size>
                  <span class="detail-size-label">显示大小</span>
                  <input type="range" min="100" max="300" step="10" value="${detailImageScale}" data-home-size-slider aria-label="调整全部图片显示大小">
                  <span class="detail-size-value" data-home-size-value>${detailImageScale}%</span>
                </label>
                <button type="button" class="refresh-btn tab-refresh ${activeTab === "random" ? "" : "is-hidden"}" data-random-refresh>
                  ${icons.refresh}
                  <span>换一批</span>
                </button>
              </div>
            </div>
            <div class="tab-panel" role="tabpanel">
              <div data-tab-grid></div>
              <div class="infinite-status" data-tab-status></div>
              <div class="infinite-sentinel" data-infinite-sentinel aria-hidden="true"></div>
            </div>
          </section>
          <section class="home-footer">
            <div class="appreciate">
              <span class="appreciate-label">Archive</span>
              <span class="appreciate-title">从 ${formatCount(data.manifest.photoCount)} 张图片里，慢慢翻。</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  `;
}

function bindAlbumCards(root = document) {
  root.querySelectorAll("[data-album-id]").forEach((card) => {
    if (card.dataset.bound === "true") return;
    card.dataset.bound = "true";
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-album-id");
      navigate(`/album/${encodeURIComponent(id)}`);
    });
  });
}

function loading() {
  app.innerHTML = `
    <div class="detail-loading">
      <span class="detail-loading-dot"></span>
      <span class="detail-loading-dot"></span>
      <span class="detail-loading-dot"></span>
    </div>
  `;
}

function errorPanel(error) {
  app.innerHTML = `
    <div class="error-panel">
      <h1>加载失败</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <button class="more-btn" type="button" data-back>返回</button>
    </div>
  `;
  app.querySelector("[data-back]").addEventListener("click", () => navigate("/"));
}

async function renderHome() {
  loading();
  if (!homeManifest) {
    const health = await getJson("/api/health");
    homeManifest = {
      albumCount: health.albumCount,
      photoCount: health.photoCount,
      builtAt: health.builtAt
    };
  }
  tabs.photos.total ||= homeManifest.photoCount;
  tabs.recent.total ||= homeManifest.albumCount;
  tabs.random.total ||= homeManifest.albumCount;
  app.innerHTML = homeTemplate({ manifest: homeManifest });
  bindThemeButtons(app);
  bindHomeControls();
  if (searchQuery) {
    await runSearch(1);
  } else {
    await showActiveTab();
  }
}

function bindHomeControls() {
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTab = button.dataset.tab;
      app.querySelectorAll("[data-tab]").forEach((tabButton) => {
        const selected = tabButton.dataset.tab === activeTab;
        tabButton.classList.toggle("active", selected);
        tabButton.setAttribute("aria-selected", String(selected));
      });
      app.querySelector("[data-random-refresh]")?.classList.toggle("is-hidden", activeTab !== "random");
      app.querySelector("[data-photo-size]")?.classList.toggle("is-hidden", activeTab !== "photos");
      app.querySelector("[data-photo-order-control]")?.classList.toggle("is-hidden", activeTab !== "photos");
      if (!searchQuery) {
        window.scrollTo({ top: 0, behavior: "instant" });
        await showActiveTab();
      }
    });
  });

  app.querySelector("[data-random-refresh]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.classList.add("spinning");
    tabs.random = {
      albums: [],
      pages: [],
      page: 0,
      total: 0,
      hasMore: true,
      loading: false,
      prefetch: null,
      prefetching: false,
      prefetchKey: "",
      prefetchPromise: null,
      seed: String(Date.now())
    };
    activeTab = "random";
    await showActiveTab();
    setTimeout(() => button.classList.remove("spinning"), 700);
  });

  app.querySelectorAll("[data-photo-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextMode = button.dataset.photoMode === "random" ? "random" : "sequence";
      if (tabs.photos.mode === nextMode && nextMode !== "random") return;

      activeTab = "photos";
      resetPhotosState(nextMode);
      updatePhotoOrderButtons();
      app.querySelectorAll("[data-tab]").forEach((tabButton) => {
        const selected = tabButton.dataset.tab === activeTab;
        tabButton.classList.toggle("active", selected);
        tabButton.setAttribute("aria-selected", String(selected));
      });
      window.scrollTo({ top: 0, behavior: "instant" });
      await showActiveTab();
    });
  });

  const homeSizeSlider = app.querySelector("[data-home-size-slider]");
  homeSizeSlider?.addEventListener("input", () => {
    setDetailImageScale(homeSizeSlider.value);
    app.querySelectorAll("[data-home-size-value], [data-size-value]").forEach((node) => {
      node.textContent = `${detailImageScale}%`;
    });
    if (activeTab === "photos" && !searchQuery) renderTabGrid({ force: true });
  });

  const input = app.querySelector(".search-input");
  input.addEventListener("input", () => {
    searchQuery = input.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (searchQuery) await runSearch(1);
      else await showActiveTab();
    }, 220);
  });
}

async function showActiveTab() {
  const results = app.querySelector("#search-results");
  const tabsContainer = app.querySelector("#home-tabs");
  if (results) {
    results.hidden = true;
    results.innerHTML = "";
  }
  if (tabsContainer) tabsContainer.hidden = false;
  renderTabGrid();
  const state = tabs[activeTab];
  if (!tabLoadedCount(state) && state.hasMore) {
    await loadMoreActiveTab();
  }
  setupInfiniteScroll();
}

function renderTabGrid(options = {}) {
  const state = tabs[activeTab];
  const grid = app.querySelector("[data-tab-grid]");
  if (!grid) return;

  if (activeTab === "photos") {
    renderPhotoTabGrid(options);
    renderInfiniteStatus();
    return;
  }

  renderAlbumTabGrid(activeTab, options);
  renderInfiniteStatus();
}

function albumPageShell(entry) {
  const height = entry.height || (!entry.rendered ? estimateAlbumPageHeight(entry) : 0);
  const minHeight = height ? ` style="min-height:${Math.round(height)}px"` : "";
  return `<section class="album-page albums-grid ${entry.rendered ? "" : "is-placeholder"}" data-album-page="${entry.page}"${minHeight}></section>`;
}

function albumPageNearViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > -ALBUM_PAGE_RENDER_MARGIN && rect.top < window.innerHeight + ALBUM_PAGE_RENDER_MARGIN;
}

function albumGridMetrics(width) {
  const columns = width <= 520 ? 1 : width <= 760 ? 2 : width <= 1100 ? 3 : 4;
  const rowGap = width <= 520 ? 36 : width <= 760 ? 40 : Math.min(80, Math.max(44, width * 0.06));
  const columnGap = width <= 760 ? 16 : Math.min(40, Math.max(18, width * 0.03));
  return { columns, rowGap, columnGap };
}

function estimateAlbumPageHeight(entry) {
  const grid = app.querySelector("[data-tab-grid]");
  const width = grid?.clientWidth || Math.max(320, window.innerWidth - 32);
  const { columns, rowGap, columnGap } = albumGridMetrics(width);
  const rows = Math.ceil(entry.albums.length / columns);
  if (!rows) return 0;
  const cardWidth = (width - (columns - 1) * columnGap) / columns;
  const cardHeight = cardWidth * 4 / 3;
  return rows * cardHeight + (rows - 1) * rowGap;
}

function renderAlbumPage(entry) {
  const grid = app.querySelector("[data-tab-grid]");
  const page = grid?.querySelector(`[data-album-page="${entry.page}"]`);
  if (!grid || !page || entry.rendered) return;

  page.classList.remove("is-placeholder");
  page.style.minHeight = "";
  page.innerHTML = entry.albums
    .map((album, index) => albumCard(album, index, entry.page === 1 && index < 8))
    .join("");
  entry.rendered = true;
  bindAlbumCards(page);
  markLoadedImages(page);
  requestAnimationFrame(() => {
    entry.height = page.offsetHeight || entry.height;
    requestAlbumPageSync();
  });
}

function unrenderAlbumPage(entry) {
  const page = app.querySelector(`[data-album-page="${entry.page}"]`);
  if (!page || !entry.rendered) return;

  entry.height = page.offsetHeight || entry.height || estimateAlbumPageHeight(entry);
  page.innerHTML = "";
  page.style.minHeight = `${Math.max(1, Math.round(entry.height))}px`;
  page.classList.add("is-placeholder");
  entry.rendered = false;
}

function syncVisibleAlbumPages(options = {}) {
  if (appPathname() !== "/" || activeTab === "photos" || searchQuery) return;
  const state = tabs[activeTab];
  const grid = app.querySelector("[data-tab-grid]");
  if (!state?.pages || !grid) return;

  const candidates = state.pages
    .map((entry) => {
      const page = grid.querySelector(`[data-album-page="${entry.page}"]`);
      return page && albumPageNearViewport(page)
        ? { entry, distance: viewportDistance(page) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_RENDERED_ALBUM_PAGES);
  const allowed = new Set(candidates.map((candidate) => candidate.entry.page));

  state.pages.forEach((entry) => {
    const page = grid.querySelector(`[data-album-page="${entry.page}"]`);
    if (!page) return;
    if (allowed.has(entry.page)) {
      renderAlbumPage(entry, options);
    } else {
      unrenderAlbumPage(entry);
    }
  });
}

function requestAlbumPageSync(options = {}) {
  if (albumSyncFrame) return;
  albumSyncFrame = requestAnimationFrame(() => {
    albumSyncFrame = null;
    syncVisibleAlbumPages(options);
  });
}

function appendAlbumPage(tab, data) {
  const state = tabs[tab];
  const existing = state.pages.find((entry) => entry.page === data.page);
  if (existing) return;

  const entry = {
    page: data.page,
    albums: data.albums,
    height: 0,
    rendered: false
  };
  state.pages.push(entry);
  state.albums.push(...data.albums);
  if (appPathname() !== "/" || activeTab !== tab || searchQuery) return;

  const grid = app.querySelector("[data-tab-grid]");
  if (!grid) return;

  renderAlbumTabGrid(tab, { force: true });
}

function albumPageSignature(tab) {
  const state = tabs[tab];
  return `${tab}:${state.seed}:${state.pages.map((entry) => entry.page).join(",")}`;
}

function renderAlbumTabGrid(tab, options = {}) {
  const state = tabs[tab];
  const grid = app.querySelector("[data-tab-grid]");
  if (!state || !grid) return;
  if (appPathname() !== "/" || activeTab !== tab || searchQuery) return;

  const wasAlbumGrid = grid.dataset.gridKind === `albums:${tab}`;
  grid.className = "album-pages";
  grid.dataset.gridKind = `albums:${tab}`;
  delete grid.dataset.photoPages;
  const signature = albumPageSignature(tab);
  if (options.force || !wasAlbumGrid || grid.dataset.albumPages !== signature || grid.querySelector(".photo-page")) {
    grid.dataset.albumPages = signature;
    state.pages.forEach((entry) => {
      entry.rendered = false;
    });
    grid.innerHTML = state.pages.map(albumPageShell).join("");
  }
  syncVisibleAlbumPages(options);
}

function photoItem(photo, index, eager = false) {
  return `
    <button
      type="button"
      class="jr-item photo-tab-item"
      data-album-id="${escapeHtml(photo.albumId)}"
      title="${escapeHtml(photo.albumTitle)}"
      style="width:${photo.displayWidth}px;height:${photo.displayHeight}px"
    >
      ${lazyImage(photo.url, photo.albumTitle, eager)}
    </button>
  `;
}

function photoPageShell(entry) {
  const height = entry.height || (!entry.rendered ? estimatePhotoPageHeight(entry) : 0);
  const minHeight = height ? ` style="min-height:${Math.round(height)}px"` : "";
  return `<section class="photo-page ${entry.rendered ? "" : "is-placeholder"}" data-photo-page="${entry.page}"${minHeight}></section>`;
}

function photoPageNearViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > -PHOTO_PAGE_RENDER_MARGIN && rect.top < window.innerHeight + PHOTO_PAGE_RENDER_MARGIN;
}

function viewportDistance(element) {
  const rect = element.getBoundingClientRect();
  if (rect.bottom < 0) return Math.abs(rect.bottom);
  if (rect.top > window.innerHeight) return rect.top - window.innerHeight;
  return 0;
}

function photoLayoutConfig(grid) {
  const width = grid?.clientWidth || Math.max(320, window.innerWidth - 32);
  const baseHeight = width < 600 ? 150 : width < 1000 ? 210 : 260;
  const targetHeight = Math.round(baseHeight * detailImageScale / 100);
  const gap = width < 600 ? 5 : 8;
  return {
    width,
    targetHeight,
    gap,
    key: `${Math.round(width)}:${targetHeight}:${gap}`
  };
}

function rowFilledWidth(row, gap) {
  if (!row.length) return 0;
  return row.reduce((total, item) => total + item.displayWidth, 0) + (row.length - 1) * gap;
}

function createPhotoPages(photos, config, previousPages = [], holdLastPartialRow = false) {
  const indexedPhotos = photos.map((photo, index) => ({
    ...photo,
    sourceIndex: index
  }));
  const rows = rowLayoutRows(indexedPhotos, config.width, config.targetHeight, config.gap);
  const lastRow = rows[rows.length - 1];
  if (holdLastPartialRow && lastRow && rowFilledWidth(lastRow, config.gap) < config.width - 1) {
    rows.pop();
  }
  const pages = [];
  for (let index = 0; index < rows.length; index += PHOTO_ROWS_PER_PAGE) {
    const pageNumber = pages.length + 1;
    const previous = previousPages.find((entry) => entry.page === pageNumber);
    pages.push({
      page: pageNumber,
      rows: rows.slice(index, index + PHOTO_ROWS_PER_PAGE),
      height: previous?.height || 0,
      rendered: false
    });
  }
  return pages;
}

function estimatePhotoPageHeight(entry) {
  const grid = app.querySelector("[data-tab-grid]");
  const { gap } = photoLayoutConfig(grid);
  return entry.rows.reduce((height, row, index) => {
    const rowHeight = row[0]?.displayHeight || 0;
    return height + rowHeight + (index ? gap : 0);
  }, 0);
}

function renderPhotoPage(entry, options = {}) {
  const grid = app.querySelector("[data-tab-grid]");
  const page = grid?.querySelector(`[data-photo-page="${entry.page}"]`);
  if (!grid || !page) return;

  if (!options.force && entry.rendered) return;

  const items = entry.rows.flat();
  page.classList.remove("is-placeholder");
  page.style.minHeight = "";
  page.innerHTML = items.map((photo, index) => photoItem(photo, index, entry.page === 1 && index < 6)).join("");
  entry.rendered = true;
  bindAlbumCards(page);
  markLoadedImages(page, schedulePhotoRelayout);
  requestAnimationFrame(() => {
    entry.height = page.offsetHeight || entry.height;
    requestPhotoPageSync();
  });
}

function schedulePhotoRelayout() {
  if (appPathname() !== "/" || activeTab !== "photos" || searchQuery) return;
  clearTimeout(photoRelayoutTimer);
  photoRelayoutTimer = setTimeout(() => {
    photoRelayoutTimer = null;
    if (appPathname() !== "/" || activeTab !== "photos" || searchQuery) return;
    renderPhotoTabGrid({ force: true });
  }, 420);
}

function unrenderPhotoPage(entry) {
  const page = app.querySelector(`[data-photo-page="${entry.page}"]`);
  if (!page || !entry.rendered) return;

  entry.height = page.offsetHeight || entry.height || estimatePhotoPageHeight(entry);
  page.innerHTML = "";
  page.style.minHeight = `${Math.max(1, Math.round(entry.height))}px`;
  page.classList.add("is-placeholder");
  entry.rendered = false;
}

function syncVisiblePhotoPages(options = {}) {
  if (appPathname() !== "/" || activeTab !== "photos" || searchQuery) return;
  const state = tabs.photos;
  const grid = app.querySelector("[data-tab-grid]");
  if (!grid) return;

  const candidates = state.pages
    .map((entry) => {
      const page = grid.querySelector(`[data-photo-page="${entry.page}"]`);
      return page && photoPageNearViewport(page)
        ? { entry, distance: viewportDistance(page) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_RENDERED_PHOTO_PAGES);
  const allowed = new Set(candidates.map((candidate) => candidate.entry.page));

  state.pages.forEach((entry) => {
    const page = grid.querySelector(`[data-photo-page="${entry.page}"]`);
    if (!page) return;
    if (allowed.has(entry.page)) {
      renderPhotoPage(entry, options);
    } else {
      unrenderPhotoPage(entry);
    }
  });
}

function requestPhotoPageSync(options = {}) {
  if (photoSyncFrame) return;
  photoSyncFrame = requestAnimationFrame(() => {
    photoSyncFrame = null;
    syncVisiblePhotoPages(options);
  });
}

function appendPhotoPage(data) {
  const state = tabs.photos;
  const expectedStart = (data.page - 1) * data.limit;
  if (state.photos.length > expectedStart) return;

  state.photos.push(...data.photos);
  if (appPathname() !== "/" || activeTab !== "photos" || searchQuery) return;

  const grid = app.querySelector("[data-tab-grid]");
  if (!grid) return;

  renderPhotoTabGrid({ force: true });
}

function renderPhotoTabGrid(options = {}) {
  const state = tabs.photos;
  const grid = app.querySelector("[data-tab-grid]");
  if (!grid) return;
  if (appPathname() !== "/" || activeTab !== "photos" || searchQuery) return;

  const config = photoLayoutConfig(grid);
  if (config.width < 100) return;
  if (options.force || state.photoLayoutKey !== config.key || !state.pages.length) {
    state.pages = createPhotoPages(state.photos, config, state.pages, state.hasMore);
    state.photoLayoutKey = config.key;
  }

  grid.className = "photo-pages photos-waterfall";
  const wasPhotoGrid = grid.dataset.gridKind === "photos";
  grid.dataset.gridKind = "photos";
  delete grid.dataset.albumPages;
  const signature = `${state.mode}:${state.seed}:${state.photoLayoutKey}:${state.photos.length}:${state.pages.length}`;
  if (options.force || !wasPhotoGrid || grid.dataset.photoPages !== signature || grid.querySelector(".album-page")) {
    grid.dataset.photoPages = signature;
    state.pages.forEach((entry) => {
      entry.rendered = false;
    });
    grid.innerHTML = state.pages.map(photoPageShell).join("");
  }
  syncVisiblePhotoPages(options);
}

function renderInfiniteStatus() {
  const status = app.querySelector("[data-tab-status]");
  if (!status) return;

  const state = tabs[activeTab];
  if (state.loading) {
    status.innerHTML = `
      <span class="detail-loading-dot"></span>
      <span class="detail-loading-dot"></span>
      <span class="detail-loading-dot"></span>
    `;
    return;
  }

  if (!state.hasMore && tabLoadedCount(state)) {
    status.innerHTML = '<span class="end-label">已经到底</span>';
    return;
  }

  status.innerHTML = '<button type="button" class="more-btn" data-load-more>继续加载</button>';
  status.querySelector("[data-load-more]")?.addEventListener("click", () => loadMoreActiveTab());
}

function setupInfiniteScroll() {
  infiniteObserver?.disconnect();
  const sentinel = app.querySelector("[data-infinite-sentinel]");
  if (!sentinel || searchQuery || activeTab === "photos") return;

  infiniteObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMoreActiveTab();
    }
  }, {
    rootMargin: "900px 0px"
  });
  infiniteObserver.observe(sentinel);
}

async function loadMoreActiveTab() {
  const tab = activeTab;
  const state = tabs[tab];
  if (state.loading || !state.hasMore) {
    renderInfiniteStatus();
    return;
  }

  state.loading = true;
  renderInfiniteStatus();
  const nextPage = state.page + 1;
  const data = await loadTabPage(tab, nextPage);
  if (!data) {
    state.loading = false;
    renderInfiniteStatus();
    return;
  }

  if (tab === "photos") {
    state.page = data.page;
    state.total = data.total;
    state.mode = data.mode || state.mode;
    state.seed = data.seed || state.seed;
    state.hasMore = data.page * data.limit < data.total;
    state.loading = false;
    appendPhotoPage(data);
    updateTabCounts();
    updatePhotoOrderButtons();

    if (activeTab !== tab || searchQuery) return;
    renderInfiniteStatus();
    scheduleNextPagePrefetch(tab);
    return;
  }

  state.page = data.page;
  state.total = data.total;
  state.hasMore = data.page * data.limit < data.total;
  state.loading = false;

  appendAlbumPage(tab, data);
  updateTabCounts();

  if (activeTab !== tab || searchQuery) return;
  renderInfiniteStatus();
  scheduleNextPagePrefetch(tab);
}

function tabPageRequest(tab, page) {
  const state = tabs[tab];
  if (!state) return null;

  if (tab === "photos") {
    const params = new URLSearchParams({
      mode: state.mode,
      page: String(page),
      limit: String(PHOTO_PAGE_SIZE),
      seed: state.seed
    });
    return {
      key: `photos:${state.mode}:${state.seed}:${page}:${PHOTO_PAGE_SIZE}`,
      url: `/api/photos?${params.toString()}`
    };
  }

  const params = new URLSearchParams({
    mode: tab,
    page: String(page),
    limit: String(PAGE_SIZE),
    seed: state.seed
  });
  return {
    key: `${tab}:${state.seed}:${page}:${PAGE_SIZE}`,
    url: `/api/albums?${params.toString()}`
  };
}

async function loadTabPage(tab, page) {
  const state = tabs[tab];
  const request = tabPageRequest(tab, page);
  if (!state || !request) return null;

  if (state.prefetch?.key === request.key) {
    const data = state.prefetch.data;
    state.prefetch = null;
    state.prefetchKey = "";
    return data;
  }

  if (state.prefetching && state.prefetchKey === request.key && state.prefetchPromise) {
    const data = await state.prefetchPromise;
    if (state.prefetch?.key === request.key) {
      state.prefetch = null;
      state.prefetchKey = "";
    }
    if (data) return data;
  }

  return getJson(request.url);
}

function scheduleNextPagePrefetch(tab) {
  if (searchQuery || appPathname() !== "/") return;
  setTimeout(() => prefetchNextTabPage(tab), PREFETCH_DELAY);
}

function prefetchNextTabPage(tab) {
  const state = tabs[tab];
  if (!state || state.loading || !state.hasMore || searchQuery) return;

  const nextPage = state.page + 1;
  const request = tabPageRequest(tab, nextPage);
  if (!request) return;
  if (state.prefetch?.key === request.key) return;
  if (state.prefetching && state.prefetchKey === request.key) return;

  state.prefetching = true;
  state.prefetchKey = request.key;
  state.prefetchPromise = getJson(request.url)
    .then((data) => {
      if (state.prefetchKey === request.key) {
        state.prefetch = { key: request.key, data };
        warmPrefetchedMedia(tab, data);
      }
      return data;
    })
    .catch((error) => {
      console.warn("Prefetch failed", error);
      return null;
    })
    .finally(() => {
      if (state.prefetchKey === request.key) {
        state.prefetching = false;
        state.prefetchPromise = null;
      }
    });
}

function warmPrefetchedMedia(tab, data) {
  if (tab === "photos" && Array.isArray(data.photos)) {
    return;
  }

  if (Array.isArray(data.albums)) {
    data.albums.slice(0, 8).forEach((album) => {
      if (!album.cover) return;
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.src = album.cover;
    });
  }
}

function updateTabCounts() {
  app.querySelectorAll("[data-tab]").forEach((button) => {
    const tab = button.dataset.tab;
    const fallback = tab === "photos" ? homeManifest?.photoCount : homeManifest?.albumCount;
    const count = tabs[tab]?.total || fallback || 0;
    const node = button.querySelector(".home-tab-count");
    if (node) node.textContent = count ? formatCount(count) : "";
  });
}

function sentinelNearViewport() {
  const sentinel = app.querySelector("[data-infinite-sentinel]");
  if (!sentinel) return false;
  const rect = sentinel.getBoundingClientRect();
  return rect.top < window.innerHeight + 900;
}

function onHomeScroll() {
  if (appPathname().startsWith("/album/")) {
    requestDetailPageSync();
    return;
  }

  if (appPathname() !== "/" || searchQuery) return;
  if (activeTab === "photos") requestPhotoPageSync();
  else requestAlbumPageSync();
  if (sentinelNearViewport()) {
    const now = performance.now();
    if (now - lastAutoLoadAt > 350) {
      lastAutoLoadAt = now;
      loadMoreActiveTab();
    }
  }
}

function renderHomePhotoGridOnResize() {
  if (appPathname() !== "/" || searchQuery) return;
  clearTimeout(photoResizeTimer);
  photoResizeTimer = setTimeout(() => {
    if (activeTab === "photos") renderPhotoTabGrid({ force: true });
    else renderAlbumTabGrid(activeTab, { force: true });
  }, 120);
}

async function runSearch(page) {
  const results = app.querySelector("#search-results");
  const tabsContainer = app.querySelector("#home-tabs");
  if (!results || !tabsContainer) return;

  if (!searchQuery) {
    results.hidden = true;
    results.innerHTML = "";
    tabsContainer.hidden = false;
    await showActiveTab();
    return;
  }

  infiniteObserver?.disconnect();
  searchPage = page;
  tabsContainer.hidden = true;
  results.hidden = false;
  results.innerHTML = `
    <section class="home-section home-section-first">
      <div class="section-head">
        <div>
          <h2 class="section-title">搜索结果</h2>
          <p class="section-sub">Searching Archive</p>
        </div>
      </div>
      <div class="detail-loading">
        <span class="detail-loading-dot"></span>
        <span class="detail-loading-dot"></span>
        <span class="detail-loading-dot"></span>
      </div>
    </section>
  `;

  const data = await getJson(`/api/albums?q=${encodeURIComponent(searchQuery)}&page=${page}&limit=24`);
  const hasMore = data.page * data.limit < data.total;
  results.innerHTML = `
    <section class="home-section home-section-first">
      <div class="section-head">
        <div>
          <h2 class="section-title">搜索结果</h2>
          <p class="section-sub">${formatCount(data.total)} Matches</p>
        </div>
      </div>
      ${data.albums.length ? `<div class="albums-grid">${data.albums.map(albumCard).join("")}</div>` : '<div class="empty-state">No Matches</div>'}
      ${hasMore ? '<div class="home-footer"><button type="button" class="more-btn" data-more>更多</button></div>' : ""}
    </section>
  `;
  bindAlbumCards(results);
  markLoadedImages(results);
  results.querySelector("[data-more]")?.addEventListener("click", () => appendSearch());
}

async function appendSearch() {
  const results = app.querySelector("#search-results");
  const grid = results?.querySelector(".albums-grid");
  const more = results?.querySelector("[data-more]");
  if (!grid || !more) return;

  more.textContent = "加载中";
  const nextPage = searchPage + 1;
  const data = await getJson(`/api/albums?q=${encodeURIComponent(searchQuery)}&page=${nextPage}&limit=24`);
  searchPage = nextPage;
  grid.insertAdjacentHTML("beforeend", data.albums.map((album, index) => albumCard(album, grid.children.length + index)).join(""));
  bindAlbumCards(grid);
  markLoadedImages(grid);
  if (data.page * data.limit >= data.total) more.remove();
  else more.textContent = "更多";
}

function detailTemplate(data) {
  const album = data.album;
  return `
    <main class="detail page-enter">
      <div class="detail-top">
        <button class="back-link" type="button" data-back>
          <span class="arrow">${icons.back}</span>
          返回
        </button>
        <div class="detail-top-right">
          <span class="detail-counter">${String(data.photos.length).padStart(2, "0")} 张</span>
          ${themeButton()}
        </div>
      </div>
      <h1 class="detail-title">${escapeHtml(album.title)}</h1>
      <div class="detail-like-row">
        <div class="detail-like-group">
          <button type="button" class="album-like" data-like-album>
            <span class="like-icon">${icons.heart}</span>
            <span class="album-like-count">${formatCount(data.likeCount || 0)}</span>
          </button>
          <span class="detail-like-hint">双击大图也能点赞</span>
        </div>
        <label class="detail-size-control">
          <span class="detail-size-label">显示大小</span>
          <input type="range" min="100" max="300" step="10" value="${detailImageScale}" data-size-slider aria-label="调整图片显示大小">
          <span class="detail-size-value" data-size-value>${detailImageScale}%</span>
        </label>
      </div>
      <div class="justified-rows" data-rows></div>
    </main>
  `;
}

async function renderAlbum(id) {
  loading();
  const data = await getJson(`/api/album/${encodeURIComponent(id)}`);
  currentAlbum = {
    ...data,
    detailPages: [],
    detailLayoutKey: ""
  };
  app.innerHTML = detailTemplate(data);
  bindThemeButtons(app);
  app.querySelector("[data-back]").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else navigate("/");
  });
  app.querySelector("[data-like-album]").addEventListener("click", () => likeAlbum());
  bindDetailControls();
  renderDetailRows();
  window.addEventListener("resize", renderDetailRowsOnResize, { passive: true });
}

function bindDetailControls() {
  const slider = app.querySelector("[data-size-slider]");
  const value = app.querySelector("[data-size-value]");
  if (!slider || !value) return;

  slider.addEventListener("input", () => {
    setDetailImageScale(slider.value);
    value.textContent = `${detailImageScale}%`;
    renderDetailRows({ force: true });
  });
}

function detailLayoutConfig(container) {
  const width = container?.clientWidth || Math.max(320, window.innerWidth - 32);
  const baseHeight = width < 600 ? 160 : width < 1000 ? 220 : 280;
  const targetHeight = Math.round(baseHeight * detailImageScale / 100);
  const gap = width < 600 ? 5 : 8;
  return {
    width,
    targetHeight,
    gap,
    key: `${Math.round(width)}:${targetHeight}:${gap}`
  };
}

function createDetailPages(photos, config, previousPages = []) {
  const indexedPhotos = photos.map((photo, index) => ({
    ...photo,
    sourceIndex: index
  }));
  const rows = rowLayoutRows(indexedPhotos, config.width, config.targetHeight, config.gap);
  const pages = [];
  for (let index = 0; index < rows.length; index += DETAIL_ROWS_PER_PAGE) {
    const pageNumber = pages.length + 1;
    const previous = previousPages.find((entry) => entry.page === pageNumber);
    pages.push({
      page: pageNumber,
      rows: rows.slice(index, index + DETAIL_ROWS_PER_PAGE),
      height: previous?.height || 0,
      rendered: false,
      layoutTimer: null
    });
  }
  return pages;
}

function detailPageShell(entry) {
  const height = entry.height || (!entry.rendered ? estimateDetailPageHeight(entry) : 0);
  const minHeight = height ? ` style="min-height:${Math.round(height)}px"` : "";
  return `<section class="detail-photo-page ${entry.rendered ? "" : "is-placeholder"}" data-detail-page="${entry.page}"${minHeight}></section>`;
}

function detailPageNearViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > -DETAIL_PAGE_RENDER_MARGIN && rect.top < window.innerHeight + DETAIL_PAGE_RENDER_MARGIN;
}

function estimateDetailPageHeight(entry) {
  const container = app.querySelector("[data-rows]");
  const { gap } = detailLayoutConfig(container);
  return entry.rows.reduce((height, row, index) => {
    const rowHeight = row[0]?.displayHeight || 0;
    return height + rowHeight + (index ? gap : 0);
  }, 0);
}

function renderDetailPage(entry, options = {}) {
  const container = app.querySelector("[data-rows]");
  const page = container?.querySelector(`[data-detail-page="${entry.page}"]`);
  if (!container || !page || !currentAlbum) return;

  if (!options.force && entry.rendered) return;

  const items = entry.rows.flat();
  page.classList.remove("is-placeholder");
  page.style.minHeight = "";
  page.innerHTML = items.map((photo, index) => {
    const photoIndex = photo.sourceIndex;
    return `
      <button type="button" class="jr-item" data-photo-index="${photoIndex}" style="width:${photo.displayWidth}px;height:${photo.displayHeight}px">
        ${lazyImage(photo.url, currentAlbum.album.title, entry.page === 1 && index < 6)}
      </button>
    `;
  }).join("");
  entry.rendered = true;
  page.querySelectorAll("[data-photo-index]").forEach((button) => {
    button.addEventListener("click", () => openLightbox(Number(button.dataset.photoIndex)));
  });
  markLoadedImages(page, scheduleDetailRelayout);
  requestAnimationFrame(() => {
    entry.height = page.offsetHeight || entry.height;
    requestDetailPageSync();
  });
}

function scheduleDetailRelayout() {
  if (!currentAlbum || !appPathname().startsWith("/album/")) return;
  clearTimeout(detailRelayoutTimer);
  detailRelayoutTimer = setTimeout(() => {
    detailRelayoutTimer = null;
    renderDetailRows({ force: true });
  }, 420);
}

function unrenderDetailPage(entry) {
  const page = app.querySelector(`[data-detail-page="${entry.page}"]`);
  if (!page || !entry.rendered) return;

  clearTimeout(entry.layoutTimer);
  entry.layoutTimer = null;
  entry.height = page.offsetHeight || entry.height || estimateDetailPageHeight(entry);
  page.innerHTML = "";
  page.style.minHeight = `${Math.max(1, Math.round(entry.height))}px`;
  page.classList.add("is-placeholder");
  entry.rendered = false;
}

function syncVisibleDetailPages(options = {}) {
  if (!appPathname().startsWith("/album/") || !currentAlbum?.detailPages) return;
  const container = app.querySelector("[data-rows]");
  if (!container) return;

  const candidates = currentAlbum.detailPages
    .map((entry) => {
      const page = container.querySelector(`[data-detail-page="${entry.page}"]`);
      return page && detailPageNearViewport(page)
        ? { entry, distance: viewportDistance(page) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_RENDERED_DETAIL_PAGES);
  const allowed = new Set(candidates.map((candidate) => candidate.entry.page));

  currentAlbum.detailPages.forEach((entry) => {
    const page = container.querySelector(`[data-detail-page="${entry.page}"]`);
    if (!page) return;
    if (allowed.has(entry.page)) {
      renderDetailPage(entry, options);
    } else {
      unrenderDetailPage(entry);
    }
  });
}

function requestDetailPageSync(options = {}) {
  if (detailSyncFrame) return;
  detailSyncFrame = requestAnimationFrame(() => {
    detailSyncFrame = null;
    syncVisibleDetailPages(options);
  });
}

function renderDetailRows(options = {}) {
  const container = app.querySelector("[data-rows]");
  if (!container || !currentAlbum) return;

  const config = detailLayoutConfig(container);
  if (config.width < 100) return;

  if (options.force || currentAlbum.detailLayoutKey !== config.key || !currentAlbum.detailPages?.length) {
    currentAlbum.detailPages = createDetailPages(currentAlbum.photos, config, currentAlbum.detailPages || []);
    currentAlbum.detailLayoutKey = config.key;
  }

  const pages = currentAlbum.detailPages;
  container.className = "justified-rows detail-photo-pages";
  const signature = `${currentAlbum.album.id}:${currentAlbum.detailLayoutKey}:${pages.length}`;
  if (options.force || container.dataset.detailPages !== signature) {
    container.dataset.detailPages = signature;
    container.innerHTML = pages.map(detailPageShell).join("");
  }
  syncVisibleDetailPages(options);
}

function renderDetailRowsOnResize() {
  if (!currentAlbum || !appPathname().startsWith("/album/")) return;
  clearTimeout(detailResizeTimer);
  detailResizeTimer = setTimeout(() => renderDetailRows({ force: true }), 120);
}

function rowLayoutRows(photos, width, targetHeight, gap) {
  if (width < 100) return [];
  const rows = [];
  let row = [];
  let ratioSum = 0;

  photos.forEach((photo, index) => {
    const size = imageSizeCache.get(photo.url) || { width: 3, height: 4 };
    const rawRatio = size.width / size.height;
    const ratio = Math.min(2.8, Math.max(0.45, Number.isFinite(rawRatio) ? rawRatio : 0.75));
    row.push({ ...photo, sourceIndex: photo.sourceIndex ?? index, ratio });
    ratioSum += ratio;
    const gaps = (row.length - 1) * gap;

    if (ratioSum * targetHeight + gaps >= width) {
      const height = (width - gaps) / ratioSum;
      rows.push(row.map((item) => ({
        ...item,
        displayWidth: item.ratio * height,
        displayHeight: height
      })));
      row = [];
      ratioSum = 0;
    }
  });

  if (row.length) {
    rows.push(row.map((item) => ({
      ...item,
      displayWidth: Math.min(width, item.ratio * targetHeight),
      displayHeight: targetHeight
    })));
  }

  return rows;
}

function rowLayout(photos, width, targetHeight, gap) {
  return rowLayoutRows(photos, width, targetHeight, gap).flat();
}

function likeAlbum() {
  if (!currentAlbum) return;
  const button = app.querySelector("[data-like-album]");
  const count = button.querySelector(".album-like-count");
  const icon = button.querySelector("svg");
  count.textContent = formatCount(Number(count.textContent.replace(/\D/g, "") || 0) + 1);
  icon.classList.remove("popping");
  requestAnimationFrame(() => icon.classList.add("popping"));
  queueLike({ albumDelta: 1 });
}

function queueLike(delta) {
  if (!currentAlbum) return;
  const id = currentAlbum.album.id;
  const existing = pendingLikes.get(id) || { albumDelta: 0, likes: [] };
  existing.albumDelta += delta.albumDelta || 0;
  if (delta.photoId) {
    const found = existing.likes.find((item) => item.photoId === delta.photoId);
    if (found) found.delta += 1;
    else existing.likes.push({ photoId: delta.photoId, delta: 1 });
  }
  pendingLikes.set(id, existing);
  clearTimeout(existing.timer);
  existing.timer = setTimeout(() => flushLikes(id), 800);
}

async function flushLikes(id) {
  const pending = pendingLikes.get(id);
  if (!pending) return;
  pendingLikes.delete(id);
  const payload = {
    albumId: id,
    albumDelta: pending.albumDelta,
    likes: pending.likes
  };
  try {
    const result = await getJson("/api/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const count = app.querySelector(".album-like-count");
    if (count && result.count != null) count.textContent = formatCount(result.count);
  } catch (error) {
    console.warn(error);
  }
}

function openLightbox(index) {
  lightboxIndex = index;
  document.body.style.overflow = "hidden";
  renderLightbox();
}

function closeLightbox() {
  lightboxIndex = null;
  document.body.style.overflow = "";
  document.querySelector(".lightbox")?.remove();
}

function moveLightbox(delta) {
  if (!currentAlbum || lightboxIndex === null) return;
  lightboxIndex = Math.min(currentAlbum.photos.length - 1, Math.max(0, lightboxIndex + delta));
  renderLightbox();
}

function lightboxTemplate() {
  const photos = currentAlbum.photos;
  const photo = photos[lightboxIndex];
  return `
    <div class="lightbox" data-lightbox>
      <div class="lb-header">
        <span>${String(lightboxIndex + 1).padStart(2, "0")} / ${String(photos.length).padStart(2, "0")}</span>
        <button type="button" class="lb-close" data-close aria-label="关闭">${icons.close}</button>
      </div>
      <div class="lb-stage" data-stage>
        ${lazyImage(photo.url, currentAlbum.album.title, true).replace("<img", '<img class="lb-img"')}
        <button type="button" class="lb-nav prev" data-prev aria-label="上一张" ${lightboxIndex === 0 ? "disabled" : ""}>${icons.prev}</button>
        <button type="button" class="lb-nav next" data-next aria-label="下一张" ${lightboxIndex === photos.length - 1 ? "disabled" : ""}>${icons.next}</button>
      </div>
      <div class="lb-footer">
        <div class="lb-thumbs">
          ${photos.map((item, index) => `
            <button type="button" class="lb-thumb ${index === lightboxIndex ? "active" : ""}" data-thumb="${index}" aria-label="第 ${index + 1} 张">
              <img src="${escapeHtml(item.url)}" alt="" referrerpolicy="no-referrer" loading="lazy">
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderLightbox() {
  document.querySelector(".lightbox")?.remove();
  document.body.insertAdjacentHTML("beforeend", lightboxTemplate());
  const box = document.querySelector(".lightbox");
  const stage = box.querySelector("[data-stage]");
  box.addEventListener("click", closeLightbox);
  box.querySelector("[data-close]").addEventListener("click", (event) => {
    event.stopPropagation();
    closeLightbox();
  });
  box.querySelector("[data-prev]").addEventListener("click", (event) => {
    event.stopPropagation();
    moveLightbox(-1);
  });
  box.querySelector("[data-next]").addEventListener("click", (event) => {
    event.stopPropagation();
    moveLightbox(1);
  });
  box.querySelectorAll("[data-thumb]").forEach((thumb) => {
    thumb.addEventListener("click", (event) => {
      event.stopPropagation();
      lightboxIndex = Number(thumb.dataset.thumb);
      renderLightbox();
    });
  });
  stage.addEventListener("click", (event) => event.stopPropagation());
  stage.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    likePhoto(event);
  });
  stage.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  stage.addEventListener("touchend", (event) => handleTouch(event), { passive: true });
  markLoadedImages(box);
  box.querySelector(".lb-thumb.active")?.scrollIntoView({ inline: "center", block: "nearest" });
}

function likePhoto(event) {
  if (!currentAlbum || lightboxIndex === null) return;
  const photo = currentAlbum.photos[lightboxIndex];
  const stage = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - stage.left;
  const y = event.clientY - stage.top;
  event.currentTarget.insertAdjacentHTML("beforeend", `
    <span class="lb-heart" style="left:${x}px;top:${y}px" aria-hidden="true">
      <svg width="64" height="64" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.2C.7 9.1 1.6 5.6 4.7 4.5c2-.7 4 .1 5.1 1.8l.2.3.2-.3c1.1-1.7 3.1-2.5 5.1-1.8 3.1 1.1 4 4.6 2.7 7.3C19.5 16.4 12 21 12 21z" fill="currentColor"></path></svg>
    </span>
  `);
  const heart = event.currentTarget.querySelector(".lb-heart:last-child");
  heart.addEventListener("animationend", () => heart.remove(), { once: true });
  queueLike({ photoId: photo.id });
}

function handleTouch(event) {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;

  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    moveLightbox(dx < 0 ? 1 : -1);
    lastTap = 0;
    return;
  }

  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const now = performance.now();
    if (now - lastTap < 300) {
      likePhoto({
        currentTarget: event.currentTarget,
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }
}

function navigate(path) {
  history.pushState({}, "", appUrl(path));
  route().catch(errorPanel);
}

async function route() {
  window.removeEventListener("resize", renderDetailRowsOnResize);
  infiniteObserver?.disconnect();
  closeLightbox();
  const match = appPathname().match(/^\/album\/([^/]+)$/);
  try {
    if (match) {
      await renderAlbum(decodeURIComponent(match[1]));
    } else {
      await renderHome();
    }
  } catch (error) {
    errorPanel(error);
  }
}

window.addEventListener("popstate", () => route().catch(errorPanel));
window.addEventListener("scroll", onHomeScroll, { passive: true });
window.addEventListener("resize", renderHomePhotoGridOnResize, { passive: true });
window.addEventListener("keydown", (event) => {
  if (lightboxIndex === null) return;
  if (event.key === "Escape") closeLightbox();
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});
window.addEventListener("pagehide", () => {
  for (const id of pendingLikes.keys()) flushLikes(id);
});

route().catch(errorPanel);
