import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished 松松逛 product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /<title>松松逛｜虚拟购物与数字衣橱<\/title>/i);
  assert.match(html, /想买就先在这里拥有/);
  assert.match(html, /不用真的花钱/);
  assert.match(html, /不收集银行卡/);
  assert.match(html, /松松逛/);
  assert.match(html, /我的衣橱/);
  assert.match(html, /试穿间/);
  assert.match(html, /今日搭配/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps product storage, metadata, and 3D implementation wired", async () => {
  const [page, layout, app, avatar, hosting, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MuseApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Avatar3D.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<MuseApp \/>/);
  assert.match(layout, /松松逛｜虚拟购物与数字衣橱/);
  assert.match(layout, /\/og\.png/);
  assert.match(app, /VIRTUAL SHOPPING/);
  assert.match(app, /照片估算只用于视觉预览/);
  assert.match(app, /不代表衣服的实际尺寸/);
  assert.match(avatar, /WebGLRenderer/);
  assert.match(avatar, /OrbitControls/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "WARDROBE_IMAGES"/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../drizzle/0000_complex_lady_deathstrike.sql", import.meta.url));
  await access(new URL("../app/api/wardrobe/route.ts", import.meta.url));
  await access(new URL("../app/api/profile/route.ts", import.meta.url));
});
