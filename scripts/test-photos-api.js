import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const port = 29100 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port)
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

async function waitForServer() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  throw new Error(`Server did not start.\n${serverOutput}`);
}

async function getPhotos(query) {
  const response = await fetch(`${baseUrl}/api/photos?${query}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  return payload;
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  return payload;
}

function ids(payload) {
  return payload.photos.map((photo) => photo.id);
}

async function main() {
  await waitForServer();

  const sequence = await getPhotos("mode=sequence&page=1&limit=24");
  assert.equal(sequence.mode, "sequence");
  assert.equal(sequence.photos.length, 24);

  const randomA = await getPhotos("mode=random&page=1&limit=24&seed=ui-order-test");
  assert.equal(randomA.mode, "random");
  assert.equal(randomA.seed, "ui-order-test");
  assert.equal(randomA.photos.length, 24);
  assert.notDeepEqual(ids(randomA), ids(sequence));
  assert.equal(new Set(ids(randomA)).size, randomA.photos.length);

  const randomARepeat = await getPhotos("mode=random&page=1&limit=24&seed=ui-order-test");
  assert.deepEqual(ids(randomARepeat), ids(randomA));

  const randomAPage2 = await getPhotos("mode=random&page=2&limit=24&seed=ui-order-test");
  for (const id of ids(randomAPage2)) {
    assert.equal(ids(randomA).includes(id), false);
  }

  const randomB = await getPhotos("mode=random&page=1&limit=24&seed=ui-order-test-b");
  assert.notDeepEqual(ids(randomB), ids(randomA));

  const badSourceAlbum = await getJson("/api/album/04qz-20e526d6e2");
  assert.equal(badSourceAlbum.album.cover.includes("telegra.phhttps"), false);
  assert.equal(badSourceAlbum.photos.some((photo) => photo.url.includes("telegra.phhttps")), false);

  const search = await getJson("/api/albums?q=VITAMINA&limit=24");
  assert.equal(search.albums[0].cover.includes("telegra.phhttps"), false);
}

try {
  await main();
} finally {
  server.kill("SIGTERM");
  await once(server, "exit").catch(() => {});
}
