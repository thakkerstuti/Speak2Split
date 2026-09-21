import cron from "node-cron";
import { RecurringExpenseModel } from "../db/models/RecurringExpense";
import { ExpenseModel } from "../db/models/Expense";
import { ActivityEventModel } from "../db/models/ActivityEvent";
import { calculateSplit } from "@speak2split/shared";
import { advanceOccurrence } from "./recurring.router";
import { broadcastToGroup } from "../realtime/socket";

/**
 * Generates all due recurring expenses. Runs on a schedule (see
 * startRecurringScheduler) and is also exported directly so it can be
 * invoked on-demand from a test or an admin endpoint without waiting for
 * the cron tick.
 *
 * Duplicate-generation safety has two independent layers:
 *  1. App-level: we only ever process rows where nextOccurrence <= now()
 *     and advance nextOccurrence right after generating.
 *  2. DB-level: a real unique index on
 *     (recurringExpenseId, recurringOccurrenceDate) on the Expense
 *     collection. Even if the scheduler somehow ran twice concurrently,
 *     the second insert for the same occurrence date throws E11000 and is
 *     caught here, not silently double-billed. Since payers/participants
 *     are embedded in the Expense document, generation is a single atomic
 *     insert — no multi-statement transaction is needed here at all,
 *     unlike the previous Postgres version.
 */
export async function runRecurringGeneration(): Promise<{ generated: number; errors: number }> {
  const due = await RecurringExpenseModel.find({
    isActive: true,
    nextOccurrence: { $lte: new Date() },
    $or: [{ endDate: { $exists: false } }, { endDate: { $gte: new Date() } }],
  });

  let generated = 0;
  let errors = 0;

  for (const row of due) {
    try {
      const payers = row.payerConfig as { userId: string; amountPaid: number }[];
      const participants = row.participantConfig as { userId: string }[];
      const split = calculateSplit(row.amount, row.splitMethod, payers, participants);

      const occurrenceDate = row.nextOccurrence.toISOString().slice(0, 10);

      const expense = await ExpenseModel.create({
        groupId: row.groupId,
        title: row.title,
        amount: row.amount,
        currency: row.currency,
        category: row.category,
        splitMethod: row.splitMethod,
        source: "RECURRING",
        expenseDate: row.nextOccurrence,
        createdById: row.createdById,
        recurringExpenseId: row._id,
        recurringOccurrenceDate: occurrenceDate,
        payers: split.payers,
        participants: split.participants,
      });

      row.nextOccurrence = advanceOccurrence(row.nextOccurrence, row.frequency);
      row.lastGeneratedAt = new Date();
      await row.save();

      await ActivityEventModel.create({
        groupId: row.groupId,
        actorId: row.createdById,
        expenseId: expense._id,
        type: "recurring_expense_created",
        metadata: { title: expense.title, amount: expense.amount },
      });

      broadcastToGroup(String(row.groupId), "recurring_expense_created", {
        expenseId: String(expense._id),
        title: expense.title,
      });
      generated++;
    } catch (err) {
      // E11000 (duplicate key) means another run already generated this
      // exact occurrence — that's the duplicate-prevention guard working
      // as intended, not a real error, so we don't count it as one.
      if ((err as { code?: number }).code !== 11000) {
        // eslint-disable-next-line no-console
        console.error(`Recurring generation failed for ${row._id}:`, err);
        errors++;
      }
    }
  }

  return { generated, errors };
}

export function startRecurringScheduler() {
  // Every hour — recurring expenses are day/week/month granularity, so
  // hourly is frequent enough to feel real-time without hammering the DB.
  cron.schedule("0 * * * *", () => {
    runRecurringGeneration().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Recurring scheduler tick failed:", err);
    });
  });
}
