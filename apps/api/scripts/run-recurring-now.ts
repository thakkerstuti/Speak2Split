/**
 * Dev/test utility: run recurring expense generation immediately instead of
 * waiting for the hourly cron tick. Never exposed as an HTTP endpoint —
 * run directly: `npx ts-node scripts/run-recurring-now.ts`
 */
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { runRecurringGeneration } from "../src/recurring/scheduler";

connectMongo()
  .then(() => runRecurringGeneration())
  .then((result) => {
    // eslint-disable-next-line no-console
    console.log("Recurring generation result:", result);
    return disconnectMongo();
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
