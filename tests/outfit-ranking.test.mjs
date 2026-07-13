import assert from "node:assert/strict";
import test from "node:test";
import { rankOutfitSelections } from "../app/lib/outfit-ranking.mjs";

const item = (id, score) => ({ id, score });
const scoreItem = (candidate) => candidate.score;

test("ranks the strongest complete top-and-bottom look first", () => {
  const looks = rankOutfitSelections({
    tops: [item("cream-tee", 22), item("blue-shirt", 12)],
    bottoms: [item("green-pants", 14), item("purple-skirt", 8)],
    dresses: [item("dress", 12)],
    outers: [],
    needsOuterwear: false,
    scoreItem,
  });

  assert.deepEqual(looks[0], {
    selection: { topId: "cream-tee", bottomId: "green-pants" },
    score: 18,
    key: "cream-tee|green-pants",
  });
});

test("adds the best weather-appropriate outerwear without duplicating looks", () => {
  const looks = rankOutfitSelections({
    tops: [item("top", 10)],
    bottoms: [item("bottom", 8)],
    dresses: [],
    outers: [item("raincoat", 12), item("jacket", 5)],
    needsOuterwear: true,
    scoreItem,
  });

  assert.equal(looks[0].selection.outerwearId, "raincoat");
  assert.equal(looks[0].score, 21);
  assert.equal(new Set(looks.map((look) => look.key)).size, looks.length);
});

test("does not reward a weaker two-piece look merely for having more items", () => {
  const looks = rankOutfitSelections({
    tops: [item("weak-top", 6)],
    bottoms: [item("weak-bottom", 6)],
    dresses: [item("strong-dress", 10)],
    outers: [],
    needsOuterwear: false,
    scoreItem,
  });

  assert.deepEqual(looks[0].selection, { dressId: "strong-dress" });
  assert.equal(looks[0].score, 10);
});

test("falls back to dresses and returns no incomplete suggestions", () => {
  const dressOnly = rankOutfitSelections({
    tops: [item("top", 10)],
    bottoms: [],
    dresses: [item("dress", 9)],
    outers: [],
    needsOuterwear: false,
    scoreItem,
  });
  assert.deepEqual(dressOnly.map((look) => look.selection), [{ dressId: "dress" }]);

  const incomplete = rankOutfitSelections({
    tops: [item("top", 10)],
    bottoms: [],
    dresses: [],
    outers: [],
    needsOuterwear: false,
    scoreItem,
  });
  assert.deepEqual(incomplete, []);
});
