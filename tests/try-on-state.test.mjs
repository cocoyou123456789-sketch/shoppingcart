import assert from "node:assert/strict";
import test from "node:test";
import {
  avatarOutfitFromSelection,
  createVirtualWardrobeItem,
  supportsAvatarTryOn,
  wearWardrobeItem,
} from "../app/lib/try-on-state.mjs";

function product(category, id = "item") {
  return {
    id,
    name: `${category}商品`,
    category,
    color: "#d7dff0",
    colorName: "雾霾蓝",
    season: "四季",
    style: "轻松",
  };
}

test("virtual products become wardrobe items without making beauty or decor try-on garments", () => {
  for (const category of ["上装", "下装", "连衣裙", "外套", "鞋履", "配饰"]) {
    const item = createVirtualWardrobeItem(product(category, category));
    assert.deepEqual(item, {
      id: `virtual-${category}`,
      name: `${category}商品`,
      category,
      color: "#d7dff0",
      colorName: "雾霾蓝",
      size: "M",
      source: "虚拟商品",
      season: "四季",
      style: "轻松",
      confidence: "待确认",
    });
  }

  for (const category of ["美妆", "装饰"]) {
    assert.equal(createVirtualWardrobeItem(product(category, category)), null);
  }
  for (const category of ["上装", "下装", "连衣裙", "外套"]) {
    assert.equal(supportsAvatarTryOn(category), true);
  }
  for (const category of ["鞋履", "配饰", "美妆", "装饰"]) {
    assert.equal(supportsAvatarTryOn(category), false);
  }
});

test("wearing separates and dresses keeps their mutually exclusive outfit state", () => {
  const separates = {
    topId: "old-top",
    bottomId: "old-bottom",
    outerwearId: "coat",
  };
  assert.deepEqual(
    wearWardrobeItem(separates, { id: "dress", category: "连衣裙" }),
    { dressId: "dress", outerwearId: "coat" },
  );
  assert.deepEqual(separates, {
    topId: "old-top",
    bottomId: "old-bottom",
    outerwearId: "coat",
  }, "the existing selection is not mutated");

  assert.deepEqual(
    wearWardrobeItem(
      { dressId: "dress", outerwearId: "coat" },
      { id: "new-top", category: "上装" },
    ),
    { dressId: undefined, outerwearId: "coat", topId: "new-top" },
  );
  assert.deepEqual(
    wearWardrobeItem(
      { dressId: "dress", outerwearId: "coat" },
      { id: "new-bottom", category: "下装" },
    ),
    { dressId: undefined, outerwearId: "coat", bottomId: "new-bottom" },
  );
  assert.deepEqual(
    wearWardrobeItem(separates, { id: "new-coat", category: "外套" }),
    { ...separates, outerwearId: "new-coat" },
  );
});

test("shoes and accessories do not change the current 3D outfit", () => {
  const current = { topId: "top", bottomId: "bottom", outerwearId: "coat" };
  for (const category of ["鞋履", "配饰"]) {
    const result = wearWardrobeItem(current, { id: category, category });
    assert.equal(result, current);
    assert.deepEqual(result, current);
  }
});

test("avatar garments are resolved by both selection id and expected category", () => {
  const wardrobe = [
    { id: "top", category: "上装", color: "#111111", chest: 101, waist: 82, hips: 99, length: 66 },
    { id: "bottom", category: "下装", color: "#222222", chest: 88, waist: 76, hips: 104, length: 98 },
    { id: "dress", category: "连衣裙", color: "#333333", chest: 96, waist: 74, hips: 102, length: 112 },
    { id: "coat", category: "外套", color: "#444444", chest: 110, waist: 94, hips: 112, length: 84 },
  ];

  assert.deepEqual(
    avatarOutfitFromSelection(
      { topId: "top", bottomId: "bottom", dressId: "dress", outerwearId: "coat" },
      wardrobe,
    ),
    {
      top: { color: "#111111", chest: 101, waist: 82, hips: 99, length: 66 },
      bottom: { color: "#222222", chest: 88, waist: 76, hips: 104, length: 98 },
      dress: { color: "#333333", chest: 96, waist: 74, hips: 102, length: 112 },
      outerwear: { color: "#444444", chest: 110, waist: 94, hips: 112, length: 84 },
    },
  );
});

test("missing and category-mismatched wardrobe ids are ignored by the avatar", () => {
  const wardrobe = [
    { id: "shared", category: "下装", color: "#wrong" },
    { id: "shared", category: "上装", color: "#right", chest: 100 },
    { id: "shoe", category: "鞋履", color: "#shoe" },
    { id: "coat-as-dress", category: "外套", color: "#coat" },
  ];

  assert.deepEqual(
    avatarOutfitFromSelection(
      {
        topId: "shared",
        bottomId: "missing",
        dressId: "coat-as-dress",
        outerwearId: "shoe",
      },
      wardrobe,
    ),
    {
      top: { color: "#right", chest: 100, waist: undefined, hips: undefined, length: undefined },
      bottom: undefined,
      dress: undefined,
      outerwear: undefined,
    },
  );
});
