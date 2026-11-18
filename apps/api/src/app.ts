// Must be first: patches express.Route so async handler errors reach next(err).
import "./http/async-errors";

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { authRouter } from "./auth/auth.router";
import { groupsRouter } from "./groups/groups.router";
import { expensesRouter } from "./expenses/expenses.router";
import { settlementsRouter } from "./settlements/settlements.router";
import { resolutionRouter } from "./resolution/resolution.router";
import { contactsRouter } from "./contacts/contacts.router";
import { recurringRouter } from "./recurring/recurring.router";
import { exportsRouter } from "./exports/exports.router";
import { notificationsRouter } from "./notifications/notifications.router";
import { searchRouter } from "./search/search.router";
import { shoppingRouter } from "./shopping/shopping.router";
import { templatesRouter } from "./templates/templates.router";
import { documentsRouter } from "./documents/documents.router";
import { voiceRouter } from "./voice/voice.router";
import { receiptsRouter } from "./receipts/receipts.router";

/** Builds the Express app (no DB connection, no listen) so it can be tested directly. */
export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ALLOWED_ORIGINS?.split(",") ?? "*" }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

  app.use("/auth", authRouter);
  app.use("/groups", groupsRouter);
  app.use("/expenses", expensesRouter);
  app.use("/settlements", settlementsRouter);
  app.use("/resolve-names", resolutionRouter);
  app.use("/contacts", contactsRouter);
  app.use("/recurring-expenses", recurringRouter);
  app.use("/exports", exportsRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/search", searchRouter);
  app.use("/shopping", shoppingRouter);
  app.use("/templates", templatesRouter);
  app.use("/documents", documentsRouter);
  app.use("/voice", voiceRouter);
  app.use("/receipts", receiptsRouter);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  // Centralized error handler — never leak stack traces to the client.
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err?.name === "CastError" || err?.name === "BSONError") {
      return res.status(400).json({ error: "Invalid ID or value" });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON body" });
    }
    if (err?.name === "MulterError") {
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.message });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed" });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
