export function replaceRuntimeAvatar(runtime, nextAvatar, disposeAvatar) {
  const previousAvatar = runtime.avatar;
  runtime.scene.add(nextAvatar);
  runtime.avatar = nextAvatar;
  runtime.scene.remove(previousAvatar);
  disposeAvatar(previousAvatar);
  runtime.renderer.shadowMap.needsUpdate = true;
  return previousAvatar;
}
