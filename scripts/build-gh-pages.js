import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "dist-gh-pages");
const repoName = process.env.GITHUB_PAGES_BASE || "xrw-album";
const basePath = `/${repoName.replace(/^\/+|\/+$/g, "")}`;

async function copyFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function writePhotoShards() {
  const photosDir = path.join(rootDir, "data/photos");
  const shardDir = path.join(outDir, "data/photo-shards");
  const files = await fs.readdir(photosDir);
  const shards = new Map();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -".json".length);
    const shard = id.slice(0, 3);
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)[id] = JSON.parse(await fs.readFile(path.join(photosDir, file), "utf8"));
  }

  await fs.mkdir(shardDir, { recursive: true });
  for (const [shard, details] of shards) {
    await fs.writeFile(path.join(shardDir, `${shard}.json`), `${JSON.stringify(details)}\n`);
  }
  return {
    albumDetailCount: files.filter((file) => file.endsWith(".json")).length,
    shardCount: shards.size
  };
}

function pagesIndex(html) {
  const config = `
    <script>
      window.__XRW_BASE_PATH = ${JSON.stringify(basePath)};
      window.__XRW_STATIC_DATA_BASE = ${JSON.stringify(`${basePath}/data`)};
    </script>`;

  return html
    .replace('href="/favicon.svg?v=1"', `href="${basePath}/favicon.svg?v=1"`)
    .replace('href="/styles.css?v=20260702-23"', `href="${basePath}/styles.css?v=20260702-23"`)
    .replace('src="/app.js?v=20260702-23"', `src="${basePath}/app.js?v=20260702-23"`)
    .replace("    <script>\n      (function () {", `${config}\n    <script>\n      (function () {`);
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  await copyDir(path.join(rootDir, "public"), outDir);
  await fs.mkdir(path.join(outDir, "data"), { recursive: true });
  await copyFile(path.join(rootDir, "data/albums.json"), path.join(outDir, "data/albums.json"));
  await copyFile(path.join(rootDir, "data/manifest.json"), path.join(outDir, "data/manifest.json"));
  const shardStats = await writePhotoShards();

  const indexPath = path.join(outDir, "index.html");
  const html = await fs.readFile(indexPath, "utf8");
  const rendered = pagesIndex(html);
  await fs.writeFile(indexPath, rendered);
  await fs.writeFile(path.join(outDir, "404.html"), rendered);
  await fs.writeFile(path.join(outDir, ".nojekyll"), "");

  console.log(`Built GitHub Pages static site at ${path.relative(rootDir, outDir)}`);
  console.log(`Base path: ${basePath}`);
  console.log(`Album details: ${shardStats.albumDetailCount}`);
  console.log(`Photo detail shards: ${shardStats.shardCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
