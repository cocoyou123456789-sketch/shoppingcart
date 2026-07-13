const CLIENT_WARDROBE_ID = /^w-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientWardrobeId(value) {
  return typeof value === "string" && CLIENT_WARDROBE_ID.test(value);
}

export async function wardrobeCloudId(owner, clientId) {
  if (typeof owner !== "string" || !owner || !isClientWardrobeId(clientId)) return null;
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${owner.trim().toLowerCase()}\0${clientId.toLowerCase()}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `w-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
