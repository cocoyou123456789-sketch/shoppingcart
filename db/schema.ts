import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
