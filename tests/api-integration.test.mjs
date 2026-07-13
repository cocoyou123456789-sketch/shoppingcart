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

test("authenticated users keep profiles, garments, and images isolated", { timeout: 180_000 }, async () => {
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

    const oversizedRequest = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: { ...userA, "content-type": "multipart/form-data; boundary=oversized" },
      body: Buffer.alloc(7 * 1024 * 1024),
    });
    assert.equal(oversizedRequest.status, 413);

    let streamedBytes = 0;
    const chunkedOversizedBody = new ReadableStream({
      pull(controller) {
        if (streamedBytes >= 7 * 1024 * 1024) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(1024 * 1024);
        streamedBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const chunkedOversizedRequest = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: { ...userA, "content-type": "multipart/form-data; boundary=chunked-oversized" },
      body: chunkedOversizedBody,
      duplex: "half",
    });
    assert.equal(chunkedOversizedRequest.status, 413);

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

    const vp8xOnly = Buffer.alloc(38);
    vp8xOnly.write("RIFF", 0);
    vp8xOnly.writeUInt32LE(vp8xOnly.length - 8, 4);
    vp8xOnly.write("WEBP", 8);
    vp8xOnly.write("VP8X", 12);
    vp8xOnly.writeUInt32LE(10, 16);
    vp8xOnly.write("JUNK", 30);
    const forgedWebp = garmentForm();
    forgedWebp.set("photo", new Blob([vp8xOnly], { type: "image/webp" }), "header-only.webp");
    const forgedWebpResponse = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: userA,
      body: forgedWebp,
    });
    assert.equal(forgedWebpResponse.status, 400);

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
    const ownProfileResponse = await fetch(`${origin}/api/profile`, { headers: userA });
    const otherProfileResponse = await fetch(`${origin}/api/profile`, { headers: userB });
    assert.equal(ownProfileResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(otherProfileResponse.headers.get("cache-control"), "private, no-store");
    const ownProfile = await ownProfileResponse.json();
    const otherProfile = await otherProfileResponse.json();
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

    const ownItemsResponse = await fetch(`${origin}/api/wardrobe`, { headers: userA });
    const otherItemsResponse = await fetch(`${origin}/api/wardrobe`, { headers: userB });
    assert.equal(ownItemsResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(otherItemsResponse.headers.get("cache-control"), "private, no-store");
    const ownItems = await ownItemsResponse.json();
    const otherItems = await otherItemsResponse.json();
    assert.equal(ownItems.limit, 200);
    assert.ok(ownItems.items.some((entry) => entry.id === item.id));
    assert.ok(!otherItems.items.some((entry) => entry.id === item.id));

    const ownImage = await fetch(`${origin}/api/wardrobe/image?id=${encodeURIComponent(item.id)}`, { headers: userA });
    const otherImage = await fetch(`${origin}/api/wardrobe/image?id=${encodeURIComponent(item.id)}`, { headers: userB });
    assert.equal(ownImage.status, 200);
    assert.equal(otherImage.status, 404);
    assert.equal(ownImage.headers.get("cache-control"), "private, no-store");
    assert.equal(ownImage.headers.get("x-content-type-options"), "nosniff");

    const deleteResponse = await fetch(`${origin}/api/wardrobe?id=${encodeURIComponent(item.id)}`, { method: "DELETE", headers: userA });
    assert.equal(deleteResponse.status, 204);
    const afterDelete = await fetch(`${origin}/api/wardrobe`, { headers: userA }).then((response) => response.json());
    assert.ok(!afterDelete.items.some((entry) => entry.id === item.id));

    const otherProfileSave = await fetch(`${origin}/api/profile`, {
      method: "PUT",
      headers: { ...userB, "content-type": "application/json" },
      body: JSON.stringify({ ...profile, height: 174 }),
    });
    assert.equal(otherProfileSave.status, 200);
    const clearAForm = garmentForm();
    clearAForm.set("name", "待清除的 A 上衣");
    clearAForm.set("photo", new Blob([validPng], { type: "image/png" }), "a.png");
    const clearBForm = garmentForm();
    clearBForm.set("name", "应保留的 B 上衣");
    clearBForm.set("photo", new Blob([validPng], { type: "image/png" }), "b.png");
    const [clearACreate, clearBCreate] = await Promise.all([
      fetch(`${origin}/api/wardrobe`, { method: "POST", headers: userA, body: clearAForm }),
      fetch(`${origin}/api/wardrobe`, { method: "POST", headers: userB, body: clearBForm }),
    ]);
    assert.equal(clearACreate.status, 201, logs.value);
    assert.equal(clearBCreate.status, 201, logs.value);
    const clearAItem = (await clearACreate.json()).item;
    const clearBItem = (await clearBCreate.json()).item;

    const clearWardrobe = await fetch(`${origin}/api/wardrobe?scope=all`, {
      method: "DELETE",
      headers: userA,
    });
    const clearProfile = await fetch(`${origin}/api/profile`, {
      method: "DELETE",
      headers: userA,
    });
    assert.equal(clearWardrobe.status, 204, logs.value);
    assert.equal(clearProfile.status, 204, logs.value);
    assert.equal(
      (await fetch(`${origin}/api/wardrobe`, { headers: userA }).then((response) => response.json())).items.length,
      0,
    );
    assert.equal(
      (await fetch(`${origin}/api/profile`, { headers: userA }).then((response) => response.json())).profile,
      null,
    );
    assert.equal(
      (await fetch(`${origin}/api/wardrobe/image?id=${encodeURIComponent(clearAItem.id)}`, { headers: userA })).status,
      404,
    );
    assert.equal(
      (await fetch(`${origin}/api/wardrobe/image?id=${encodeURIComponent(clearBItem.id)}`, { headers: userB })).status,
      200,
    );
    assert.equal(
      (await fetch(`${origin}/api/profile`, { headers: userB }).then((response) => response.json())).profile.height,
      174,
    );
    assert.equal(
      (await fetch(`${origin}/api/wardrobe?scope=all`, { method: "DELETE", headers: userA })).status,
      204,
    );
    assert.equal(
      (await fetch(`${origin}/api/profile`, { method: "DELETE", headers: userA })).status,
      204,
    );

    const quotaUser = { "oai-authenticated-user-email": `quota-${runId}@example.com` };
    for (let start = 0; start < 199; start += 20) {
      const count = Math.min(20, 199 - start);
      const responses = await Promise.all(
        Array.from({ length: count }, (_, index) => {
          const quotaForm = garmentForm();
          quotaForm.set("name", `配额衣物 ${start + index + 1}`);
          return fetch(`${origin}/api/wardrobe`, {
            method: "POST",
            headers: quotaUser,
            body: quotaForm,
          });
        }),
      );
      assert.ok(responses.every((response) => response.status === 201), logs.value);
    }
    const finalResponses = await Promise.all(
      ["并发第 200 件", "并发第 201 件"].map((name) => {
        const quotaForm = garmentForm();
        quotaForm.set("name", name);
        return fetch(`${origin}/api/wardrobe`, {
          method: "POST",
          headers: quotaUser,
          body: quotaForm,
        });
      }),
    );
    assert.deepEqual(finalResponses.map((response) => response.status).sort(), [201, 409]);
    const quotaItems = await fetch(`${origin}/api/wardrobe`, { headers: quotaUser }).then((response) => response.json());
    assert.equal(quotaItems.items.length, 200);
    const overLimit = await fetch(`${origin}/api/wardrobe`, {
      method: "POST",
      headers: quotaUser,
      body: garmentForm(),
    });
    assert.equal(overLimit.status, 409);
    assert.equal(
      (await fetch(`${origin}/api/wardrobe?scope=all`, { method: "DELETE", headers: quotaUser })).status,
      204,
    );
  } finally {
    await stopServer(child);
  }
});
