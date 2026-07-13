import { getRawDb } from "../../../db";
import {
  currentDataGeneration,
  dataGenerationHeaders,
  ensureDataGenerationTable,
  requestDataGeneration,
  staleDataGenerationResponse,
} from "../../lib/data-generation";
import { ownerForRequest, unauthorizedJson } from "../../lib/request-owner";

type ProfileRow = {
  height: number;
  weight: number;
  shoulder: number;
  chest: number;
  waist: number;
  hips: number;
  torso: number;
  legs: number;
  skin_tone: string;
  body_shape: string;
  revision: number;
};

function profileFromRow(row: ProfileRow) {
  return {
    height: row.height,
    weight: row.weight,
    shoulder: row.shoulder,
    chest: row.chest,
    waist: row.waist,
    hips: row.hips,
    torso: row.torso,
    legs: row.legs,
    skinTone: row.skin_tone,
    bodyShape: row.body_shape,
  };
}

async function profileRow(db: D1Database, owner: string) {
  return db
    .prepare("SELECT * FROM body_profiles WHERE owner_email = ?")
    .bind(owner)
    .first<ProfileRow>();
}

async function hasProfileRevisionColumn(db: D1Database) {
  const columns = await db
    .prepare("PRAGMA table_info(body_profiles)")
    .all<{ name: string }>();
  return columns.results.some((column) => column.name === "revision");
}

export async function ensureProfileTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS body_profiles (
    owner_email TEXT PRIMARY KEY NOT NULL,
    height INTEGER NOT NULL,
    weight INTEGER NOT NULL,
    shoulder INTEGER NOT NULL,
    chest INTEGER NOT NULL,
    waist INTEGER NOT NULL,
    hips INTEGER NOT NULL,
    torso INTEGER NOT NULL,
    legs INTEGER NOT NULL,
    skin_tone TEXT NOT NULL,
    body_shape TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  if (await hasProfileRevisionColumn(db)) return;
  try {
    await db.prepare(
      "ALTER TABLE body_profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
    ).run();
  } catch (error) {
    // Concurrent first requests can both observe the legacy schema. One ALTER
    // wins; the loser may ignore only the proven duplicate-column race.
    if (!(await hasProfileRevisionColumn(db))) throw error;
  }
}

export async function GET(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    const db = await getRawDb();
    await ensureProfileTable(db);
    const generation = await currentDataGeneration(db, owner);
    const row = await profileRow(db, owner);
    if (!row) {
      return Response.json(
        { profile: null, revision: 0, generation },
        { headers: dataGenerationHeaders(generation) },
      );
    }
    return Response.json(
      {
        profile: profileFromRow(row),
        revision: row.revision,
        generation,
      },
      { headers: dataGenerationHeaders(generation) },
    );
  } catch {
    return Response.json({ error: "profile temporarily unavailable" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return Response.json({ error: "JSON is required" }, { status: 415 });
    }
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ error: "profile must be a JSON object" }, { status: 400 });
    }
    const expectedRevision = payload.expectedRevision;
    if (
      typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER
    ) {
      return Response.json(
        { error: "expectedRevision must be a non-negative safe integer" },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    const ranges: Record<string, [number, number]> = {
      height: [140, 210], weight: [30, 180], shoulder: [25, 70], chest: [55, 180],
      waist: [45, 180], hips: [55, 190], torso: [35, 70], legs: [55, 115],
    };
    const values: Record<string, number> = {};
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = Number(payload[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        return Response.json({ error: `invalid ${key}` }, { status: 400 });
      }
      values[key] = Math.round(value);
    }
    const skinTone = String(payload.skinTone ?? "");
    const bodyShape = String(payload.bodyShape ?? "");
    if (!/^#[0-9a-f]{6}$/i.test(skinTone)) return Response.json({ error: "invalid skin tone" }, { status: 400 });
    if (!["straight", "pear", "hourglass", "inverted", "apple"].includes(bodyShape)) return Response.json({ error: "invalid body shape" }, { status: 400 });

    const db = await getRawDb();
    await ensureProfileTable(db);
    await ensureDataGenerationTable(db);
    const requestedGeneration = requestDataGeneration(request);
    const activeGeneration = await currentDataGeneration(db, owner);
    if (!requestedGeneration || requestedGeneration !== activeGeneration) {
      return staleDataGenerationResponse(activeGeneration);
    }
    const result = await db.prepare(`INSERT INTO body_profiles (
      owner_email, height, weight, shoulder, chest, waist, hips, torso, legs,
      skin_tone, body_shape, revision, updated_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP
    WHERE COALESCE(
      (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
      'initial'
    ) = ? AND (
      ? = 0 OR EXISTS (
        SELECT 1 FROM body_profiles WHERE owner_email = ?
      )
    )
    ON CONFLICT(owner_email) DO UPDATE SET
      height = excluded.height, weight = excluded.weight, shoulder = excluded.shoulder,
      chest = excluded.chest, waist = excluded.waist, hips = excluded.hips,
      torso = excluded.torso, legs = excluded.legs, skin_tone = excluded.skin_tone,
      body_shape = excluded.body_shape, revision = body_profiles.revision + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE body_profiles.revision = ? AND ? > 0 AND COALESCE(
      (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
      'initial'
    ) = ?`)
      .bind(
        owner, values.height, values.weight, values.shoulder, values.chest,
        values.waist, values.hips, values.torso, values.legs, skinTone, bodyShape,
        owner, requestedGeneration,
        expectedRevision, owner,
        expectedRevision, expectedRevision, owner, requestedGeneration,
      )
      .run();
    if (result.meta.changes !== 1) {
      const conflictGeneration = await currentDataGeneration(db, owner);
      if (conflictGeneration !== requestedGeneration) {
        return staleDataGenerationResponse(conflictGeneration);
      }
      const current = await profileRow(db, owner);
      const confirmedGeneration = await currentDataGeneration(db, owner);
      if (confirmedGeneration !== requestedGeneration) {
        return staleDataGenerationResponse(confirmedGeneration);
      }
      return Response.json(
        {
          error: "profile revision conflict",
          profile: current ? profileFromRow(current) : null,
          revision: current?.revision ?? 0,
          generation: confirmedGeneration,
        },
        { status: 409, headers: dataGenerationHeaders(confirmedGeneration) },
      );
    }
    return Response.json(
      {
        saved: true,
        revision: expectedRevision + 1,
        generation: requestedGeneration,
      },
      { headers: dataGenerationHeaders(requestedGeneration) },
    );
  } catch {
    return Response.json({ error: "profile temporarily unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    const db = await getRawDb();
    await ensureProfileTable(db);
    const requestedGeneration = requestDataGeneration(request);
    const activeGeneration = await currentDataGeneration(db, owner);
    if (!requestedGeneration || requestedGeneration !== activeGeneration) {
      return staleDataGenerationResponse(activeGeneration);
    }
    await db.prepare(`DELETE FROM body_profiles WHERE owner_email = ? AND COALESCE(
      (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
      'initial'
    ) = ?`).bind(owner, owner, requestedGeneration).run();
    return new Response(null, { status: 204, headers: dataGenerationHeaders(activeGeneration) });
  } catch {
    return Response.json({ error: "profile temporarily unavailable" }, { status: 503 });
  }
}
