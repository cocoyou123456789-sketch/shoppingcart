export const DATA_GENERATION_HEADER = "x-songsong-data-generation";
export const CLEAR_REQUEST_HEADER = "x-songsong-clear-request";
export const INITIAL_DATA_GENERATION = "initial";

const VALID_GENERATION = /^[a-zA-Z0-9-]{1,100}$/;

export async function ensureDataGenerationTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS owner_data_generations (
    owner_email TEXT PRIMARY KEY NOT NULL,
    generation TEXT NOT NULL,
    cleared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export async function currentDataGeneration(db: D1Database, owner: string) {
  await ensureDataGenerationTable(db);
  const row = await db
    .prepare("SELECT generation FROM owner_data_generations WHERE owner_email = ?")
    .bind(owner)
    .first<{ generation: string }>();
  return row?.generation ?? INITIAL_DATA_GENERATION;
}

export function requestDataGeneration(request: Request) {
  const value = request.headers.get(DATA_GENERATION_HEADER)?.trim() || INITIAL_DATA_GENERATION;
  return VALID_GENERATION.test(value) ? value : null;
}

export function requestClearOperationId(request: Request) {
  const value = request.headers.get(CLEAR_REQUEST_HEADER)?.trim();
  return value && VALID_GENERATION.test(value) ? value : null;
}

export function dataGenerationHeaders(generation: string) {
  return {
    "cache-control": "private, no-store",
    [DATA_GENERATION_HEADER]: generation,
  };
}

export function staleDataGenerationResponse(generation: string) {
  return Response.json(
    { error: "this tab has older personal data", generation },
    { status: 409, headers: dataGenerationHeaders(generation) },
  );
}
