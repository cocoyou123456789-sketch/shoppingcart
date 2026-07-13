import { getRawDb, getWardrobeImages } from "../../../../db";

function ownerFor(request: Request) {
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "private-preview";
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return new Response("Missing image id", { status: 400 });
    const row = await (await getRawDb())
      .prepare("SELECT image_key, image_type FROM wardrobe_items WHERE owner_email = ? AND id = ?")
      .bind(ownerFor(request), id)
      .first<{ image_key: string | null; image_type: string | null }>();
    if (!row?.image_key) return new Response("Image not found", { status: 404 });
    const object = await (await getWardrobeImages()).get(row.image_key);
    if (!object) return new Response("Image not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", row.image_type || headers.get("content-type") || "application/octet-stream");
    headers.set("cache-control", "private, max-age=3600");
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  } catch {
    return new Response("Image unavailable", { status: 404 });
  }
}
