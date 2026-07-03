import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const photosDir = path.join(dataDir, "photos");

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function maybeReadLikes() {
  try {
    return await readJson(path.join(dataDir, "likes.json"));
  } catch {
    return { albums: {}, photos: {} };
  }
}

function insert(table, values) {
  const columns = Object.keys(values);
  const rendered = columns.map((column) => values[column]);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${rendered.join(", ")});`;
}

async function main() {
  const outArg = argValue("--out", "data/d1-seed.sql");
  const limitArg = argValue("--limit");
  const withTransaction = process.argv.includes("--transaction");
  const limit = limitArg ? Math.max(1, Number(limitArg)) : null;
  const outFile = path.resolve(rootDir, outArg);
  const albums = await readJson(path.join(dataDir, "albums.json"));
  const sourceManifest = await readJson(path.join(dataDir, "manifest.json"));
  const likes = await maybeReadLikes();
  const selectedAlbums = limit ? albums.slice(0, limit) : albums;

  const lines = [
    "DELETE FROM likes_photos;",
    "DELETE FROM likes_albums;",
    "DELETE FROM album_details;",
    "DELETE FROM albums;",
    "DELETE FROM meta;"
  ];
  if (withTransaction) {
    lines.unshift("PRAGMA foreign_keys = OFF;", "BEGIN TRANSACTION;");
  }

  let runningPhotoTotal = 0;
  let maxPhotosPerAlbum = 0;

  for (const album of selectedAlbums) {
    const detail = await readJson(path.join(photosDir, `${album.id}.json`));
    const startOffset = runningPhotoTotal;
    const endOffset = startOffset + detail.photos.length;
    runningPhotoTotal = endOffset;
    maxPhotosPerAlbum = Math.max(maxPhotosPerAlbum, detail.photos.length);

    lines.push(insert("albums", {
      id: sqlString(album.id),
      title: sqlString(album.title),
      title_lc: sqlString(album.title.toLocaleLowerCase()),
      count: sqlNumber(detail.photos.length),
      cover: sqlString(album.cover),
      href: sqlString(album.href),
      album_order: sqlNumber(album.order),
      start_offset: sqlNumber(startOffset),
      end_offset: sqlNumber(endOffset)
    }));

    lines.push(insert("album_details", {
      album_id: sqlString(album.id),
      detail_json: sqlString(JSON.stringify({
        ...detail,
        count: detail.photos.length
      }))
    }));

    const albumLikeCount = Number(likes.albums?.[album.id] || 0);
    if (albumLikeCount > 0) {
      lines.push(insert("likes_albums", {
        album_id: sqlString(album.id),
        count: sqlNumber(albumLikeCount)
      }));
    }
  }

  for (const [key, count] of Object.entries(likes.photos || {})) {
    const [albumId, photoId] = key.split(":");
    if (!selectedAlbums.some((album) => album.id === albumId)) continue;
    const value = Number(count || 0);
    if (value <= 0) continue;
    lines.push(insert("likes_photos", {
      album_id: sqlString(albumId),
      photo_id: sqlNumber(photoId),
      count: sqlNumber(value)
    }));
  }

  const manifest = {
    ...sourceManifest,
    albumCount: selectedAlbums.length,
    photoCount: runningPhotoTotal,
    maxPhotosPerAlbum,
    d1ExportedAt: new Date().toISOString(),
    d1SourceAlbumCount: albums.length,
    d1Limited: Boolean(limit)
  };
  lines.push(insert("meta", {
    key: sqlString("manifest"),
    value: sqlString(JSON.stringify(manifest))
  }));
  if (withTransaction) {
    lines.push("COMMIT;");
    lines.push("PRAGMA foreign_keys = ON;");
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${lines.join("\n")}\n`);
  console.log(`Wrote ${selectedAlbums.length} albums and ${runningPhotoTotal} photos to ${path.relative(rootDir, outFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
