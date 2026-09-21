import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Minimal storage abstraction. In this sandbox (and for local development)
 * files are written to disk under STORAGE_LOCAL_DIR. In production, swap
 * this module's implementation for an S3 (or GCS/Supabase) client using
 * the STORAGE_PROVIDER / S3_* variables already documented in
 * .env.example — the router code calling this module doesn't need to
 * change, only this file.
 */

const LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), "uploads");

if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

export interface StoredFile {
  storageKey: string; // opaque path/key the DB stores
  sizeBytes: number;
}

export async function saveFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const ext = path.extname(originalName);
  const key = `${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(LOCAL_DIR, key);
  await fs.promises.writeFile(fullPath, buffer);
  return { storageKey: key, sizeBytes: buffer.length };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  const fullPath = path.join(LOCAL_DIR, storageKey);
  return fs.promises.readFile(fullPath);
}

export async function deleteFile(storageKey: string): Promise<void> {
  const fullPath = path.join(LOCAL_DIR, storageKey);
  try {
    await fs.promises.unlink(fullPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
