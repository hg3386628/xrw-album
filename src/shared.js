export function normalizeImageUrl(value) {
  return String(value || "")
    .replace("https://telegra.phhttps://legra.ph/file/", "https://telegra.ph/file/")
    .replace("https://telegra.phhttps//legra.ph/file/", "https://telegra.ph/file/");
}

export function seedFrom(value) {
  const input = String(value || Date.now());
  let seed = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    seed ^= input.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

export function random(seed) {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

export function sample(source, count, seedValue) {
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

export function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

export function coprimePhotoStep(total, seedValue) {
  if (total <= 1) return 0;
  let step = seedFrom(`step:${seedValue}`) % total;
  if (!step) step = 1;

  while (greatestCommonDivisor(step, total) !== 1) {
    step += 1;
    if (step >= total) step = 1;
  }

  return step;
}

export function randomPhotoOffset(position, total, seedValue) {
  if (total <= 1) return 0;
  const step = coprimePhotoStep(total, seedValue);
  const shift = seedFrom(`shift:${seedValue}`) % total;
  return (position * step + shift) % total;
}

export function withLike(album) {
  return {
    id: album.id,
    title: album.title,
    count: album.count,
    cover: normalizeImageUrl(album.cover),
    href: album.href,
    order: album.order ?? album.album_order,
    likes: album.likes || 0
  };
}

export function normalizeDetail(detail) {
  return {
    ...detail,
    cover: normalizeImageUrl(detail.cover),
    photos: detail.photos.map((photo) => ({
      ...photo,
      url: normalizeImageUrl(photo.url)
    }))
  };
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export function badRequest(error) {
  return json({ ok: false, error }, 400);
}

export function notFound() {
  return json({ ok: false, error: "Not found" }, 404);
}

export async function healthPayload(store) {
  const manifest = await store.manifest();
  return {
    ok: true,
    albumCount: manifest.albumCount,
    photoCount: manifest.photoCount,
    builtAt: manifest.builtAt
  };
}

export async function homePayload(store, url) {
  const seed = url.searchParams.get("seed") || Date.now();
  const recentSeed = url.searchParams.get("recentSeed");
  const [manifest, recentRows, randomRows] = await Promise.all([
    store.manifest(),
    store.albums({
      mode: "recent",
      page: 1,
      limit: 16
    }),
    store.albums({
      mode: "random",
      seed,
      page: 1,
      limit: 16
    })
  ]);
  const recentAlbums = recentSeed ? sample(recentRows.albums, 16, recentSeed) : recentRows.albums;

  return {
    ok: true,
    manifest,
    recentAlbums: recentAlbums.map(withLike),
    albums: randomRows.albums.map(withLike)
  };
}

export async function albumsPayload(store, url) {
  const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
  const mode = url.searchParams.get("mode") || "all";
  const seed = url.searchParams.get("seed") || "default";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(48, Math.max(8, Number(url.searchParams.get("limit") || 24)));
  const result = await store.albums({ query, mode, seed, page, limit });

  return {
    ok: true,
    mode,
    seed,
    page,
    limit,
    total: result.total,
    albums: result.albums.map(withLike)
  };
}

export async function albumPayload(store, albumId) {
  const album = await store.album(albumId);
  if (!album) return null;

  const detail = await store.albumDetail(albumId);
  if (!detail) return null;

  return {
    ok: true,
    album: withLike(album),
    photos: normalizeDetail(detail).photos,
    likeCount: album.likes || 0
  };
}

export async function photosPayload(store, url) {
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode === "random" ? "random" : "sequence";
  const seed = url.searchParams.get("seed") || "photos";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(120, Math.max(24, Number(url.searchParams.get("limit") || 72)));
  const manifest = await store.manifest();
  const total = manifest.photoCount || 0;
  const startOffset = (page - 1) * limit;
  const photos = [];

  if (mode === "random") {
    const endOffset = Math.min(startOffset + limit, total);
    for (let position = startOffset; position < endOffset; position += 1) {
      const photo = await photoPayloadFromOffset(store, randomPhotoOffset(position, total, seed));
      if (photo) photos.push(photo);
    }
  } else if (startOffset < total) {
    let offset = startOffset;
    while (photos.length < limit && offset < total) {
      const entry = await store.albumByPhotoOffset(offset);
      if (!entry) break;

      const detail = normalizeDetail(await store.albumDetail(entry.id));
      const startInAlbum = Math.max(0, offset - entry.start_offset);
      const take = Math.min(limit - photos.length, detail.photos.length - startInAlbum);

      for (let index = 0; index < take; index += 1) {
        const photo = detail.photos[startInAlbum + index];
        photos.push(photoSummary(entry, photo));
      }

      offset = entry.end_offset;
    }
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

export async function likePayload(store, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body");
  }

  const albumId = String(body.albumId || "");
  const album = await store.album(albumId);
  if (!album) return badRequest("Invalid album id");

  const albumDelta = Math.min(25, Math.max(0, Number(body.albumDelta || 0)));
  const photoLikes = [];
  if (Array.isArray(body.likes)) {
    for (const like of body.likes.slice(0, 100)) {
      const photoId = Number(like.photoId);
      const delta = Math.min(25, Math.max(0, Number(like.delta || 0)));
      if (!Number.isFinite(photoId) || delta <= 0) continue;
      photoLikes.push({ photoId, delta });
    }
  }

  const count = await store.addLikes(albumId, albumDelta, photoLikes);
  return json({ ok: true, count });
}

async function photoPayloadFromOffset(store, offset) {
  const entry = await store.albumByPhotoOffset(offset);
  if (!entry) return null;

  const detail = normalizeDetail(await store.albumDetail(entry.id));
  const photoIndex = offset - entry.start_offset;
  const photo = detail.photos[photoIndex];
  if (!photo) return null;

  return photoSummary(entry, photo);
}

function photoSummary(album, photo) {
  return {
    id: `${album.id}-${photo.id}`,
    albumId: album.id,
    albumTitle: album.title,
    albumHref: album.href,
    photoId: photo.id,
    url: photo.url
  };
}
