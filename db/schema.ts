import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const wardrobeItems = sqliteTable(
  "wardrobe_items",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    color: text("color").notNull(),
    colorName: text("color_name").notNull(),
    size: text("size").notNull().default(""),
    source: text("source").notNull().default("我的衣服"),
    sourceUrl: text("source_url"),
    imageKey: text("image_key"),
    imageType: text("image_type"),
    season: text("season").notNull().default("四季"),
    style: text("style").notNull().default("日常"),
    chest: real("chest"),
    waist: real("waist"),
    hips: real("hips"),
    length: real("length"),
    confidence: text("confidence").notNull().default("待确认"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("wardrobe_owner_id_idx").on(table.ownerEmail, table.id)],
);

export const bodyProfiles = sqliteTable("body_profiles", {
  ownerEmail: text("owner_email").primaryKey(),
  height: integer("height").notNull(),
  weight: integer("weight").notNull(),
  shoulder: integer("shoulder").notNull(),
  chest: integer("chest").notNull(),
  waist: integer("waist").notNull(),
  hips: integer("hips").notNull(),
  torso: integer("torso").notNull(),
  legs: integer("legs").notNull(),
  skinTone: text("skin_tone").notNull(),
  bodyShape: text("body_shape").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const wardrobeImageCleanup = sqliteTable(
  "wardrobe_image_cleanup",
  {
    imageKey: text("image_key").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    uploadState: text("upload_state").notNull().default("ready"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("wardrobe_cleanup_owner_idx").on(table.ownerEmail)],
);

export const ownerDataGenerations = sqliteTable("owner_data_generations", {
  ownerEmail: text("owner_email").primaryKey(),
  generation: text("generation").notNull(),
  clearedAt: text("cleared_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const personalDataClearOperations = sqliteTable(
  "personal_data_clear_operations",
  {
    ownerEmail: text("owner_email").notNull(),
    requestId: text("request_id").notNull(),
    expectedGeneration: text("expected_generation").notNull(),
    nextGeneration: text("next_generation").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [primaryKey({ columns: [table.ownerEmail, table.requestId] })],
);

export const personalDataClearImages = sqliteTable(
  "personal_data_clear_images",
  {
    ownerEmail: text("owner_email").notNull(),
    requestId: text("request_id").notNull(),
    imageKey: text("image_key").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerEmail, table.requestId, table.imageKey] })],
);

export const wardrobeSyncKeys = sqliteTable(
  "wardrobe_sync_keys",
  {
    ownerEmail: text("owner_email").notNull(),
    clientId: text("client_id").notNull(),
    itemId: text("item_id").notNull(),
    state: text("state").notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerEmail, table.clientId] }),
    uniqueIndex("wardrobe_sync_item_idx").on(table.ownerEmail, table.itemId),
  ],
);
