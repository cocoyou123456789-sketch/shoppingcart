import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldKeepWardrobeValidationOpen,
  wardrobeValidationMessage,
} from "../app/lib/wardrobe-save-policy.mjs";

test("definite client validation failures stay visible instead of posing as local success", () => {
  for (const status of [400, 401, 403, 413, 415, 422]) {
    assert.equal(shouldKeepWardrobeValidationOpen(status), true, String(status));
    assert.ok(wardrobeValidationMessage(status).length > 0);
  }
});

test("temporary failures may fall back to the durable device queue", () => {
  for (const status of [408, 425, 429, 500, 503]) {
    assert.equal(shouldKeepWardrobeValidationOpen(status), false, String(status));
  }
});
