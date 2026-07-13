import assert from "node:assert/strict";
import test from "node:test";
import { replaceRuntimeAvatar } from "../app/lib/avatar-runtime.mjs";

test("avatar updates preserve the renderer and dispose only the replaced model", () => {
  const calls = [];
  const renderer = { shadowMap: { needsUpdate: false } };
  const oldAvatar = { id: "old" };
  const nextAvatar = { id: "next" };
  const runtime = {
    renderer,
    avatar: oldAvatar,
    scene: {
      add(value) { calls.push(["add", value.id]); },
      remove(value) { calls.push(["remove", value.id]); },
    },
  };

  const removed = replaceRuntimeAvatar(runtime, nextAvatar, (value) => {
    calls.push(["dispose", value.id]);
  });

  assert.equal(runtime.renderer, renderer);
  assert.equal(runtime.avatar, nextAvatar);
  assert.equal(removed, oldAvatar);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.deepEqual(calls, [
    ["add", "next"],
    ["remove", "old"],
    ["dispose", "old"],
  ]);
});
