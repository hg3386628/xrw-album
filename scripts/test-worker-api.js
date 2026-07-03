import assert from "node:assert/strict";

import worker from "../src/worker.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const albums = [
  {
    id: "album-a",
    title: "Alpha Album",
    count: 2,
    cover: "https://telegra.phhttps://legra.ph/file/a.jpg",
    href: "/album/album-a",
    order: 0
  },
  {
    id: "album-b",
    title: "Beta Album",
    count: 1,
    cover: "https://telegra.ph/file/b.jpg",
    href: "/album/album-b",
    order: 1
  }
];

const details = new Map([
  ["album-a", {
    id: "album-a",
    title: "Alpha Album",
    count: 2,
    cover: "https://telegra.phhttps://legra.ph/file/a.jpg",
    photos: [
      { id: 1, url: "https://telegra.phhttps://legra.ph/file/a.jpg" },
      { id: 2, url: "https://telegra.ph/file/a2.jpg" }
    ]
  }],
  ["album-b", {
    id: "album-b",
    title: "Beta Album",
    count: 1,
    cover: "https://telegra.ph/file/b.jpg",
    photos: [
      { id: 1, url: "https://telegra.ph/file/b.jpg" }
    ]
  }]
]);

class FakeD1Result {
  constructor(rows) {
    this.rows = rows;
  }

  async first() {
    return this.rows[0] || null;
  }

  async all() {
    return {
      results: this.rows,
      success: true
    };
  }

  async run() {
    return {
      success: true
    };
  }
}

class FakeD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  first() {
    return this.db.query(this.sql, this.params).first();
  }

  all() {
    return this.db.query(this.sql, this.params).all();
  }

  run() {
    return this.db.query(this.sql, this.params).run();
  }
}

