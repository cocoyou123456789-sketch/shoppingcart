import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

test("GitHub Pages build keeps its project base path and core product", async () => {
  const html = await readFile(new URL("../pages-dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>松松逛｜虚拟购物与数字衣橱<\/title>/);
  assert.match(html, /data-storage-mode="device"/);
  assert.match(html, /\/shoppingcart\/assets\/[^"']+\.js/);
  assert.match(html, /\/shoppingcart\/assets\/[^"']+\.css/);
  assert.match(html, /\/shoppingcart\/favicon-48\.png/);
  assert.doesNotMatch(html, /modulepreload[^>]+Avatar3D/i);

  const assetPaths = [...html.matchAll(/(?:src|href)="\/shoppingcart\/(assets\/[^"']+)"/g)]
    .map((match) => new URL(`../pages-dist/${match[1]}`, import.meta.url));
  assert.ok(assetPaths.length >= 2);
  await Promise.all(assetPaths.map((path) => access(path)));
  const assets = await readdir(new URL("../pages-dist/assets/", import.meta.url));
  const avatarAsset = assets.find((name) => /^Avatar3D-.+\.js$/.test(name));
  assert.ok(avatarAsset);
  const entryAsset = html.match(/src="\/shoppingcart\/assets\/([^"']+\.js)"/)?.[1];
  const cssAsset = html.match(/href="\/shoppingcart\/assets\/([^"']+\.css)"/)?.[1];
  assert.ok(entryAsset);
  assert.ok(cssAsset);

  const gzipBytes = async (name) => gzipSync(
    await readFile(new URL(`../pages-dist/assets/${name}`, import.meta.url)),
    { level: 9 },
  ).byteLength;
  assert.ok(await gzipBytes(entryAsset) <= 90 * 1024, "entry JavaScript exceeded 90 KiB gzip");
  assert.ok(await gzipBytes(avatarAsset) <= 145 * 1024, "3D chunk exceeded 145 KiB gzip");
  assert.ok(await gzipBytes(cssAsset) <= 16 * 1024, "CSS exceeded 16 KiB gzip");

  const favicon = new URL("../pages-dist/favicon-48.png", import.meta.url);
  assert.ok((await stat(favicon)).size <= 8 * 1024, "favicon exceeded 8 KiB");
  await access(new URL("../pages-dist/.nojekyll", import.meta.url));
});
