import { z } from "zod";
import mongoose from "mongoose";

/** Validates a string is a well-formed MongoDB ObjectId (24 hex chars). */
export const objectId = z.string().refine((val) => mongoose.isValidObjectId(val), {
  message: "Invalid ID format",
});
