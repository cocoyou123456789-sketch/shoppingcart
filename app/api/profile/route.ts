import { getRawDb } from "../../../db";
import { ownerForRequest, unauthorizedJson } from "../../lib/request-owner";

async function ensureProfileTable(db: D1Database) {
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
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export async function GET(request: Request) {
  try {
    const owner = ownerForRequest(request);
    if (!owner) return unauthorizedJson();
    const db = await getRawDb();
    await ensureProfileTable(db);
    const row = await db
      .prepare("SELECT * FROM body_profiles WHERE owner_email = ?")
      .bind(owner)
      .first<Record<string, unknown>>();
    if (!row) return Response.json({ profile: null });
    return Response.json({
      profile: {
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
      },
    });
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
    await db.prepare(`INSERT INTO body_profiles (
      owner_email, height, weight, shoulder, chest, waist, hips, torso, legs, skin_tone, body_shape, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(owner_email) DO UPDATE SET
      height = excluded.height, weight = excluded.weight, shoulder = excluded.shoulder,
      chest = excluded.chest, waist = excluded.waist, hips = excluded.hips,
      torso = excluded.torso, legs = excluded.legs, skin_tone = excluded.skin_tone,
      body_shape = excluded.body_shape, updated_at = CURRENT_TIMESTAMP`)
      .bind(
        owner, values.height, values.weight, values.shoulder, values.chest,
        values.waist, values.hips, values.torso, values.legs, skinTone, bodyShape,
      )
      .run();
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: "profile temporarily unavailable" }, { status: 503 });
  }
}
