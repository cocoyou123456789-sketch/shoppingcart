import { getRawDb, getWardrobeImages } from "../../../db";
import {
  CLEAR_REQUEST_HEADER,
  currentDataGeneration,
  dataGenerationHeaders,
  ensureDataGenerationTable,
  requestClearOperationId,
  requestDataGeneration,
  staleDataGenerationResponse,
} from "../../lib/data-generation";
import { requireExpectedOwner } from "../../lib/request-owner";
import { ensureProfileTable } from "../profile/route";
import { ensureWardrobeTables } from "../wardrobe/route";

async function ensureClearTables(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS personal_data_clear_operations (
      owner_email TEXT NOT NULL,
      request_id TEXT NOT NULL,
      expected_generation TEXT NOT NULL,
      next_generation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      PRIMARY KEY (owner_email, request_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS personal_data_clear_images (
      owner_email TEXT NOT NULL,
      request_id TEXT NOT NULL,
      image_key TEXT NOT NULL,
      PRIMARY KEY (owner_email, request_id, image_key)
    )`),
  ]);
}

async function clearOperation(
  db: D1Database,
  owner: string,
  requestId: string,
) {
  return db.prepare(`SELECT next_generation, status FROM personal_data_clear_operations
    WHERE owner_email = ? AND request_id = ?`)
    .bind(owner, requestId)
    .first<{ next_generation: string; status: string }>();
}

async function drainClearedImages(db: D1Database, owner: string, requestId: string) {
  const rows = await db.prepare(`SELECT image_key FROM personal_data_clear_images
    WHERE owner_email = ? AND request_id = ?`)
    .bind(owner, requestId)
    .all<{ image_key: string }>();
  if (!rows.results.length) return;
  const keys = rows.results.map((row) => row.image_key);
  const images = await getWardrobeImages();
  for (let start = 0; start < keys.length; start += 1000) {
    await images.delete(keys.slice(start, start + 1000));
  }
  for (let start = 0; start < keys.length; start += 90) {
    const slice = keys.slice(start, start + 90);
    await db.batch([
      db.prepare(
        `DELETE FROM wardrobe_image_cleanup WHERE owner_email = ? AND image_key IN (${slice.map(() => "?").join(", ")})`,
      ).bind(owner, ...slice),
      db.prepare(
        `DELETE FROM personal_data_clear_images WHERE owner_email = ? AND request_id = ? AND image_key IN (${slice.map(() => "?").join(", ")})`,
      ).bind(owner, requestId, ...slice),
    ]);
  }
}

export async function DELETE(request: Request) {
  try {
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner } = ownership;
    const expectedGeneration = requestDataGeneration(request);
    const requestId = requestClearOperationId(request);
    if (!expectedGeneration || !requestId) {
      return Response.json(
        { error: `${CLEAR_REQUEST_HEADER} and a valid data generation are required` },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }

    const db = await getRawDb();
    await ensureWardrobeTables(db);
    await ensureProfileTable(db);
    await ensureDataGenerationTable(db);
    await ensureClearTables(db);

    const replay = await clearOperation(db, owner, requestId);
    if (replay?.status === "done") {
      try {
        await drainClearedImages(db, owner, requestId);
      } catch {
        return Response.json(
          { error: "personal data is inaccessible; private image cleanup is still retrying" },
          {
            status: 503,
            headers: { ...dataGenerationHeaders(replay.next_generation), "retry-after": "2" },
          },
        );
      }
      return new Response(null, {
        status: 204,
        headers: dataGenerationHeaders(replay.next_generation),
      });
    }

    const activeGeneration = await currentDataGeneration(db, owner);
    if (activeGeneration !== expectedGeneration) {
      return staleDataGenerationResponse(activeGeneration);
    }
    const nextGeneration = `cloud-${crypto.randomUUID()}`;

    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO personal_data_clear_operations (
        owner_email, request_id, expected_generation, next_generation, status, created_at
      ) SELECT ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP
      WHERE COALESCE(
        (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
        'initial'
      ) = ?`)
        .bind(owner, requestId, expectedGeneration, nextGeneration, owner, expectedGeneration),
      db.prepare(`INSERT INTO owner_data_generations (owner_email, generation, cleared_at)
        SELECT ?, ?, CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM personal_data_clear_operations
          WHERE owner_email = ? AND request_id = ? AND status = 'pending'
        )
        ON CONFLICT(owner_email) DO UPDATE SET
          generation = excluded.generation, cleared_at = CURRENT_TIMESTAMP
        WHERE owner_data_generations.generation = ?`)
        .bind(owner, nextGeneration, owner, requestId, expectedGeneration),
      db.prepare(`INSERT OR IGNORE INTO personal_data_clear_images (owner_email, request_id, image_key)
        SELECT ?, ?, image_key FROM wardrobe_items
        WHERE owner_email = ? AND image_key IS NOT NULL AND EXISTS (
          SELECT 1 FROM personal_data_clear_operations
          WHERE owner_email = ? AND request_id = ? AND status = 'pending'
        )`)
        .bind(owner, requestId, owner, owner, requestId),
      db.prepare(`INSERT OR IGNORE INTO personal_data_clear_images (owner_email, request_id, image_key)
        SELECT ?, ?, image_key FROM wardrobe_image_cleanup
        WHERE owner_email = ? AND EXISTS (
          SELECT 1 FROM personal_data_clear_operations
          WHERE owner_email = ? AND request_id = ? AND status = 'pending'
        )`)
        .bind(owner, requestId, owner, owner, requestId),
      db.prepare(`INSERT OR REPLACE INTO wardrobe_image_cleanup (image_key, owner_email, created_at)
        SELECT image_key, owner_email, CURRENT_TIMESTAMP FROM wardrobe_items
        WHERE owner_email = ? AND image_key IS NOT NULL AND EXISTS (
          SELECT 1 FROM personal_data_clear_operations
          WHERE owner_email = ? AND request_id = ? AND status = 'pending'
        )`)
        .bind(owner, owner, requestId),
      db.prepare(`UPDATE wardrobe_sync_keys SET state = 'deleted', updated_at = CURRENT_TIMESTAMP
        WHERE owner_email = ? AND EXISTS (
          SELECT 1 FROM personal_data_clear_operations
          WHERE owner_email = ? AND request_id = ? AND status = 'pending'
        )`)
        .bind(owner, owner, requestId),
      db.prepare(`DELETE FROM wardrobe_items WHERE owner_email = ? AND EXISTS (
        SELECT 1 FROM personal_data_clear_operations
        WHERE owner_email = ? AND request_id = ? AND status = 'pending'
      )`)
        .bind(owner, owner, requestId),
      db.prepare(`DELETE FROM body_profiles WHERE owner_email = ? AND EXISTS (
        SELECT 1 FROM personal_data_clear_operations
        WHERE owner_email = ? AND request_id = ? AND status = 'pending'
      )`)
        .bind(owner, owner, requestId),
      db.prepare(`UPDATE personal_data_clear_operations
        SET status = 'done', completed_at = CURRENT_TIMESTAMP
        WHERE owner_email = ? AND request_id = ? AND status = 'pending'`)
        .bind(owner, requestId),
    ]);

    const completed = await clearOperation(db, owner, requestId);
    if (!completed || completed.status !== "done") {
      return staleDataGenerationResponse(await currentDataGeneration(db, owner));
    }
    try {
      await drainClearedImages(db, owner, requestId);
    } catch {
      return Response.json(
        { error: "personal data is inaccessible; private image cleanup is still retrying" },
        {
          status: 503,
          headers: { ...dataGenerationHeaders(completed.next_generation), "retry-after": "2" },
        },
      );
    }
    return new Response(null, {
      status: 204,
      headers: dataGenerationHeaders(completed.next_generation),
    });
  } catch {
    return Response.json(
      { error: "personal data temporarily unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
