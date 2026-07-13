import { getRawDb, getWardrobeImages } from "../../../db";
import {
  currentDataGeneration,
  dataGenerationHeaders,
  ensureDataGenerationTable,
  requestDataGeneration,
  staleDataGenerationResponse,
} from "../../lib/data-generation";
import {
  EXPECTED_OWNER_QUERY,
  requireExpectedOwner,
} from "../../lib/request-owner";
import {
  MAX_GARMENT_NAME_LENGTH,
  MAX_GARMENT_SOURCE_URL_LENGTH,
  isValidGarmentSourceUrl,
} from "../../lib/garment-form-options";
import { isClientWardrobeId, wardrobeCloudId } from "../../lib/wardrobe-id.mjs";

const ALLOWED_CATEGORIES = new Set(["上装", "下装", "连衣裙", "外套", "鞋履", "配饰"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 512 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_WARDROBE_ITEMS = 200;
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

async function requestWithLimitedBody(request: Request, limit: number) {
  if (!request.body) return { request, tooLarge: false } as const;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel("request body limit exceeded");
        } catch {
          // Returning 413 is still safe if the upstream stream cannot be cancelled.
        }
        return { request: null, tooLarge: true } as const;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    }),
    tooLarge: false,
  } as const;
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
      sawImageData ||= length > 0;
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
    if (marker === 0xda) {
      const scanStart = offset + length;
      return sawFrame && scanStart < bytes.length - 2 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    }
    offset += length;
  }
  return false;
}

function validImageDimensions(width: number, height: number) {
  return Boolean(width && height && width <= 12_000 && height <= 12_000 && width * height <= MAX_IMAGE_PIXELS);
}

function uint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function validWebpImageChunk(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  label: string,
  length: number,
) {
  if (label === "VP8 " && length > 10) {
    if (bytes[offset + 11] !== 0x9d || bytes[offset + 12] !== 0x01 || bytes[offset + 13] !== 0x2a) return false;
    const width = view.getUint16(offset + 14, true) & 0x3fff;
    const height = view.getUint16(offset + 16, true) & 0x3fff;
    return validImageDimensions(width, height);
  }
  if (label === "VP8L" && length > 5 && bytes[offset + 8] === 0x2f) {
    const dimensions = view.getUint32(offset + 9, true);
    const width = (dimensions & 0x3fff) + 1;
    const height = ((dimensions >>> 14) & 0x3fff) + 1;
    return validImageDimensions(width, height);
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
    if (label === "VP8 " || label === "VP8L") {
      sawImageChunk ||= validWebpImageChunk(bytes, view, offset, label, length);
    } else if (label === "VP8X" && length === 10) {
      const width = uint24LittleEndian(bytes, offset + 12) + 1;
      const height = uint24LittleEndian(bytes, offset + 15) + 1;
      if (!validImageDimensions(width, height)) return false;
    } else if (label === "ANMF" && length >= 24) {
      const nestedOffset = offset + 24;
      const nestedLabel = bytesLabel(bytes, nestedOffset, 4);
      const nestedLength = view.getUint32(nestedOffset + 4, true);
      if (nestedOffset + 8 + nestedLength > chunkEnd) return false;
      sawImageChunk ||= validWebpImageChunk(
        bytes,
        view,
        nestedOffset,
        nestedLabel,
        nestedLength,
      );
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

export async function ensureWardrobeTables(db: D1Database) {
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
    db.prepare(`CREATE TABLE IF NOT EXISTS wardrobe_sync_keys (
      owner_email TEXT NOT NULL,
      client_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_email, client_id)
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS wardrobe_sync_item_idx ON wardrobe_sync_keys (owner_email, item_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS personal_data_clear_images (
      owner_email TEXT NOT NULL,
      request_id TEXT NOT NULL,
      image_key TEXT NOT NULL,
      PRIMARY KEY (owner_email, request_id, image_key)
    )`),
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
        await db.batch([
          db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?").bind(row.image_key),
          db.prepare("DELETE FROM personal_data_clear_images WHERE image_key = ?").bind(row.image_key),
        ]);
      } catch {
        // Keep the outbox row so a later request can safely retry cleanup.
      }
    }
  } catch {
    // Cleanup should never block the user's wardrobe request.
  }
}

