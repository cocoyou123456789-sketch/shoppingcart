import { getRawDb, getWardrobeImages } from "../../../db";
import { ownerForRequest, unauthorizedJson } from "../../lib/request-owner";

const ALLOWED_CATEGORIES = new Set(["上装", "下装", "连衣裙", "外套", "鞋履", "配饰"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function numberOrNull(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureWardrobeTables(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS wardrobe_items (
      id TEXT PRIMARY KEY NOT NULL,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      color TEXT NOT NULL,
      color_name TEXT NOT NULL,
      size TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '我的衣服',
      source_url TEXT,
      image_key TEXT,
      image_type TEXT,
      season TEXT NOT NULL DEFAULT '四季',
      style TEXT NOT NULL DEFAULT '日常',
      chest REAL,
      waist REAL,
      hips REAL,
      length REAL,
      confidence TEXT NOT NULL DEFAULT '待确认',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS wardrobe_owner_id_idx ON wardrobe_items (owner_email, id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS wardrobe_image_cleanup (
      image_key TEXT PRIMARY KEY NOT NULL,
      owner_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS wardrobe_cleanup_owner_idx ON wardrobe_image_cleanup (owner_email)"),
  ]);
}

async function cleanupPendingImages(db: D1Database, owner: string) {
  try {
    await db.prepare(`DELETE FROM wardrobe_image_cleanup
      WHERE image_key IN (SELECT image_key FROM wardrobe_items WHERE image_key IS NOT NULL)`).run();
    const pending = await db
      .prepare("SELECT image_key FROM wardrobe_image_cleanup WHERE owner_email = ? ORDER BY created_at LIMIT 4")
      .bind(owner)
      .all<{ image_key: string }>();
    if (!pending.results.length) return;
    const images = await getWardrobeImages();
    for (const row of pending.results) {
      try {
        await images.delete(row.image_key);
        await db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?").bind(row.image_key).run();
      } catch {
        // Keep the outbox row so a later request can safely retry cleanup.
      }
    }
  } catch {
    // Cleanup should never block the user's wardrobe request.
  }
}

function rowToItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    colorName: row.color_name,
    size: row.size,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    imageUrl: row.image_key ? `/api/wardrobe/image?id=${encodeURIComponent(String(row.id))}` : undefined,
    season: row.season,
    style: row.style,
    chest: row.chest ?? undefined,
    waist: row.waist ?? undefined,
    hips: row.hips ?? undefined,
    length: row.length ?? undefined,
    confidence: row.confidence,
  };
}

export async function GET(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    const db = await getRawDb();
    await ensureWardrobeTables(db);
    await cleanupPendingImages(db, owner);
    const result = await db
      .prepare("SELECT * FROM wardrobe_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 200")
      .bind(owner)
      .all<Record<string, unknown>>();
    return Response.json({ items: result.results.map(rowToItem) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load wardrobe" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "");
    const color = String(form.get("color") ?? "#d7dff0");
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    if (!ALLOWED_CATEGORIES.has(category)) return Response.json({ error: "invalid category" }, { status: 400 });
    if (!/^#[0-9a-f]{6}$/i.test(color)) return Response.json({ error: "invalid color" }, { status: 400 });

    const db = await getRawDb();
    await ensureWardrobeTables(db);
    await cleanupPendingImages(db, owner);
    const id = `w-${crypto.randomUUID()}`;
    const photo = form.get("photo");
    let imageKey: string | null = null;
    let imageType: string | null = null;

    if (photo instanceof File && photo.size > 0) {
      if (!photo.type.startsWith("image/") || photo.size > MAX_IMAGE_BYTES) {
        return Response.json({ error: "photo must be an image smaller than 6 MB" }, { status: 400 });
      }
      imageType = photo.type;
      imageKey = `wardrobe/${encodeURIComponent(owner)}/${crypto.randomUUID()}`;
      await db.prepare("INSERT OR REPLACE INTO wardrobe_image_cleanup (image_key, owner_email) VALUES (?, ?)")
        .bind(imageKey, owner)
        .run();
      await (await getWardrobeImages()).put(imageKey, photo.stream(), {
        httpMetadata: { contentType: photo.type },
        customMetadata: { owner, itemId: id },
      });
    }

    const values = {
      id,
      owner,
      name,
      category,
      color,
      colorName: String(form.get("colorName") ?? "自定义颜色").slice(0, 40),
      size: String(form.get("size") ?? "").slice(0, 30),
      source: "我的衣服",
      sourceUrl: String(form.get("sourceUrl") ?? "").slice(0, 1000) || null,
      imageKey,
      imageType,
      season: String(form.get("season") ?? "四季").slice(0, 30),
      style: String(form.get("style") ?? "日常").slice(0, 30),
      chest: numberOrNull(form.get("chest")),
      waist: numberOrNull(form.get("waist")),
      hips: numberOrNull(form.get("hips")),
      length: numberOrNull(form.get("length")),
      confidence: String(form.get("confidence") ?? "待确认").slice(0, 12),
    };

    try {
      await db
        .prepare(`INSERT INTO wardrobe_items (
          id, owner_email, name, category, color, color_name, size, source, source_url,
          image_key, image_type, season, style, chest, waist, hips, length, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          values.id, values.owner, values.name, values.category, values.color, values.colorName,
          values.size, values.source, values.sourceUrl, values.imageKey, values.imageType,
          values.season, values.style, values.chest, values.waist, values.hips, values.length,
          values.confidence,
        )
        .run();
    } catch (error) {
      if (imageKey) {
        try {
          await (await getWardrobeImages()).delete(imageKey);
          await db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?").bind(imageKey).run();
        } catch {
          // The durable cleanup row remains so a later request can retry safely.
        }
      }
      throw error;
    }
    if (imageKey) {
      try {
        await db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?").bind(imageKey).run();
      } catch {
        // A later cleanup pass removes rows that now reference a saved garment.
      }
    }

    return Response.json({
      item: {
        id: values.id,
        name: values.name,
        category: values.category,
        color: values.color,
        colorName: values.colorName,
        size: values.size,
        source: values.source,
        sourceUrl: values.sourceUrl ?? undefined,
        imageUrl: values.imageKey ? `/api/wardrobe/image?id=${encodeURIComponent(values.id)}` : undefined,
        season: values.season,
        style: values.style,
        chest: values.chest ?? undefined,
        waist: values.waist ?? undefined,
        hips: values.hips ?? undefined,
        length: values.length ?? undefined,
        confidence: values.confidence,
      },
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save garment" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    const db = await getRawDb();
    await ensureWardrobeTables(db);
    await cleanupPendingImages(db, owner);
    const found = await db
      .prepare("SELECT image_key FROM wardrobe_items WHERE owner_email = ? AND id = ?")
      .bind(owner, id)
      .first<{ image_key: string | null }>();
    if (found?.image_key) await (await getWardrobeImages()).delete(found.image_key);
    await db.prepare("DELETE FROM wardrobe_items WHERE owner_email = ? AND id = ?").bind(owner, id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete garment" }, { status: 500 });
  }
}
