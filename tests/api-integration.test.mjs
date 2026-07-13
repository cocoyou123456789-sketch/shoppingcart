import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const origin = "http://localhost:4179";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function garmentForm() {
  const form = new FormData();
  form.set("name", "隔离测试上衣");
  form.set("category", "上装");
  form.set("color", "#d7dff0");
  form.set("colorName", "雾霾蓝");
  form.set("size", "M");
  form.set("season", "四季");
  form.set("style", "轻松");
  form.set("confidence", "中");
  return form;
}

async function waitForServer(child, logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Development server exited early:\n${logs.value}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The worker is still starting.
    }
    await delay(250);
  }
  throw new Error(`Development server did not become ready:\n${logs.value}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(3_000).then(() => false),
  ]);
  if (!exited) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

test("authenticated users keep profiles, garments, and images isolated", { timeout: 60_000 }, async () => {
  const logs = { value: "" };
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--port", "4179", "--strictPort"],
    {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const collect = (chunk) => {
    logs.value = `${logs.value}${chunk}`.slice(-12_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const runId = crypto.randomUUID();
  const userA = { "oai-authenticated-user-email": `a-${runId}@example.com` };
  const userB = { "oai-authenticated-user-email": `b-${runId}@example.com` };

  try {
    await waitForServer(child, logs);

    const malformedProfile = await fetch(`${origin}/api/profile`, {
      method: "PUT",
      headers: { ...userA, "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformedProfile.status, 400);
    assert.deepEqual(await malformedProfile.json(), { error: "invalid JSON" });

    const nullProfile = await fetch(`${origin}/api/profile`, {
      method: "PUT",
      headers: { ...userA, "content-type": "application/json" },
      body: "null",
    });
    assert.equal(nullProfile.status, 400);

    const wrongProfileType = await fetch(`${origin}/api/profile`, {
      method: "PUT",
      headers: { ...userA, "content-type": "text/plain" },
      body: "hello",
    });
    assert.equal(wrongProfileType.status, 415);

    const wrongGarmentType = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: { ...userA, "content-type": "text/plain" },
      body: "hello",
    });
    assert.equal(wrongGarmentType.status, 415);

    const invalidGarment = garmentForm();
    invalidGarment.set("name", "x".repeat(121));
    invalidGarment.set("chest", "999");
    const invalidGarmentResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: invalidGarment,
    });
    assert.equal(invalidGarmentResponse.status, 400);

    const invalidMeasurement = garmentForm();
    invalidMeasurement.set("chest", "999");
    const invalidMeasurementResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: invalidMeasurement,
    });
    assert.equal(invalidMeasurementResponse.status, 400);

    const invalidUrl = garmentForm();
    invalidUrl.set("sourceUrl", "javascript:alert(1)");
    const invalidUrlResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: invalidUrl,
    });
    assert.equal(invalidUrlResponse.status, 400);

    const longUrl = garmentForm();
    longUrl.set("sourceUrl", `https://example.com/${"x".repeat(1000)}`);
    const longUrlResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: longUrl,
    });
    assert.equal(longUrlResponse.status, 400);

    const invalidImage = garmentForm();
    invalidImage.set("photo", new Blob(["<svg></svg>"], { type: "image/svg+xml" }), "unsafe.svg");
    const invalidImageResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: invalidImage,
    });
    assert.equal(invalidImageResponse.status, 400);

    const truncatedImage = garmentForm();
    truncatedImage.set("photo", new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "truncated.png");
    const truncatedImageResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: truncatedImage,
    });
    assert.equal(truncatedImageResponse.status, 400);

    const forgedPngBytes = new Uint8Array(40);
    forgedPngBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    forgedPngBytes.set([73, 69, 78, 68, 174, 66, 96, 130], 32);
    const forgedImage = garmentForm();
    forgedImage.set("photo", new Blob([forgedPngBytes], { type: "image/png" }), "forged.png");
    const forgedImageResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: forgedImage,
    });
    assert.equal(forgedImageResponse.status, 400);

    const profile = {
      height: 166,
      weight: 58,
      shoulder: 40,
      chest: 90,
      waist: 74,
      hips: 96,
      torso: 50,
      legs: 82,
      skinTone: "#d7a883",
      bodyShape: "hourglass",
    };
    const profileSave = await fetch(`${origin}/api/profile`, {
      method: "PUT",
      headers: { ...userA, "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    assert.equal(profileSave.status, 200, logs.value);
    const ownProfile = await fetch(`${origin}/api/profile`, { headers: userA }).then((response) => response.json());
    const otherProfile = await fetch(`${origin}/api/profile`, { headers: userB }).then((response) => response.json());
    assert.equal(ownProfile.profile.height, 166);
    assert.equal(otherProfile.profile, null);

    const form = garmentForm();
    form.set("id", "w-client-controlled");
    form.set("photo", new Blob([validPng], { type: "image/png" }), "tiny.png");
    const createResponse = await fetch(`${origin}/api/wardrobe`, { method: "POST", headers: userA, body: form });
    assert.equal(createResponse.status, 201, logs.value);
    const { item } = await createResponse.json();
    assert.match(item.id, /^w-[0-9a-f-]{36}$/);
    assert.notEqual(item.id, "w-client-controlled");

    const ownItems = await fetch(`${origin}/api/wardrobe`, { headers: userA }).then((response) => response.json());
    const otherItems = await fetch(`${origin}/api/wardrobe`, { headers: userB }).then((response) => response.json());
    assert.ok(ownItems.items.some((entry) => entry.id === item.id));
    assert.ok(!otherItems.items.some((entry) => entry.id === item.id));

    const ownImage = await fetch(`${origin}/api/wardrobe/image?id=${encodeURIComponent(item.id)}`, { headers: userA });
    const otherImage = await fetch(`${origin}/api/wardrobe/image?id=${encodeURIComponent(item.id)}`, { headers: userB });
    assert.equal(ownImage.status, 200);
    assert.equal(otherImage.status, 404);

    const deleteResponse = await fetch(`${origin}/api/wardrobe?id=${encodeURIComponent(item.id)}`, { method: "DELETE", headers: userA });
    assert.equal(deleteResponse.status, 204);
    const afterDelete = await fetch(`${origin}/api/wardrobe`, { headers: userA }).then((response) => response.json());
    assert.ok(!afterDelete.items.some((entry) => entry.id === item.id));
  } finally {
    await stopServer(child);
  }
});
