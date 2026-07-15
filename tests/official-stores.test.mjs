import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_STORES,
  OFFICIAL_STORE_HOSTS,
  isOfficialStoreUrl,
} from "../app/lib/official-stores.mjs";

const EXPECTED_STORES = [
  "淘宝",
  "天猫",
  "ZARA",
  "Aritzia",
  "UNIQLO",
  "lululemon",
  "SNIDEL",
];

test("curated store directory contains only the seven verified HTTPS destinations", () => {
  assert.equal(OFFICIAL_STORES.length, EXPECTED_STORES.length);
  assert.deepEqual(OFFICIAL_STORES.map((store) => store.name), EXPECTED_STORES);
  assert.equal(new Set(OFFICIAL_STORES.map((store) => store.id)).size, OFFICIAL_STORES.length);
  assert.equal(new Set(OFFICIAL_STORES.map((store) => store.href)).size, OFFICIAL_STORES.length);

  for (const store of OFFICIAL_STORES) {
    const url = new URL(store.href);
    assert.equal(url.protocol, "https:");
    assert.ok(OFFICIAL_STORE_HOSTS.includes(url.hostname));
    assert.equal(isOfficialStoreUrl(store.href), true);
    for (const unsupportedField of ["price", "stock", "inventory", "discount"]) {
      assert.equal(unsupportedField in store, false);
    }
  }
});

test("official store URL guard rejects lookalikes and unsafe URL forms", () => {
  for (const value of [
    "http://www.zara.cn/",
    "https://www.zara.cn.example.com/",
    "https://zara.cn/",
    "https://www.tmall.com.evil.example/",
    "https://user:secret@www.uniqlo.cn/",
    "https://www.lululemon.cn:8443/",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isOfficialStoreUrl(value), false, value);
  }
  assert.equal(isOfficialStoreUrl("https://www.taobao.com:443/"), true);
});
