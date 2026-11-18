import { z } from "zod";
import type { Router, Request, Response, NextFunction } from "express";

/**
 * Strict ObjectId check: exactly 24 hex characters. Deliberately NOT
 * mongoose.isValidObjectId(), which also accepts any 12-character string.
 */
export function isObjectIdString(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

/** Validates a string is a well-formed MongoDB ObjectId (24 hex chars). */
export const objectId = z.string().refine(isObjectIdString, { message: "Invalid ID format" });

/**
 * Registers router.param() guards so any route on `router` whose path
 * contains one of these params rejects malformed IDs with a 400 before the
 * handler (and therefore before any database query) runs.
 */
export function validateObjectIdParams(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req: Request, res: Response, next: NextFunction, value: string) => {
      if (!isObjectIdString(value)) return res.status(400).json({ error: `Invalid ${name}` });
      next();
    });
  }
}

/** Escapes a user-provided string for safe literal use inside a RegExp. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