function privateImageUrl(id: unknown, expectedOwner: string) {
  const params = new URLSearchParams({
    id: String(id),
    [EXPECTED_OWNER_QUERY]: expectedOwner,
  });
  return `/api/wardrobe/image?${params}`;
}

function rowToItem(row: Record<string, unknown>, expectedOwner: string) {
  return {
    id: row.id,
    clientId: row.client_id ?? undefined,
    name: row.name,
    category: row.category,
    color: row.color,
    colorName: row.color_name,
    size: row.size,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    imageUrl: row.image_key ? privateImageUrl(row.id, expectedOwner) : undefined,
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
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner, expectedOwner } = ownership;
    const db = await getRawDb();
    await ensureWardrobeTables(db);
    const generation = await currentDataGeneration(db, owner);
    await cleanupPendingImages(db);
    const result = await db
      .prepare(`SELECT wardrobe_items.*, wardrobe_sync_keys.client_id AS client_id
        FROM wardrobe_items
        LEFT JOIN wardrobe_sync_keys
          ON wardrobe_sync_keys.owner_email = wardrobe_items.owner_email
          AND wardrobe_sync_keys.item_id = wardrobe_items.id
          AND wardrobe_sync_keys.state = 'active'
        WHERE wardrobe_items.owner_email = ?
        ORDER BY wardrobe_items.created_at DESC`)
      .bind(owner)
      .all<Record<string, unknown>>();
    return Response.json(
      {
        items: result.results.map((row) => rowToItem(row, expectedOwner)),
        limit: MAX_WARDROBE_ITEMS,
        generation,
      },
      { headers: dataGenerationHeaders(generation) },
    );
  } catch {
    return Response.json({ error: "wardrobe temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner, expectedOwner } = ownership;
    if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      return Response.json({ error: "multipart form data is required" }, { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
      return Response.json({ error: "request is too large" }, { status: 413 });
    }
    let limitedRequest: Request;
    try {
      const limited = await requestWithLimitedBody(request, MAX_MULTIPART_BYTES);
      if (limited.tooLarge) {
        return Response.json({ error: "request is too large" }, { status: 413 });
      }
      limitedRequest = limited.request;
    } catch {
      return Response.json({ error: "invalid form data" }, { status: 400 });
    }
    let form: FormData;
    try {
      form = await limitedRequest.formData();
    } catch {
      return Response.json({ error: "invalid form data" }, { status: 400 });
    }
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "");
    const color = String(form.get("color") ?? "#d7dff0");
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    if (name.length > MAX_GARMENT_NAME_LENGTH) return Response.json({ error: "name is too long" }, { status: 400 });
    if (!ALLOWED_CATEGORIES.has(category)) return Response.json({ error: "invalid category" }, { status: 400 });
    if (!/^#[0-9a-f]{6}$/i.test(color)) return Response.json({ error: "invalid color" }, { status: 400 });

    const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
    if (sourceUrl.length > MAX_GARMENT_SOURCE_URL_LENGTH) return Response.json({ error: "source URL is too long" }, { status: 400 });
    if (!isValidGarmentSourceUrl(sourceUrl)) return Response.json({ error: "invalid source URL" }, { status: 400 });
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
    await ensureDataGenerationTable(db);
    await cleanupPendingImages(db);
    const requestedGeneration = requestDataGeneration(request);
    const activeGeneration = await currentDataGeneration(db, owner);
    if (!requestedGeneration || requestedGeneration !== activeGeneration) {
      return staleDataGenerationResponse(activeGeneration);
    }
    const requestedClientId = String(form.get("id") ?? "").trim();
    const clientId = isClientWardrobeId(requestedClientId)
      ? requestedClientId.toLowerCase()
      : null;
    const id = (clientId ? await wardrobeCloudId(owner, clientId) : null) ?? `w-${crypto.randomUUID()}`;
    if (clientId) {
      const syncKey = await db
        .prepare("SELECT item_id, state FROM wardrobe_sync_keys WHERE owner_email = ? AND client_id = ?")
        .bind(owner, clientId)
        .first<{ item_id: string; state: string }>();
      if (syncKey?.state === "deleted") {
        return Response.json(
          { error: "this local wardrobe item was deleted" },
          { status: 410, headers: dataGenerationHeaders(activeGeneration) },
        );
      }
      if (syncKey?.state === "active") {
        const existing = await db
          .prepare("SELECT * FROM wardrobe_items WHERE owner_email = ? AND id = ?")
          .bind(owner, syncKey.item_id)
          .first<Record<string, unknown>>();
        if (existing) {
          return Response.json(
            {
              item: rowToItem({ ...existing, client_id: clientId }, expectedOwner),
              replayed: true,
            },
            { status: 200, headers: dataGenerationHeaders(activeGeneration) },
          );
        }
      }
    }
    const count = await db
      .prepare("SELECT COUNT(*) AS total FROM wardrobe_items WHERE owner_email = ?")
      .bind(owner)
      .first<{ total: number }>();
    if (Number(count?.total ?? 0) >= MAX_WARDROBE_ITEMS) {
      return Response.json(
        { error: `wardrobe limit reached (${MAX_WARDROBE_ITEMS})`, limit: MAX_WARDROBE_ITEMS },
        { status: 409, headers: dataGenerationHeaders(activeGeneration) },
      );
    }
    const photo = form.get("photo");
    let imageKey: string | null = null;
    let imageType: string | null = null;

    if (photo instanceof File) {
      if (photo.size === 0) {
        return Response.json({ error: "photo must not be empty" }, { status: 400 });
      }
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
      let insertResult: D1Result<unknown>;
      if (clientId) {
        const batchResults = await db.batch([
          db.prepare(`INSERT OR IGNORE INTO wardrobe_sync_keys (
            owner_email, client_id, item_id, state, created_at, updated_at
          ) SELECT ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          WHERE (SELECT COUNT(*) FROM wardrobe_items WHERE owner_email = ?) < ?
            AND COALESCE(
              (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
              'initial'
            ) = ?`)
            .bind(owner, clientId, id, owner, MAX_WARDROBE_ITEMS, owner, requestedGeneration),
          db.prepare(`INSERT OR IGNORE INTO wardrobe_items (
            id, owner_email, name, category, color, color_name, size, source, source_url,
            image_key, image_type, season, style, chest, waist, hips, length, confidence
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM wardrobe_sync_keys
            WHERE owner_email = ? AND client_id = ? AND item_id = ? AND state = 'active'
          ) AND COALESCE(
            (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
            'initial'
          ) = ?`)
            .bind(
              values.id, values.owner, values.name, values.category, values.color, values.colorName,
              values.size, values.source, values.sourceUrl, values.imageKey, values.imageType,
              values.season, values.style, values.chest, values.waist, values.hips, values.length,
              values.confidence, owner, clientId, id, owner, requestedGeneration,
            ),
        ]);
        insertResult = batchResults[1];
      } else {
        insertResult = await db
          .prepare(`INSERT INTO wardrobe_items (
            id, owner_email, name, category, color, color_name, size, source, source_url,
            image_key, image_type, season, style, chest, waist, hips, length, confidence
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM wardrobe_items WHERE owner_email = ?) < ?
            AND COALESCE(
              (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
              'initial'
            ) = ?`)
          .bind(
            values.id, values.owner, values.name, values.category, values.color, values.colorName,
            values.size, values.source, values.sourceUrl, values.imageKey, values.imageType,
            values.season, values.style, values.chest, values.waist, values.hips, values.length,
            values.confidence, owner, MAX_WARDROBE_ITEMS, owner, requestedGeneration,
          )
          .run();
      }
      if (insertResult.meta.changes !== 1) {
        if (imageKey) {
          try {
            await (await getWardrobeImages()).delete(imageKey);
            await db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?").bind(imageKey).run();
          } catch {
            // The durable cleanup row remains so a later request can safely retry.
          }
        }
        const latestGeneration = await currentDataGeneration(db, owner);
        if (latestGeneration !== requestedGeneration) {
          return staleDataGenerationResponse(latestGeneration);
        }
        if (clientId) {
          const syncKey = await db
            .prepare("SELECT item_id, state FROM wardrobe_sync_keys WHERE owner_email = ? AND client_id = ?")
            .bind(owner, clientId)
            .first<{ item_id: string; state: string }>();
          if (syncKey?.state === "deleted") {
            return Response.json(
              { error: "this local wardrobe item was deleted" },
              { status: 410, headers: dataGenerationHeaders(latestGeneration) },
            );
          }
          if (syncKey?.state === "active") {
            const replay = await db
              .prepare("SELECT * FROM wardrobe_items WHERE owner_email = ? AND id = ?")
              .bind(owner, syncKey.item_id)
              .first<Record<string, unknown>>();
            if (replay) {
              return Response.json(
                {
                  item: rowToItem({ ...replay, client_id: clientId }, expectedOwner),
                  replayed: true,
                },
                { status: 200, headers: dataGenerationHeaders(latestGeneration) },
              );
            }
          }
        }
        return Response.json(
          { error: `wardrobe limit reached (${MAX_WARDROBE_ITEMS})`, limit: MAX_WARDROBE_ITEMS },
          { status: 409, headers: dataGenerationHeaders(latestGeneration) },
        );
      }
    } catch (error) {
      if (imageKey) {
        try {
          await (await getWardrobeImages()).delete(imageKey);
          await db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?").bind(imageKey).run();
        } catch {
          // The durable cleanup row remains so a later request can retry safely.
        }
      }
      const replay = await db
        .prepare("SELECT * FROM wardrobe_items WHERE owner_email = ? AND id = ?")
        .bind(owner, id)
        .first<Record<string, unknown>>();
      if (replay) {
        return Response.json(
          {
            item: rowToItem({ ...replay, client_id: clientId }, expectedOwner),
            replayed: true,
          },
          { status: 200, headers: dataGenerationHeaders(requestedGeneration) },
        );
      }
      throw error;
    }
    if (imageKey) {
      try {
        await db.prepare(`DELETE FROM wardrobe_image_cleanup
          WHERE image_key = ? AND EXISTS (
            SELECT 1 FROM wardrobe_items
            WHERE owner_email = ? AND id = ? AND image_key = ?
          )`).bind(imageKey, owner, id, imageKey).run();
      } catch {
        // A later cleanup pass removes rows that now reference a saved garment.
      }
    }

    return Response.json({
      item: {
        id: values.id,
        clientId: clientId ?? undefined,
        name: values.name,
        category: values.category,
        color: values.color,
        colorName: values.colorName,
        size: values.size,
        source: values.source,
        sourceUrl: values.sourceUrl ?? undefined,
        imageUrl: values.imageKey ? privateImageUrl(values.id, expectedOwner) : undefined,
        season: values.season,
        style: values.style,
        chest: values.chest ?? undefined,
        waist: values.waist ?? undefined,
        hips: values.hips ?? undefined,
        length: values.length ?? undefined,
        confidence: values.confidence,
      },
    }, { status: 201, headers: dataGenerationHeaders(requestedGeneration) });
  } catch {
    return Response.json({ error: "wardrobe temporarily unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner } = ownership;
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get("id")?.trim();
    const requestedClientId = searchParams.get("clientId")?.trim();
    const clientId = requestedClientId && isClientWardrobeId(requestedClientId)
      ? requestedClientId.toLowerCase()
      : null;
    const deleteAll = searchParams.get("scope") === "all";
    if (requestedClientId && !clientId) {
      return Response.json({ error: "invalid clientId" }, { status: 400 });
    }
    if (!id && !clientId && !deleteAll) return Response.json({ error: "id or clientId is required" }, { status: 400 });
    const db = await getRawDb();
    await ensureWardrobeTables(db);
    const requestedGeneration = requestDataGeneration(request);
    const activeGeneration = await currentDataGeneration(db, owner);
    if (!requestedGeneration || requestedGeneration !== activeGeneration) {
      return staleDataGenerationResponse(activeGeneration);
    }
    await cleanupPendingImages(db);

    if (deleteAll) {
      const items = await db
        .prepare(`SELECT image_key FROM wardrobe_items WHERE owner_email = ? AND image_key IS NOT NULL AND COALESCE(
          (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
          'initial'
        ) = ?`)
        .bind(owner, owner, requestedGeneration)
        .all<{ image_key: string }>();
      await db.batch([
        db.prepare(`INSERT OR REPLACE INTO wardrobe_image_cleanup (image_key, owner_email, created_at)
          SELECT image_key, owner_email, CURRENT_TIMESTAMP FROM wardrobe_items
          WHERE owner_email = ? AND image_key IS NOT NULL AND COALESCE(
            (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
            'initial'
          ) = ?`)
          .bind(owner, owner, requestedGeneration),
        db.prepare(`UPDATE wardrobe_sync_keys SET state = 'deleted', updated_at = CURRENT_TIMESTAMP
          WHERE owner_email = ? AND COALESCE(
            (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
            'initial'
          ) = ?`)
          .bind(owner, owner, requestedGeneration),
        db.prepare(`DELETE FROM wardrobe_items WHERE owner_email = ? AND COALESCE(
          (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
          'initial'
        ) = ?`)
          .bind(owner, owner, requestedGeneration),
      ]);
      const latestGeneration = await currentDataGeneration(db, owner);
      if (latestGeneration !== requestedGeneration) {
        return staleDataGenerationResponse(latestGeneration);
      }
      const imageKeys = items.results.map((row) => row.image_key);
      if (imageKeys.length) {
        try {
          const images = await getWardrobeImages();
          for (let start = 0; start < imageKeys.length; start += 1000) {
            await images.delete(imageKeys.slice(start, start + 1000));
          }
          for (let start = 0; start < imageKeys.length; start += 99) {
            const keys = imageKeys.slice(start, start + 99);
            await db.prepare(
              `DELETE FROM wardrobe_image_cleanup WHERE owner_email = ? AND image_key IN (${keys.map(() => "?").join(", ")})`,
            ).bind(owner, ...keys).run();
          }
        } catch {
          // Rows are already inaccessible; the cleanup outbox retries object deletion.
        }
      }
      return new Response(null, { status: 204, headers: dataGenerationHeaders(latestGeneration) });
    }

    const resolvedId = clientId
      ? (await wardrobeCloudId(owner, clientId))!
      : id!;
    const found = await db
      .prepare(`SELECT wardrobe_items.image_key, wardrobe_sync_keys.client_id
        FROM wardrobe_items
        LEFT JOIN wardrobe_sync_keys
          ON wardrobe_sync_keys.owner_email = wardrobe_items.owner_email
          AND wardrobe_sync_keys.item_id = wardrobe_items.id
        WHERE wardrobe_items.owner_email = ? AND wardrobe_items.id = ? AND COALESCE(
        (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
        'initial'
      ) = ?`)
      .bind(owner, resolvedId, owner, requestedGeneration)
      .first<{ image_key: string | null; client_id: string | null }>();
    const statements: D1PreparedStatement[] = [];
    const tombstoneClientId = clientId ?? found?.client_id ?? null;
    if (tombstoneClientId) {
      statements.push(
        db.prepare(`INSERT INTO wardrobe_sync_keys (
          owner_email, client_id, item_id, state, created_at, updated_at
        ) SELECT ?, ?, ?, 'deleted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE COALESCE(
          (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
          'initial'
        ) = ?
        ON CONFLICT(owner_email, client_id) DO UPDATE SET
          item_id = excluded.item_id, state = 'deleted', updated_at = CURRENT_TIMESTAMP`)
          .bind(owner, tombstoneClientId, resolvedId, owner, requestedGeneration),
      );
    }
    if (found?.image_key) {
      statements.push(
        db.prepare(`INSERT OR REPLACE INTO wardrobe_image_cleanup (image_key, owner_email, created_at)
          SELECT image_key, owner_email, CURRENT_TIMESTAMP FROM wardrobe_items
          WHERE owner_email = ? AND id = ? AND image_key IS NOT NULL AND COALESCE(
            (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
            'initial'
          ) = ?`)
          .bind(owner, resolvedId, owner, requestedGeneration),
      );
    }
    statements.push(
      db.prepare(`DELETE FROM wardrobe_items WHERE owner_email = ? AND id = ? AND COALESCE(
        (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
        'initial'
      ) = ?`).bind(owner, resolvedId, owner, requestedGeneration),
    );
    await db.batch(statements);
    const latestGeneration = await currentDataGeneration(db, owner);
    if (latestGeneration !== requestedGeneration) {
      return staleDataGenerationResponse(latestGeneration);
    }
    if (found?.image_key) {
      try {
        await (await getWardrobeImages()).delete(found.image_key);
        await db.prepare("DELETE FROM wardrobe_image_cleanup WHERE image_key = ?")
          .bind(found.image_key)
          .run();
      } catch {
        // The item is inaccessible and the cleanup outbox retains the object key.
      }
    }
    return new Response(null, { status: 204, headers: dataGenerationHeaders(latestGeneration) });
  } catch {
    return Response.json({ error: "wardrobe temporarily unavailable" }, { status: 503 });
  }
}
