import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

async function getRuntimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env as unknown as { DB?: D1Database; WARDROBE_IMAGES?: R2Bucket };
}

export async function getDb() {
  const env = await getRuntimeEnv();
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function getRawDb(): Promise<D1Database> {
  const runtimeEnv = await getRuntimeEnv();
  if (!runtimeEnv.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return runtimeEnv.DB;
}

export async function getWardrobeImages(): Promise<R2Bucket> {
  const runtimeEnv = await getRuntimeEnv();
  if (!runtimeEnv.WARDROBE_IMAGES) {
    throw new Error("Cloudflare R2 binding `WARDROBE_IMAGES` is unavailable.");
  }
  return runtimeEnv.WARDROBE_IMAGES;
}
