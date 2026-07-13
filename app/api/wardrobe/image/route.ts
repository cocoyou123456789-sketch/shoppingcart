import { getRawDb, getWardrobeImages } from "../../../../db";
import { requireExpectedOwner } from "../../../lib/request-owner";

function matchesIfNoneMatch(header: string | null, etag: string) {
  if (!header) return false;
  const normalizedEtag = etag.replace(/^W\//, "");
  return header.split(",").some((candidate) => {
    const normalizedCandidate = candidate.trim();
    return normalizedCandidate === "*" || normalizedCandidate.replace(/^W\//, "") === normalizedEtag;
  });
}

export async function GET(request: Request) {
  try {
    const ownership = await requireExpectedOwner(request, { allowQuery: true });
    if ("response" in ownership) return ownership.response;
    const { owner } = ownership;
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return new Response("Missing image id", { status: 400 });
    const row = await (await getRawDb())
      .prepare("SELECT image_key, image_type FROM wardrobe_items WHERE owner_email = ? AND id = ?")
      .bind(owner, id)
      .first<{ image_key: string | null; image_type: string | null }>();
    if (!row?.image_key) return new Response("Image not found", { status: 404 });
    const object = await (await getWardrobeImages()).get(row.image_key);
    if (!object) return new Response("Image not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", row.image_type || headers.get("content-type") || "application/octet-stream");
    headers.set("cache-control", "private, no-cache");
    headers.set("x-content-type-options", "nosniff");
    headers.set("etag", object.httpEtag);
    if (matchesIfNoneMatch(request.headers.get("if-none-match"), object.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch {
    return new Response("Image temporarily unavailable", { status: 503 });
  }
}
