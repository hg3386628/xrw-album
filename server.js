import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const photosDir = path.join(dataDir, "photos");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 26785);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"]
]);

const albums = JSON.parse(await fs.readFile(path.join(dataDir, "albums.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "manifest.json"), "utf8"));
const albumMap = new Map(albums.map((album) => [album.id, album]));
const recentAlbums = [...albums].reverse();
const randomAlbumCache = new Map();
const albumDetailCache = new Map();
const photoAlbumOffsets = [];
let runningPhotoTotal = 0;
for (const album of recentAlbums) {
  photoAlbumOffsets.push({
    album,
    start: runningPhotoTotal,
    end: runningPhotoTotal + album.count
  });
  runningPhotoTotal += album.count;
}
const searchIndex = albums.map((album) => ({
  album,
  text: album.title.toLocaleLowerCase()
}));

let likes = { albums: {}, photos: {} };
const likesFile = path.join(dataDir, "likes.json");
try {
  likes = JSON.parse(await fs.readFile(likesFile, "utf8"));
} catch {
  likes = { albums: {}, photos: {} };
}

let saveLikesTimer = null;
function scheduleLikesSave() {
  if (saveLikesTimer) clearTimeout(saveLikesTimer);
  saveLikesTimer = setTimeout(() => {
    fs.writeFile(likesFile, `${JSON.stringify(likes)}\n`).catch((error) => {
      console.error("Failed to save likes", error);
    });
  }, 500);
}

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { ok: false, error: "Not found" });
}

function badRequest(res, error) {
  json(res, 400, { ok: false, error });
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
    return ((state >>> 0) / 4294967296);
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

function shuffledAlbums(seedValue) {
  const key = String(seedValue || "default");
  const cached = randomAlbumCache.get(key);
  if (cached) return cached;

  const result = [...albums];
  const rand = random(seedFrom(key));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  randomAlbumCache.set(key, result);
  if (randomAlbumCache.size > 8) {
    randomAlbumCache.delete(randomAlbumCache.keys().next().value);
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

function coprimePhotoStep(seedValue) {
  if (runningPhotoTotal <= 1) return 0;
  let step = seedFrom(`step:${seedValue}`) % runningPhotoTotal;
  if (!step) step = 1;

  while (greatestCommonDivisor(step, runningPhotoTotal) !== 1) {
    step += 1;
    if (step >= runningPhotoTotal) step = 1;
  }

  return step;
}

function randomPhotoOffset(position, seedValue) {
  if (runningPhotoTotal <= 1) return 0;
  const step = coprimePhotoStep(seedValue);
  const shift = seedFrom(`shift:${seedValue}`) % runningPhotoTotal;
  return (position * step + shift) % runningPhotoTotal;
}

function withLike(album) {
  return {
    ...album,
    cover: normalizeImageUrl(album.cover),
    likes: likes.albums[album.id] || 0
  };
}

function homePayload(url) {
  const seed = url.searchParams.get("seed") || Date.now();
  const recentSeed = url.searchParams.get("recentSeed");
  const recent = recentSeed
    ? sample(recentAlbums, 16, recentSeed)
    : recentAlbums.slice(0, 16);

  return {
    ok: true,
    manifest,
    recentAlbums: recent.map(withLike),
    albums: sample(albums, 16, seed).map(withLike)
  };
}

function albumsPayload(url) {
  const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
  const mode = url.searchParams.get("mode") || "all";
  const seed = url.searchParams.get("seed") || "default";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(48, Math.max(8, Number(url.searchParams.get("limit") || 24)));
  const matched = query
    ? searchIndex.filter((entry) => entry.text.includes(query)).map((entry) => entry.album)
    : mode === "recent"
      ? recentAlbums
      : mode === "random"
        ? shuffledAlbums(seed)
    : albums;
  const start = (page - 1) * limit;

  return {
    ok: true,
    mode,
    seed,
    page,
    limit,
    total: matched.length,
    albums: matched.slice(start, start + limit).map(withLike)
  };
}

function findPhotoAlbumIndex(offset) {
  let low = 0;
  let high = photoAlbumOffsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entry = photoAlbumOffsets[mid];
    if (offset < entry.start) high = mid - 1;
    else if (offset >= entry.end) low = mid + 1;
    else return mid;
  }

  return Math.min(photoAlbumOffsets.length - 1, Math.max(0, low));
}

async function readAlbumDetail(albumId) {
  const cached = albumDetailCache.get(albumId);
  if (cached) return cached;

  const rawDetail = JSON.parse(await fs.readFile(path.join(photosDir, `${albumId}.json`), "utf8"));
  const detail = {
    ...rawDetail,
    cover: normalizeImageUrl(rawDetail.cover),
    photos: rawDetail.photos.map((photo) => ({
      ...photo,
      url: normalizeImageUrl(photo.url)
    }))
  };
  albumDetailCache.set(albumId, detail);
  if (albumDetailCache.size > 80) {
    albumDetailCache.delete(albumDetailCache.keys().next().value);
  }
  return detail;
}

async function photoPayloadFromOffset(offset) {
  const entry = photoAlbumOffsets[findPhotoAlbumIndex(offset)];
  if (!entry) return null;

  const detail = await readAlbumDetail(entry.album.id);
  const photoIndex = offset - entry.start;
  const photo = detail.photos[photoIndex];
  if (!photo) return null;

  return {
    id: `${entry.album.id}-${photo.id}`,
    albumId: entry.album.id,
    albumTitle: entry.album.title,
    albumHref: entry.album.href,
    photoId: photo.id,
    url: photo.url
  };
}

async function photosPayload(url) {
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode === "random" ? "random" : "sequence";
  const seed = url.searchParams.get("seed") || "photos";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(120, Math.max(24, Number(url.searchParams.get("limit") || 72)));
  const startOffset = (page - 1) * limit;
  const photos = [];

  if (mode === "random") {
    const endOffset = Math.min(startOffset + limit, runningPhotoTotal);
    for (let position = startOffset; position < endOffset; position += 1) {
      const photo = await photoPayloadFromOffset(randomPhotoOffset(position, seed));
      if (photo) photos.push(photo);
    }

    return {
      ok: true,
      mode,
      seed,
      page,
      limit,
      total: runningPhotoTotal,
      photos
    };
  }

  if (startOffset < runningPhotoTotal) {
    let albumIndex = findPhotoAlbumIndex(startOffset);
    let offset = startOffset;

    while (photos.length < limit && albumIndex < photoAlbumOffsets.length) {
      const entry = photoAlbumOffsets[albumIndex];
      const detail = await readAlbumDetail(entry.album.id);
      const startInAlbum = Math.max(0, offset - entry.start);
      const take = Math.min(limit - photos.length, detail.photos.length - startInAlbum);

      for (let index = 0; index < take; index += 1) {
        const photo = detail.photos[startInAlbum + index];
        photos.push({
          id: `${entry.album.id}-${photo.id}`,
          albumId: entry.album.id,
          albumTitle: entry.album.title,
          albumHref: entry.album.href,
          photoId: photo.id,
          url: photo.url
        });
      }

      offset = entry.end;
      albumIndex += 1;
    }
  }

  return {
    ok: true,
    mode,
    seed,
    page,
    limit,
    total: runningPhotoTotal,
    photos
  };
}

async function readBody(req, limit = 128 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      albumCount: manifest.albumCount,
      photoCount: manifest.photoCount,
      builtAt: manifest.builtAt
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/home") {
    json(res, 200, homePayload(url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/albums") {
    json(res, 200, albumsPayload(url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/photos") {
    json(res, 200, await photosPayload(url));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/album/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/album/".length));
    const album = albumMap.get(id);
    if (!album) {
      notFound(res);
      return;
    }

    try {
      const detail = await readAlbumDetail(id);
      json(res, 200, {
        ok: true,
        album: withLike(album),
        photos: detail.photos,
        likeCount: likes.albums[id] || 0
      });
    } catch {
      notFound(res);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/like") {
    try {
      const body = JSON.parse(await readBody(req));
      const albumId = String(body.albumId || "");
      if (!albumMap.has(albumId)) {
        badRequest(res, "Invalid album id");
        return;
      }

      const albumDelta = Math.min(25, Math.max(0, Number(body.albumDelta || 0)));
      likes.albums[albumId] = (likes.albums[albumId] || 0) + albumDelta;

      if (Array.isArray(body.likes)) {
        for (const like of body.likes.slice(0, 100)) {
          const photoId = Number(like.photoId);
          const delta = Math.min(25, Math.max(0, Number(like.delta || 0)));
          if (!Number.isFinite(photoId) || delta <= 0) continue;
          const key = `${albumId}:${photoId}`;
          likes.photos[key] = (likes.photos[key] || 0) + delta;
        }
      }

      scheduleLikesSave();
      json(res, 200, { ok: true, count: likes.albums[albumId] || 0 });
    } catch {
      badRequest(res, "Invalid request body");
    }
    return;
  }

  notFound(res);
}

async function serveFile(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  let filePath = pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, pathname);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(publicDir)) {
    notFound(res);
    return;
  }

  try {
    const stat = await fs.stat(normalized);
    if (!stat.isFile()) throw new Error("Not a file");
    const ext = path.extname(normalized).toLowerCase();
    const immutable = pathname.startsWith("/assets/");
    res.writeHead(200, {
      "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300"
    });
    createReadStream(normalized).pipe(res);
  } catch {
    if (req.method === "GET" && !pathname.startsWith("/api/")) {
      const indexPath = path.join(publicDir, "index.html");
      const stat = await fs.stat(indexPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": stat.size,
        "Cache-Control": "no-cache"
      });
      createReadStream(indexPath).pipe(res);
      return;
    }
    notFound(res);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      console.error(error);
      json(res, 500, { ok: false, error: "Internal server error" });
    });
    return;
  }

  if (!["GET", "HEAD"].includes(req.method || "")) {
    json(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "GET, HEAD" });
    return;
  }

  serveFile(req, res, url).catch((error) => {
    console.error(error);
    json(res, 500, { ok: false, error: "Internal server error" });
  });
});

server.listen(port, host, () => {
  console.log(`xrw-album listening on http://${host}:${port}`);
});
