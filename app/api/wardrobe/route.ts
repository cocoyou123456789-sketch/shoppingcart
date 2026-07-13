import { getRawDb, getWardrobeImages } from "../../../db";
import { ownerForRequest, unauthorizedJson } from "../../lib/request-owner";

const ALLOWED_CATEGORIES = new Set(["上装", "下装", "连衣裙", "外套", "鞋履", "配饰"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) {
    entry = (entry >>> 1) ^ (entry & 1 ? 0xedb88320 : 0);
  }
  return entry >>> 0;
});

function measurement(value: FormDataEntryValue | null, min: number, max: number) {
  if (typeof value !== "string" || value.trim() === "") return { ok: true, value: null };
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? { ok: true, value: parsed }
    : { ok: false, value: null };
}

function validSourceUrl(value: string) {
  if (!value) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function bytesLabel(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function crc32(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isStructuredPng(bytes: Uint8Array, view: DataView) {
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return false;
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;
    const label = bytesLabel(bytes, offset + 4, 4);
    const storedCrc = view.getUint32(offset + 8 + length);
    if (crc32(bytes, offset + 4, offset + 8 + length) !== storedCrc) return false;
    if (!sawHeader) {
      if (label !== "IHDR" || length !== 13) return false;
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (!width || !height || width > 12_000 || height > 12_000 || width * height > MAX_IMAGE_PIXELS) return false;
      sawHeader = true;
    } else if (label === "IDAT") {
      sawImageData = true;
    } else if (label === "IEND") {
      return length === 0 && sawImageData && chunkEnd === bytes.length;
    }
    offset = chunkEnd;
  }
  return false;
}

function isStructuredJpeg(bytes: Uint8Array, view: DataView) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  let offset = 2;
  let sawFrame = false;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = length >= 8 ? view.getUint16(offset + 3) : 0;
      const width = length >= 8 ? view.getUint16(offset + 5) : 0;
      if (!width || !height || width * height > MAX_IMAGE_PIXELS) return false;
      sawFrame = true;
    }
    if (marker === 0xda) return sawFrame && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    offset += length;
  }
  return false;
}

function isStructuredWebp(bytes: Uint8Array, view: DataView) {
  if (bytesLabel(bytes, 0, 4) !== "RIFF" || bytesLabel(bytes, 8, 4) !== "WEBP" || view.getUint32(4, true) + 8 !== bytes.length) return false;
  let offset = 12;
  let sawImageChunk = false;
  while (offset + 8 <= bytes.length) {
    const label = bytesLabel(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + length;
    if (chunkEnd > bytes.length) return false;
    if (label === "VP8 " && length >= 10) {
      sawImageChunk = bytes[offset + 11] === 0x9d && bytes[offset + 12] === 0x01 && bytes[offset + 13] === 0x2a;
    } else if (label === "VP8L" && length >= 5) {
      sawImageChunk = bytes[offset + 8] === 0x2f;
    } else if (label === "VP8X" && length === 10) {
      sawImageChunk = true;
    }
    offset = chunkEnd + (length % 2);
  }
  return sawImageChunk && offset === bytes.length;
}

async function hasMatchingImageSignature(file: File) {
  if (file.size < 32) return false;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const type = file.type.toLowerCase();
  if (type === "image/png") return isStructuredPng(bytes, view);
  if (type === "image/jpeg") return isStructuredJpeg(bytes, view);
  if (type === "image/webp") return isStructuredWebp(bytes, view);
  return false;
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

async function cleanupPendingImages(db: D1Database) {
  try {
    await db.prepare(`DELETE FROM wardrobe_image_cleanup
      WHERE image_key IN (SELECT image_key FROM wardrobe_items WHERE image_key IS NOT NULL)`).run();
    const pending = await db
      .prepare(`SELECT image_key FROM wardrobe_image_cleanup
        WHERE created_at <= datetime('now', '-10 minutes')
        ORDER BY created_at LIMIT 4`)
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
    await cleanupPendingImages(db);
    const result = await db
      .prepare("SELECT * FROM wardrobe_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 200")
      .bind(owner)
      .all<Record<string, unknown>>();
    return Response.json({ items: result.results.map(rowToItem) });
  } catch {
    return Response.json({ error: "wardrobe temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      return Response.json({ error: "multipart form data is required" }, { status: 415 });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "invalid form data" }, { status: 400 });
    }
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "");
    const color = String(form.get("color") ?? "#d7dff0");
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    if (name.length > 120) return Response.json({ error: "name is too long" }, { status: 400 });
    if (!ALLOWED_CATEGORIES.has(category)) return Response.json({ error: "invalid category" }, { status: 400 });
    if (!/^#[0-9a-f]{6}$/i.test(color)) return Response.json({ error: "invalid color" }, { status: 400 });

    const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
    if (sourceUrl.length > 1000) return Response.json({ error: "source URL is too long" }, { status: 400 });
    if (!validSourceUrl(sourceUrl)) return Response.json({ error: "invalid source URL" }, { status: 400 });
    const measurements = {
      chest: measurement(form.get("chest"), 20, 250),
      waist: measurement(form.get("waist"), 20, 250),
      hips: measurement(form.get("hips"), 20, 250),
      length: measurement(form.get("length"), 10, 300),
    };
    if (Object.values(measurements).some((entry) => !entry.ok)) {
      return Response.json({ error: "invalid garment measurement" }, { status: 400 });
    }

    const db = await getRawDb();
    await ensureWardrobeTables(db);
    await cleanupPendingImages(db);
    const id = `w-${crypto.randomUUID()}`;
    const photo = form.get("photo");
    let imageKey: string | null = null;
    let imageType: string | null = null;

    if (photo instanceof File && photo.size > 0) {
      const validatedImageType = photo.type.toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(validatedImageType) || photo.size > MAX_IMAGE_BYTES || !(await hasMatchingImageSignature(photo))) {
        return Response.json({ error: "photo must be a valid JPEG, PNG, or WebP smaller than 6 MB" }, { status: 400 });
      }
      imageType = validatedImageType;
      imageKey = `wardrobe/${encodeURIComponent(owner)}/${crypto.randomUUID()}`;
      await db.prepare("INSERT OR REPLACE INTO wardrobe_image_cleanup (image_key, owner_email) VALUES (?, ?)")
        .bind(imageKey, owner)
        .run();
      await (await getWardrobeImages()).put(imageKey, photo.stream(), {
        httpMetadata: { contentType: validatedImageType },
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
      sourceUrl: sourceUrl || null,
      imageKey,
      imageType,
      season: String(form.get("season") ?? "四季").slice(0, 30),
      style: String(form.get("style") ?? "日常").slice(0, 30),
      chest: measurements.chest.value,
      waist: measurements.waist.value,
      hips: measurements.hips.value,
      length: measurements.length.value,
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
  } catch {
    return Response.json({ error: "wardrobe temporarily unavailable" }, { status: 503 });
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
    await cleanupPendingImages(db);
    const found = await db
      .prepare("SELECT image_key FROM wardrobe_items WHERE owner_email = ? AND id = ?")
      .bind(owner, id)
      .first<{ image_key: string | null }>();
    if (found?.image_key) {
      try {
        await (await getWardrobeImages()).delete(found.image_key);
      } catch {
        return Response.json({ error: "image deletion temporarily unavailable" }, { status: 503 });
      }
    }
    await db.prepare("DELETE FROM wardrobe_items WHERE owner_email = ? AND id = ?").bind(owner, id).run();
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "wardrobe temporarily unavailable" }, { status: 503 });
  }
}