class FakeD1 {
  constructor() {
    this.albumLikes = new Map();
    this.photoLikes = new Map();
    this.rows = albums.map((album) => ({
      ...album,
      start_offset: album.order === 0 ? 0 : 2,
      end_offset: album.order === 0 ? 2 : 3
    }));
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql.replace(/\s+/g, " ").trim());
  }

  query(sql, params) {
    if (sql.includes("FROM meta WHERE key = 'manifest'")) {
      return new FakeD1Result([{ value: JSON.stringify({
        builtAt: "2026-07-03T00:00:00.000Z",
        albumCount: 2,
        photoCount: 3,
        maxPhotosPerAlbum: 2,
        source: "test"
      }) }]);
    }

    if (sql.includes("WHERE start_offset <= ? AND end_offset > ?")) {
      const offset = params[0];
      const row = this.rows.find((album) => album.start_offset <= offset && album.end_offset > offset);
      return new FakeD1Result(row ? [{
        id: row.id,
        title: row.title,
        count: row.count,
        cover: row.cover,
        href: row.href,
        album_order: row.order,
        start_offset: row.start_offset,
        end_offset: row.end_offset
      }] : []);
    }

    if (sql.includes("FROM albums a LEFT JOIN likes_albums") && sql.includes("a.id = ?")) {
      const id = params[0];
      const row = this.rows.find((album) => album.id === id);
      return new FakeD1Result(row ? [{
        id: row.id,
        title: row.title,
        count: row.count,
        cover: row.cover,
        href: row.href,
        album_order: row.order,
        likes: this.albumLikes.get(row.id) || 0
      }] : []);
    }

    if (
      sql.includes("SELECT id, title, count, cover, href, album_order") ||
      sql.includes("SELECT a.id, a.title, a.count, a.cover, a.href, a.album_order")
    ) {
      let rows = [...this.rows];
      if (sql.includes("title_lc LIKE")) {
        const term = String(params[0]).replaceAll("%", "");
        rows = rows.filter((row) => row.title.toLowerCase().includes(term));
      }
      if (sql.includes("ORDER BY album_order DESC")) rows.reverse();
      const limit = params.at(-2);
      const offset = params.at(-1);
      return new FakeD1Result(rows.slice(offset, offset + limit).map((row) => ({
        id: row.id,
        title: row.title,
        count: row.count,
        cover: row.cover,
        href: row.href,
        album_order: row.order,
        likes: this.albumLikes.get(row.id) || 0
      })));
    }

    if (sql.includes("COUNT(*) AS total FROM albums")) {
      let rows = [...this.rows];
      if (sql.includes("title_lc LIKE")) {
        const term = String(params[0]).replaceAll("%", "");
        rows = rows.filter((row) => row.title.toLowerCase().includes(term));
      }
      return new FakeD1Result([{ total: rows.length }]);
    }

    if (sql.includes("FROM album_details WHERE album_id = ?")) {
      const detail = details.get(params[0]);
      return new FakeD1Result(detail ? [{ detail_json: JSON.stringify(detail) }] : []);
    }

    if (sql.includes("UPDATE likes_albums")) {
      const [delta, albumId] = params;
      this.albumLikes.set(albumId, (this.albumLikes.get(albumId) || 0) + delta);
      return new FakeD1Result([]);
    }

    if (sql.includes("INSERT OR IGNORE INTO likes_albums")) {
      const [albumId] = params;
      if (!this.albumLikes.has(albumId)) this.albumLikes.set(albumId, 0);
      return new FakeD1Result([]);
    }

    if (sql.includes("INSERT OR IGNORE INTO likes_photos")) {
      const [albumId, photoId] = params;
      const key = `${albumId}:${photoId}`;
      if (!this.photoLikes.has(key)) this.photoLikes.set(key, 0);
      return new FakeD1Result([]);
    }

    if (sql.includes("UPDATE likes_photos")) {
      const [delta, albumId, photoId] = params;
      const key = `${albumId}:${photoId}`;
      this.photoLikes.set(key, (this.photoLikes.get(key) || 0) + delta);
      return new FakeD1Result([]);
    }

    if (sql.includes("SELECT count FROM likes_albums WHERE album_id = ?")) {
      const [albumId] = params;
      return new FakeD1Result([{ count: this.albumLikes.get(albumId) || 0 }]);
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

async function json(path, init = {}) {
  const request = new Request(`https://example.test${path}`, init);
  const response = await worker.fetch(request, {
    DB: new FakeD1(),
    ASSETS: {
      fetch() {
        return new Response("asset");
      }
    }
  });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  return {
    status: response.status,
    body: await response.json()
  };
}

async function main() {
  const health = await json("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.albumCount, 2);
  assert.equal(health.body.photoCount, 3);

  const home = await json("/api/home?seed=test");
  assert.equal(home.status, 200);
  assert.equal(home.body.recentAlbums[0].id, "album-b");
  assert.equal(home.body.recentAlbums[1].cover, "https://telegra.ph/file/a.jpg");

  const search = await json("/api/albums?q=alpha&limit=8");
  assert.equal(search.status, 200);
  assert.equal(search.body.total, 1);
  assert.equal(search.body.albums[0].id, "album-a");

  const detail = await json("/api/album/album-a");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.album.id, "album-a");
  assert.equal(detail.body.photos[0].url, "https://telegra.ph/file/a.jpg");

  const photos = await json("/api/photos?mode=sequence&page=1&limit=24");
  assert.equal(photos.status, 200);
  assert.equal(photos.body.total, 3);
  assert.deepEqual(photos.body.photos.map((photo) => photo.id), [
    "album-a-1",
    "album-a-2",
    "album-b-1"
  ]);

  const likeDb = new FakeD1();
  const likeResponse = await worker.fetch(new Request("https://example.test/api/like", {
    method: "POST",
    body: JSON.stringify({
      albumId: "album-a",
      albumDelta: 2,
      likes: [{ photoId: 1, delta: 1 }]
    })
  }), {
    DB: likeDb,
    ASSETS: { fetch: () => new Response("asset") }
  });
  assert.equal(likeResponse.status, 200);
  assert.deepEqual(await likeResponse.json(), { ok: true, count: 2 });
}

await main();
