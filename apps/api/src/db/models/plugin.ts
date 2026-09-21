import { Schema } from "mongoose";

/**
 * Applied to every schema so API responses consistently expose `id`
 * (string) instead of Mongo's `_id` (ObjectId), and drop the internal
 * `__v` version key. This keeps the mobile app's TypeScript types clean
 * camelCase, matching how the rest of this rewrite standardizes field
 * naming (the previous raw-SQL routers returned inconsistent snake_case).
 */
export function applyStandardJson(schema: Schema) {
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });
  schema.set("timestamps", true);
}
