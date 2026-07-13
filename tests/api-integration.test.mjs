import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const origin = "http://localhost:4179";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

    const form = new FormData();
    form.set("id", "w-client-controlled");
    form.set("name", "隔离测试上衣");
    form.set("category", "上装");
    form.set("color", "#d7dff0");
    form.set("colorName", "雾霾蓝");
    form.set("size", "M");
    form.set("season", "四季");
    form.set("style", "轻松");
    form.set("confidence", "中");
    form.set("photo", new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "tiny.png");
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
