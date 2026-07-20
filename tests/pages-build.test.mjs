import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

test("GitHub Pages build keeps its project base path and core product", async () => {
  const html = await readFile(new URL("../pages-dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>松松逛｜真实好物、虚拟购物与数字衣橱<\/title>/);
  assert.match(html, /data-storage-mode="device"/);
  assert.match(html, /\/shoppingcart\/assets\/[^"']+\.js/);
  assert.match(html, /\/shoppingcart\/assets\/[^"']+\.css/);
  assert.match(html, /\/shoppingcart\/favicon-48\.png/);
  assert.match(html, /\/shoppingcart\/og-real-v1\.jpg/);
  assert.doesNotMatch(html, /modulepreload[^>]+Avatar3D/i);
  assert.doesNotMatch(html, /modulepreload[^>]+AddGarmentDialog/i);
  assert.doesNotMatch(html, /modulepreload[^>]+garment-analysis/i);
  assert.doesNotMatch(html, /modulepreload[^>]+wardrobe-photo/i);
  assert.doesNotMatch(html, /modulepreload[^>]+(?:Shop|Closet|Studio|Daily)View/i);

  const assetPaths = [...html.matchAll(/(?:src|href)="\/shoppingcart\/(assets\/[^"']+)"/g)]
    .map((match) => new URL(`../pages-dist/${match[1]}`, import.meta.url));
  assert.ok(assetPaths.length >= 2);
  await Promise.all(assetPaths.map((path) => access(path)));
  const assets = await readdir(new URL("../pages-dist/assets/", import.meta.url));
  const avatarAsset = assets.find((name) => /^Avatar3D-.+\.js$/.test(name));
  const addGarmentAsset = assets.find((name) => /^AddGarmentDialog-.+\.js$/.test(name));
  const garmentAnalysisAsset = assets.find((name) => /^garment-analysis-.+\.js$/.test(name));
  const wardrobePhotoAsset = assets.find((name) => /^wardrobe-photo-.+\.js$/.test(name));
  const realShopAsset = assets.find((name) => /^RealShopView-.+\.js$/.test(name));
  const virtualShopAsset = assets.find((name) => /^VirtualShopView-.+\.js$/.test(name));
  const lazyViewAssets = {
    shop: assets.find((name) => /^ShopView-.+\.js$/.test(name)),
    closet: assets.find((name) => /^ClosetView-.+\.js$/.test(name)),
    studio: assets.find((name) => /^StudioView-.+\.js$/.test(name)),
    daily: assets.find((name) => /^DailyView-.+\.js$/.test(name)),
  };
  assert.ok(avatarAsset);
  assert.ok(addGarmentAsset);
  assert.ok(garmentAnalysisAsset);
  assert.ok(wardrobePhotoAsset);
  assert.ok(realShopAsset);
  assert.ok(virtualShopAsset);
  for (const [view, asset] of Object.entries(lazyViewAssets)) {
    assert.ok(asset, `${view} view must have its own on-demand chunk`);
  }
  const entryAsset = html.match(/src="\/shoppingcart\/assets\/([^"']+\.js)"/)?.[1];
  const cssAsset = html.match(/href="\/shoppingcart\/assets\/([^"']+\.css)"/)?.[1];
  assert.ok(entryAsset);
  assert.ok(cssAsset);
  const cssSource = await readFile(
    new URL(`../pages-dist/assets/${cssAsset}`, import.meta.url),
    "utf8",
  );
  assert.match(
    cssSource,
    /url\(\/shoppingcart\/shop\/virtual-product-sprite-v1\.jpg\)/,
    "virtual shop photography must keep the GitHub Pages base path",
  );
  await access(
    new URL("../pages-dist/shop/virtual-product-sprite-v1.jpg", import.meta.url),
  );

  const gzipBytes = async (name) => gzipSync(
    await readFile(new URL(`../pages-dist/assets/${name}`, import.meta.url)),
    { level: 9 },
  ).byteLength;

  const initialScripts = new Set([
    ...[...html.matchAll(/<script\b[^>]*\bsrc="\/shoppingcart\/assets\/([^"']+\.js)"[^>]*>/g)]
      .map((match) => match[1]),
    ...[...html.matchAll(/<link\b(?=[^>]*\brel="modulepreload")[^>]*\bhref="\/shoppingcart\/assets\/([^"']+\.js)"[^>]*>/g)]
      .map((match) => match[1]),
  ]);
  const initialStyles = new Set(
    [...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="\/shoppingcart\/assets\/([^"']+\.css)"[^>]*>/g)]
      .map((match) => match[1]),
  );
  const gzipTotal = async (names) => {
    const sizes = await Promise.all([...names].map(gzipBytes));
    return sizes.reduce((sum, size) => sum + size, 0);
  };
  assert.ok(await gzipTotal(initialScripts) <= 86 * 1024, "initial JavaScript exceeded 86 KiB gzip");
  assert.ok(await gzipTotal(initialStyles) <= 16 * 1024, "initial CSS exceeded 16 KiB gzip");

  const lazyPayloadBytes = async (rootAsset) => {
    const seen = new Set();
    const pending = [rootAsset];
    while (pending.length) {
      const name = pending.pop();
      if (!name || seen.has(name) || initialScripts.has(name)) continue;
      seen.add(name);
      const source = await readFile(
        new URL(`../pages-dist/assets/${name}`, import.meta.url),
        "utf8",
      );
      for (const match of source.matchAll(/(?:from|import)\s*(?:\(\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g)) {
        if (!seen.has(match[1]) && !initialScripts.has(match[1])) pending.push(match[1]);
      }
    }
    return gzipTotal(seen);
  };
  assert.ok(await lazyPayloadBytes(avatarAsset) <= 145 * 1024, "3D payload exceeded 145 KiB gzip");
  assert.ok(
    await lazyPayloadBytes(addGarmentAsset) <= 8 * 1024,
    "on-demand garment dialog exceeded 8 KiB gzip",
  );
  assert.ok(
    await lazyPayloadBytes(garmentAnalysisAsset) <= 2 * 1024,
    "on-demand garment analysis exceeded 2 KiB gzip",
  );
  assert.ok(
    await lazyPayloadBytes(wardrobePhotoAsset) <= 2 * 1024,
    "on-demand wardrobe photo preparation exceeded 2 KiB gzip",
  );
  for (const [view, asset] of Object.entries(lazyViewAssets)) {
    // The studio's optional 3D import is budgeted independently above; this
    // loop keeps the view shell itself small enough to open immediately.
    const viewBytes = view === "studio" || view === "shop"
      ? await gzipBytes(asset)
      : await lazyPayloadBytes(asset);
    assert.ok(
      viewBytes <= 5 * 1024,
      `${view} view exceeded 5 KiB gzip`,
    );
  }
  assert.ok(
    await lazyPayloadBytes(realShopAsset) <= 6 * 1024,
    "real shop directory exceeded 6 KiB gzip",
  );
  assert.ok(
    await lazyPayloadBytes(virtualShopAsset) <= 5 * 1024,
    "virtual shop directory exceeded 5 KiB gzip",
  );

  const entrySource = await readFile(
    new URL(`../pages-dist/assets/${entryAsset}`, import.meta.url),
    "utf8",
  );
  const addGarmentSource = await readFile(
    new URL(`../pages-dist/assets/${addGarmentAsset}`, import.meta.url),
    "utf8",
  );
  const shopSource = await readFile(
    new URL(`../pages-dist/assets/${lazyViewAssets.shop}`, import.meta.url),
    "utf8",
  );
  const realShopSource = await readFile(
    new URL(`../pages-dist/assets/${realShopAsset}`, import.meta.url),
    "utf8",
  );
  const escapedAddGarmentAsset = addGarmentAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedGarmentAsset = garmentAnalysisAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedWardrobePhotoAsset = wardrobePhotoAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    entrySource,
    new RegExp(escapedAddGarmentAsset),
    "entry must reference the on-demand garment dialog chunk",
  );
  assert.doesNotMatch(
    entrySource,
    /ADD TO WARDROBE|上传衣物正面照|确认，放进衣橱|尺码表文字/,
    "entry must not contain garment-dialog implementation copy",
  );
  assert.doesNotMatch(
    entrySource,
    new RegExp(escapedGarmentAsset),
    "entry must not load garment analysis before the dialog requests it",
  );
  assert.match(
    entrySource,
    new RegExp(escapedWardrobePhotoAsset),
    "entry must reference the on-demand wardrobe photo preparation chunk",
  );
  assert.doesNotMatch(
    entrySource,
    /Photo encoding failed|wardrobe-photo\.jpg/,
    "entry must not contain wardrobe photo preparation implementation",
  );
  for (const [view, asset] of Object.entries(lazyViewAssets)) {
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(entrySource, new RegExp(escapedAsset), `entry must reference lazy ${view} view`);
  }
  for (const nestedAsset of [realShopAsset, virtualShopAsset]) {
    const escapedAsset = nestedAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(shopSource, new RegExp(escapedAsset), "shop shell must reference its nested mode chunk");
  }
  assert.match(realShopSource, /淘宝/);
  assert.match(realShopSource, /SNIDEL/);
  assert.match(realShopSource, /noopener noreferrer external/);
  assert.doesNotMatch(realShopSource, /(?:price|stock|inventory|discount)\s*:/i);
  assert.doesNotMatch(
    entrySource,
    /REAL SHOPS ·|VIRTUAL SHOPPING · 0 元体验|MY DIGITAL WARDROBE|3D FITTING STUDIO|TODAY(?:&apos;|')S OUTFIT/,
    "entry must not contain non-home view implementation copy",
  );
  assert.match(addGarmentSource, /ADD TO WARDROBE/);
  assert.match(
    addGarmentSource,
    new RegExp(escapedGarmentAsset),
    "garment dialog must keep analysis as a nested on-demand chunk",
  );

  const favicon = new URL("../pages-dist/favicon-48.png", import.meta.url);
  assert.ok((await stat(favicon)).size <= 8 * 1024, "favicon exceeded 8 KiB");
  const socialCard = new URL("../pages-dist/og-real-v1.jpg", import.meta.url);
  assert.ok((await stat(socialCard)).size <= 180 * 1024, "social card exceeded 180 KiB");
  for (const name of ["real-model-base-v1.jpg", "real-model-dress-v1.jpg"]) {
    const model = new URL(`../pages-dist/avatar/${name}`, import.meta.url);
    assert.ok((await stat(model)).size <= 220 * 1024, `${name} exceeded 220 KiB`);
  }
  await access(new URL("../pages-dist/.nojekyll", import.meta.url));
});
