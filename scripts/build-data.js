import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const sourceFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(rootDir, "data/source/linuxdo-85w.txt");
const dataDir = path.join(rootDir, "data");
const photosDir = path.join(dataDir, "photos");

const isUrl = (line) => /^https?:\/\//i.test(line);

const normalizeImageUrl = (value) =>
  String(value || "")
    .replace("https://telegra.phhttps://legra.ph/file/", "https://telegra.ph/file/")
    .replace("https://telegra.phhttps//legra.ph/file/", "https://telegra.ph/file/");

const hash = (value) =>
  createHash("sha1").update(value).digest("hex").slice(0, 10);

const albumId = (index, title, cover) =>
  `${index.toString(36).padStart(4, "0")}-${hash(`${title}\n${cover || ""}`)}`;

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value)}\n`);
}

async function main() {
  await fs.access(sourceFile);
  await fs.rm(photosDir, { recursive: true, force: true });
  await fs.mkdir(photosDir, { recursive: true });

  const albums = [];
  let currentTitle = "";
  let currentPhotos = [];
  let totalPhotos = 0;
  let maxPhotos = 0;

  async function flush() {
    if (!currentTitle || currentPhotos.length === 0) {
      currentPhotos = [];
      return;
    }

    const index = albums.length;
    const id = albumId(index, currentTitle, currentPhotos[0]);
    const photos = currentPhotos.map((url, photoIndex) => ({
      id: photoIndex + 1,
      url: normalizeImageUrl(url)
    }));

    await writeJson(path.join(photosDir, `${id}.json`), {
      id,
      title: currentTitle,
      count: photos.length,
      cover: photos[0]?.url || "",
      photos
    });

    albums.push({
      id,
      title: currentTitle,
      count: photos.length,
      cover: photos[0]?.url || "",
      href: `/album/${id}`,
      order: index
    });
    totalPhotos += photos.length;
    maxPhotos = Math.max(maxPhotos, photos.length);
    currentPhotos = [];
  }

  const input = createReadStream(sourceFile, { encoding: "utf8" });
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isUrl(line)) {
      if (currentTitle) currentPhotos.push(line);
      continue;
    }

    await flush();
    currentTitle = line;
  }

  await flush();

  await writeJson(path.join(dataDir, "albums.json"), albums);
  await writeJson(path.join(dataDir, "manifest.json"), {
    builtAt: new Date().toISOString(),
    albumCount: albums.length,
    photoCount: totalPhotos,
    maxPhotosPerAlbum: maxPhotos,
    source: path.relative(rootDir, sourceFile)
  });

  console.log(
    `Built ${albums.length} albums, ${totalPhotos} photos, max ${maxPhotos} photos/album`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
