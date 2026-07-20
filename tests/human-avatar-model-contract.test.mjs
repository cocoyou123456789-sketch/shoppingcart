import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const modelUrl = new URL(
  "../public/avatar/human-female-cc0.gltf",
  import.meta.url,
);
const textureUrl = new URL(
  "../public/avatar/human-female-head-cc0.webp",
  import.meta.url,
);

test("the bundled human model is a small self-contained CC0 anatomical mesh", async () => {
  const [raw, modelStats, textureStats, notice] = await Promise.all([
    readFile(modelUrl, "utf8"),
    stat(modelUrl),
    stat(textureUrl),
    readFile(
      new URL(
        "../public/avatar/human-female-cc0-NOTICE.txt",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const gltf = JSON.parse(raw);
  assert.match(gltf.asset.copyright, /CC0 Public Domain/i);
  assert.ok(modelStats.size <= 500_000);
  assert.ok(textureStats.size <= 160_000);
  assert.equal(gltf.buffers.length, 1);
  assert.match(gltf.buffers[0].uri, /^data:application\/octet-stream;base64,/);
  assert.equal(gltf.images, undefined);
  assert.equal(gltf.skins.length, 1);
  assert.ok(gltf.skins[0].joints.length >= 60);
  const meshNodeNames = gltf.nodes
    .filter((node) => Number.isInteger(node.mesh))
    .map((node) => node.name);
  for (const required of [
    "mesh_Body",
    "mesh_Eyes",
    "mesh_Hand_L",
    "mesh_Hand_R",
    "mesh_Head",
  ]) {
    assert.ok(meshNodeNames.includes(required), `missing ${required}`);
  }
  assert.match(notice, /CC0 1\.0 Universal/);
  assert.match(notice, /81a7cb24c3ba03c68523e48e946d631551dfebcb/);
});
