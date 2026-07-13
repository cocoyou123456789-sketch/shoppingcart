import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages build keeps its project base path and core product", async () => {
  const html = await readFile(new URL("../pages-dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>松松逛｜虚拟购物与数字衣橱<\/title>/);
  assert.match(html, /data-storage-mode="device"/);
  assert.match(html, /\/shoppingcart\/assets\/[^"']+\.js/);
  assert.match(html, /\/shoppingcart\/assets\/[^"']+\.css/);
  assert.match(html, /\/shoppingcart\/favicon\.png/);

  const assetPaths = [...html.matchAll(/(?:src|href)="\/shoppingcart\/(assets\/[^"']+)"/g)]
    .map((match) => new URL(`../pages-dist/${match[1]}`, import.meta.url));
  assert.ok(assetPaths.length >= 2);
  await Promise.all(assetPaths.map((path) => access(path)));
  const assets = await readdir(new URL("../pages-dist/assets/", import.meta.url));
  assert.ok(assets.some((name) => /^Avatar3D-.+\.js$/.test(name)));
  await access(new URL("../pages-dist/.nojekyll", import.meta.url));
});
