import { createServer } from "http";
import { createApp } from "./app";
import { connectMongo } from "./db/mongoose";
import { startRecurringScheduler } from "./recurring/scheduler";
import { initRealtime } from "./realtime/socket";

// Last-resort safety net: route errors are already forwarded to the error
// middleware (see http/async-errors.ts); anything else that slips through is
// logged instead of crashing the process for every connected user.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled promise rejection:", reason);
});

const app = createApp();
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
