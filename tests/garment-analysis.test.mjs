import assert from "node:assert/strict";
import test from "node:test";
import { extractGarmentMeasurements } from "../app/lib/garment-analysis.mjs";

test("extracts labelled metric size-chart values", () => {
  const result = extractGarmentMeasurements("M 码：胸围 104 cm，腰围 86，臀围 108，衣长 67");
  assert.deepEqual(result.measurements, { chest: 104, waist: 86, hips: 108, length: 67 });
  assert.deepEqual(result.matched, ["chest", "waist", "hips", "length"]);
});

test("converts flat widths and inches without guessing unlabelled numbers", () => {
  const result = extractGarmentMeasurements("Size M / pit to pit: 20 in / garment length 26 inches / 2026");
  assert.deepEqual(result.measurements, { chest: 101.6, length: 66 });
  assert.deepEqual(result.matched, ["chest", "length"]);
});

test("ignores missing, implausible, and unlabelled measurements", () => {
  assert.deepEqual(extractGarmentMeasurements("M 165/88A 商品编号 104").measurements, {});
  assert.deepEqual(extractGarmentMeasurements("胸围 999 cm，衣长 2 cm").measurements, {});
});

test("does not confuse sleeve length with garment length", () => {
  const result = extractGarmentMeasurements("chest 104 cm, sleeve length 60 cm, garment length 68 cm");
  assert.deepEqual(result.measurements, { chest: 104, length: 68 });
});

test("rejects ambiguous multi-size values instead of choosing the first size", () => {
  const result = extractGarmentMeasurements(
    "S 胸围 92 cm 衣长 60 cm；M 胸围 96 cm 衣长 62 cm；L 胸围 100 cm 衣长 64 cm",
  );
  assert.deepEqual(result.measurements, {});
  assert.deepEqual(result.matched, []);
});
