import {
  albumPayload,
  albumsPayload,
  healthPayload,
  homePayload,
  json,
  likePayload,
  notFound,
  photosPayload,
  seedFrom
} from "./shared.js";

const detailCache = new Map();

class D1Store {
  constructor(db) {
    this.db = db;
    this.manifestCache = null;
  }

  async manifest() {
    if (this.manifestCache) return this.manifestCache;
    const row = await this.db
      .prepare("SELECT value FROM meta WHERE key = 'manifest'")
      .first();
    this.manifestCache = JSON.parse(row?.value || "{}");
    return this.manifestCache;
  }

  async albums({ query = "", mode = "all", seed = "default", page = 1, limit = 24 }) {
    const offset = (page - 1) * limit;
    const where = query ? "WHERE title_lc LIKE ?" : "";
    const params = query ? [`%${query}%`] : [];
    const totalRow = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM albums ${where}`)
      .bind(...params)
      .first();
    const total = Number(totalRow?.total || 0);

    const order = mode === "recent"
      ? "ORDER BY album_order DESC"
      : mode === "random"
        ? "ORDER BY ((album_order * ? + ?) % 2147483647), album_order"
        : "ORDER BY album_order ASC";
    const orderParams = mode === "random"
      ? [1103515245, seedFrom(seed)]
      : [];
    const rows = await this.db
      .prepare(`
        SELECT a.id, a.title, a.count, a.cover, a.href, a.album_order, COALESCE(l.count, 0) AS likes
        FROM albums a
        LEFT JOIN likes_albums l ON l.album_id = a.id
        ${where}
        ${order}
        LIMIT ? OFFSET ?
      `)
      .bind(...params, ...orderParams, limit, offset)
      .all();

    return {
      total,
      albums: rows.results || []
    };
  }

  async album(albumId) {
    return this.db
      .prepare(`
        SELECT a.id, a.title, a.count, a.cover, a.href, a.album_order, COALESCE(l.count, 0) AS likes
        FROM albums a
        LEFT JOIN likes_albums l ON l.album_id = a.id
        WHERE a.id = ?
      `)
      .bind(albumId)
      .first();
  }

  async albumDetail(albumId) {
    const cached = detailCache.get(albumId);
    if (cached) return cached;

    const row = await this.db
      .prepare("SELECT detail_json FROM album_details WHERE album_id = ?")
      .bind(albumId)
      .first();
    if (!row) return null;

    const detail = JSON.parse(row.detail_json);
    detailCache.set(albumId, detail);
    if (detailCache.size > 80) {
      detailCache.delete(detailCache.keys().next().value);
    }
    return detail;
  }

  async albumByPhotoOffset(offset) {
    return this.db
      .prepare(`
        SELECT id, title, count, cover, href, album_order, start_offset, end_offset
        FROM albums
        WHERE start_offset <= ? AND end_offset > ?
        LIMIT 1
      `)
      .bind(offset, offset)
      .first();
  }

  async addLikes(albumId, albumDelta, photoLikes) {
    await this.db
      .prepare("INSERT OR IGNORE INTO likes_albums (album_id, count) VALUES (?, 0)")
      .bind(albumId)
      .run();
    if (albumDelta > 0) {
      await this.db
        .prepare("UPDATE likes_albums SET count = count + ? WHERE album_id = ?")
        .bind(albumDelta, albumId)
        .run();
    }

    for (const like of photoLikes) {
      await this.db
        .prepare("INSERT OR IGNORE INTO likes_photos (album_id, photo_id, count) VALUES (?, ?, 0)")
        .bind(albumId, like.photoId)
        .run();
      await this.db
        .prepare("UPDATE likes_photos SET count = count + ? WHERE album_id = ? AND photo_id = ?")
        .bind(like.delta, albumId, like.photoId)
        .run();
    }

    const row = await this.db
      .prepare("SELECT count FROM likes_albums WHERE album_id = ?")
      .bind(albumId)
      .first();
    return Number(row?.count || 0);
  }
}

async function handleApi(request, env, url) {
  const store = new D1Store(env.DB);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json(await healthPayload(store));
  }

  if (request.method === "GET" && url.pathname === "/api/home") {
    return json(await homePayload(store, url));
  }

  if (request.method === "GET" && url.pathname === "/api/albums") {
    return json(await albumsPayload(store, url));
  }

  if (request.method === "GET" && url.pathname === "/api/photos") {
    return json(await photosPayload(store, url));
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/album/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/album/".length));
    const payload = await albumPayload(store, id);
    return payload ? json(payload) : notFound();
  }

  if (request.method === "POST" && url.pathname === "/api/like") {
    return likePayload(store, request);
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      if (!["GET", "HEAD"].includes(request.method)) {
        return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, HEAD" });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: "Internal server error" }, 500);
    }
  }
};
