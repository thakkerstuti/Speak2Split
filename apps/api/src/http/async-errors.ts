import express, { NextFunction, Request, Response } from "express";

/**
 * Express 4 does not catch rejected promises from async route handlers: the
 * rejection becomes an unhandledRejection and (on Node >= 15) kills the whole
 * process. This module patches express.Route so every handler registered via
 * router.get/post/put/patch/delete/all/... forwards thrown errors and rejected
 * promises to next(err), where the central error middleware turns them into
 * a JSON response.
 *
 * It must be imported BEFORE any router module registers its routes — app.ts
 * imports it first.
 */

const METHODS = ["get", "post", "put", "patch", "delete", "all", "options", "head"] as const;
const PATCHED = Symbol.for("speak2split.asyncErrorsPatched");

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export function wrapAsync(fn: unknown): unknown {
  // Leave non-functions and 4-arity error handlers untouched.
  if (typeof fn !== "function" || fn.length === 4) return fn;
  const handler = fn as Handler;
  return function asyncSafe(req: Request, res: Response, next: NextFunction) {
    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(next);
      }
      return result;
    } catch (err) {
      next(err);
    }
  };
}

const RouteProto = (express as unknown as { Route: { prototype: Record<string | symbol, any> } }).Route.prototype;

if (!RouteProto[PATCHED]) {
  for (const method of METHODS) {
    const original = RouteProto[method];
    if (typeof original !== "function") continue;
    RouteProto[method] = function patched(this: unknown, ...handlers: unknown[]) {
      const flat = (handlers as unknown[]).flat(Infinity).map(wrapAsync);
      return original.apply(this, flat);
    };
  }
  RouteProto[PATCHED] = true;
}
