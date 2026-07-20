import { getRawDb } from "../../../db";
import {
  currentDataGeneration,
  dataGenerationHeaders,
  ensureDataGenerationTable,
  requestDataGeneration,
  staleDataGenerationResponse,
} from "../../lib/data-generation";
import {
  DEFAULT_BODY_FEATURE,
  DEFAULT_HAIR_COLOR,
  isBodyFeature,
  isHexColor,
  normalizeBodyFeature,
  normalizeHexColor,
} from "../../lib/avatar-appearance";
import { requireExpectedOwner } from "../../lib/request-owner";
import { createPerBindingInitializer } from "../../lib/per-binding-initializer.mjs";

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
  hair_color: string;
  body_feature: string;
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
    hairColor: normalizeHexColor(row.hair_color),
    bodyFeature: normalizeBodyFeature(row.body_feature),
  };
}

async function profileRow(db: D1Database, owner: string) {
  return db
    .prepare("SELECT * FROM body_profiles WHERE owner_email = ?")
    .bind(owner)
    .first<ProfileRow>();
}

async function profileColumnNames(db: D1Database) {
  const columns = await db
    .prepare("PRAGMA table_info(body_profiles)")
    .all<{ name: string }>();
  return new Set(columns.results.map((column) => column.name));
}

async function ensureProfileColumn(
  db: D1Database,
  knownColumns: Set<string>,
  column: string,
  statement: string,
) {
  if (knownColumns.has(column)) return;
  try {
    await db.prepare(statement).run();
    knownColumns.add(column);
  } catch (error) {
    // Different Worker isolates can migrate the same binding concurrently.
    // Ignore only the race where another isolate has provably added the column.
    if (!(await profileColumnNames(db)).has(column)) throw error;
    knownColumns.add(column);
  }
}

async function initializeProfileTable(db: D1Database) {
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
    hair_color TEXT NOT NULL DEFAULT '${DEFAULT_HAIR_COLOR}',
    body_feature TEXT NOT NULL DEFAULT '${DEFAULT_BODY_FEATURE}',
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const columns = await profileColumnNames(db);
  await ensureProfileColumn(
    db,
    columns,
    "revision",
    "ALTER TABLE body_profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
  );
  await ensureProfileColumn(
    db,
    columns,
    "hair_color",
    `ALTER TABLE body_profiles ADD COLUMN hair_color TEXT NOT NULL DEFAULT '${DEFAULT_HAIR_COLOR}'`,
  );
  await ensureProfileColumn(
    db,
    columns,
    "body_feature",
    `ALTER TABLE body_profiles ADD COLUMN body_feature TEXT NOT NULL DEFAULT '${DEFAULT_BODY_FEATURE}'`,
  );
}

export const ensureProfileTable = createPerBindingInitializer(initializeProfileTable);

export async function GET(request: Request) {
  try {
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner } = ownership;
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
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner } = ownership;
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
    const hasHairColor = Object.hasOwn(payload, "hairColor");
    const hasBodyFeature = Object.hasOwn(payload, "bodyFeature");
    if (hasHairColor && !isHexColor(payload.hairColor)) {
      return Response.json({ error: "invalid hair color" }, { status: 400 });
    }
    if (hasBodyFeature && !isBodyFeature(payload.bodyFeature)) {
      return Response.json({ error: "invalid body feature" }, { status: 400 });
    }
    const hairColor = normalizeHexColor(
      hasHairColor ? payload.hairColor : DEFAULT_HAIR_COLOR,
    );
    const bodyFeature = normalizeBodyFeature(
      hasBodyFeature ? payload.bodyFeature : DEFAULT_BODY_FEATURE,
    );

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
      skin_tone, body_shape, hair_color, body_feature, revision, updated_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP
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
      body_shape = excluded.body_shape,
      hair_color = CASE WHEN ? = 1 THEN excluded.hair_color ELSE body_profiles.hair_color END,
      body_feature = CASE WHEN ? = 1 THEN excluded.body_feature ELSE body_profiles.body_feature END,
      revision = body_profiles.revision + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE body_profiles.revision = ? AND ? > 0 AND COALESCE(
      (SELECT generation FROM owner_data_generations WHERE owner_email = ?),
      'initial'
    ) = ?`)
      .bind(
        owner, values.height, values.weight, values.shoulder, values.chest,
        values.waist, values.hips, values.torso, values.legs, skinTone, bodyShape,
        hairColor, bodyFeature,
        owner, requestedGeneration,
        expectedRevision, owner,
        Number(hasHairColor), Number(hasBodyFeature),
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
    const ownership = await requireExpectedOwner(request);
    if ("response" in ownership) return ownership.response;
    const { owner } = ownership;
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
