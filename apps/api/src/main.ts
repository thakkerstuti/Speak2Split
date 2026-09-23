import express from "express";
import cors from "cors";
import { createServer } from "http";
import { connectMongo } from "./db/mongoose";
import { authRouter } from "./auth/auth.router";
import { groupsRouter } from "./groups/groups.router";
import { expensesRouter } from "./expenses/expenses.router";
import { settlementsRouter } from "./settlements/settlements.router";
import { resolutionRouter } from "./resolution/resolution.router";
import { contactsRouter } from "./contacts/contacts.router";
import { recurringRouter } from "./recurring/recurring.router";
import { startRecurringScheduler } from "./recurring/scheduler";
import { exportsRouter } from "./exports/exports.router";
import { notificationsRouter } from "./notifications/notifications.router";
import { searchRouter } from "./search/search.router";
import { shoppingRouter } from "./shopping/shopping.router";
import { templatesRouter } from "./templates/templates.router";
import { documentsRouter } from "./documents/documents.router";
import { voiceRouter } from "./voice/voice.router";
import { receiptsRouter } from "./receipts/receipts.router";
import { initRealtime } from "./realtime/socket";

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

// Centralized error handler — never leak stack traces to the client.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);
initRealtime(httpServer);

const port = Number(process.env.PORT || process.env.API_PORT) || 3000;

// Connect to MongoDB before accepting any traffic — failing fast and
// loudly here is much better than accepting requests that will all fail
// with confusing per-request database errors.
connectMongo()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("Connected to MongoDB");
    startRecurringScheduler();
    httpServer.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Speak2Split API listening on :${port}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to connect to MongoDB — server not started:", err.message);
    process.exit(1);
  });
