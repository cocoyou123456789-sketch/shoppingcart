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

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
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
  assert.match(html, /href="#main-content"[^>]*>跳到主要内容</);
  assert.match(html, /<main[^>]+id="main-content"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps product storage, metadata, and 3D implementation wired", async () => {
  const [page, layout, app, avatar, avatarRuntime, deferredAvatar, wardrobeRoute, personalDataRoute, hosting, packageJson, requestOwner, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MuseApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Avatar3D.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/avatar-runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DeferredAvatar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wardrobe/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/personal-data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/request-owner.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<MuseApp[^>]+storageOwner=/);
  assert.match(page, /key=\{user\?\.email \?\? "device"\}/);
  assert.match(layout, /松松逛｜虚拟购物与数字衣橱/);
  assert.match(layout, /\/og\.jpg/);
  assert.match(layout, /\/favicon-48\.png/);
  assert.match(app, /VIRTUAL SHOPPING/);
  assert.match(app, /不会凭一张照片猜测厘米数/);
  assert.match(app, /只提取明确标注的尺寸/);
  assert.match(app, /清除我的全部资料/);
  assert.match(app, /本机已保存/);
  assert.match(app, /Promise\.allSettled/);
  assert.match(app, /localSnapshotKey\(storageOwner\)/);
  assert.match(app, /isClearedLocalSnapshot/);
  assert.match(app, /const backgroundInert = clearingData \|\| cartOpen \|\| addOpen \|\| celebrationOpen/);
  assert.match(app, /inert=\{backgroundInert \? true : undefined\}/);
  assert.match(app, /href="#main-content"/);
  assert.match(app, /id="main-content"/);
  assert.match(app, /className="product-grid">/);
  assert.doesNotMatch(app, /className="product-grid"[^>]*aria-live/);
  assert.match(app, /resultAnnouncement/);
  assert.match(app, /deleteAndRestoreFocus/);
  assert.match(app, /id="garment-submit-error"[\s\S]*role="alert"/);
  assert.match(app, /aria-errormessage=\{importError/);
  assert.match(app, /浏览器阻止清除本机副本/);
  assert.match(app, /preservePersistedPhotos/);
  assert.match(app, /invalidateRecognizedMeasurements/);
  assert.match(app, /dailyPreferences/);
  assert.match(app, /rankOutfitSelections/);
  assert.match(app, /pendingMutations\.map\(\(mutation\) => mutation\.promise\)/);
  assert.match(app, /CLOUD_MUTATION_TIMEOUT_MS/);
  assert.match(app, /CLOUD_UPLOAD_TIMEOUT_MS/);
  assert.match(app, /pendingMutations\.forEach\(\(mutation\) => mutation\.controller\.abort\(\)\)/);
  assert.match(app, /BroadcastChannel\("songsong-closet:coordination:v1"\)/);
  assert.match(app, /snapshotMatchesClearSignal/);
  assert.match(app, /wardrobeCloudId/);
  assert.match(app, /\/api\/personal-data/);
  assert.ok(
    app.indexOf("latestSnapshot.current = emptySnapshot") <
      app.indexOf('"/api/personal-data"'),
    "device state must be cleared before cloud deletion begins",
  );
  assert.match(app, /cloudItemIds\.current\.has/);
  assert.match(app, /savedProductIds/);
  assert.match(avatar, /WebGLRenderer/);
  assert.match(avatar, /OrbitControls/);
  assert.match(avatar, /webglcontextlost/);
  assert.match(avatar, /forceContextLoss/);
  assert.match(avatar, /1000 \/ 30/);
  assert.match(avatar, /controls\.update\(deltaSeconds\)/);
  assert.match(avatar, /runtimeRef/);
  assert.match(avatar, /replaceRuntimeAvatar\(runtime, nextAvatar, disposeObject3D\)/);
  assert.match(avatar, /createVisibleTimeBudget\(AVATAR_AUTO_ROTATE_MS\)/);
  assert.match(avatar, /avatarPixelRatio/);
  assert.match(avatarRuntime, /disposeAvatar\(previousAvatar\)/);
  assert.match(avatarRuntime, /shadowMap\.needsUpdate = true/);
  assert.doesNotMatch(avatar, /\[sceneMetrics, sceneOutfit, compact, retryVersion\]/);
  assert.match(avatar, /role="group"/);
  assert.match(deferredAvatar, /requestIdleCallback/);
  assert.match(deferredAvatar, /saveData/);
  assert.match(deferredAvatar, /AvatarErrorBoundary/);
  assert.match(deferredAvatar, /catch\(\(\) =>/);
  assert.match(wardrobeRoute, /datetime\('now', '-10 minutes'\)/);
  assert.match(wardrobeRoute, /ALLOWED_IMAGE_TYPES/);
  assert.match(wardrobeRoute, /db\.batch/);
  assert.match(wardrobeRoute, /wardrobe_image_cleanup/);
  assert.match(wardrobeRoute, /crc32/);
  assert.match(wardrobeRoute, /requestWithLimitedBody/);
  assert.match(wardrobeRoute, /reader\.cancel/);
  assert.match(wardrobeRoute, /headers\.delete\("transfer-encoding"\)/);
  assert.match(wardrobeRoute, /owner_data_generations/);
  assert.match(wardrobeRoute, /wardrobe_sync_keys/);
  assert.match(wardrobeRoute, /state = 'deleted'/);
  assert.match(wardrobeRoute, /wardrobeCloudId/);
  assert.match(personalDataRoute, /db\.batch/);
  assert.match(personalDataRoute, /personal_data_clear_operations/);
  assert.match(personalDataRoute, /personal_data_clear_images/);
  assert.match(personalDataRoute, /FROM wardrobe_image_cleanup/);
  assert.match(personalDataRoute, /retry-after/);
  assert.match(personalDataRoute, /DELETE FROM body_profiles/);
  assert.match(personalDataRoute, /DELETE FROM wardrobe_items/);
  assert.match(styles, /\.save-button, \.icon-button, \.cart-list article > button \{ min-width: 44px; \}/);
  assert.match(styles, /\.choice-group legend[\s\S]*font-size: 12px;/);
  assert.match(styles, /@media \(pointer: coarse\)/);
  assert.match(styles, /\.skip-link:focus/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "WARDROBE_IMAGES"/);
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"typecheck"/);
  assert.doesNotMatch(requestOwner, /private-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../drizzle/0000_complex_lady_deathstrike.sql", import.meta.url));
  await access(new URL("../drizzle/0002_rapid_cerise.sql", import.meta.url));
  await access(new URL("../drizzle/0003_smart_james_howlett.sql", import.meta.url));
  await access(new URL("../app/api/wardrobe/route.ts", import.meta.url));
  await access(new URL("../app/api/profile/route.ts", import.meta.url));
});

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("critical secondary text colors meet WCAG AA contrast", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const muted = styles.match(/--muted:\s*(#[0-9a-f]{6})/i)?.[1];
  const pathCopy = styles.match(/\.path-card p \{[\s\S]*?color:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(muted);
  assert.ok(pathCopy);
  assert.ok(contrastRatio(muted, "#e5e9e1") >= 4.5);
  assert.ok(contrastRatio(pathCopy, "#e7c7bb") >= 4.5);
  assert.ok(contrastRatio(pathCopy, "#cbc7dd") >= 4.5);
});

test("rejects anonymous reads and writes to private wardrobe APIs", async () => {
  const worker = await loadWorker();
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  for (const [path, method] of [
    ["/api/wardrobe", "GET"],
    ["/api/wardrobe", "POST"],
    ["/api/wardrobe?id=w-test", "DELETE"],
    ["/api/wardrobe?scope=all", "DELETE"],
    ["/api/profile", "GET"],
    ["/api/profile", "PUT"],
    ["/api/profile", "DELETE"],
    ["/api/personal-data", "DELETE"],
    ["/api/wardrobe/image?id=w-test", "GET"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://public.example${path}`, { method }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 401, path);
  }
});
