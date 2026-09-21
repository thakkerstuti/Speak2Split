/**
 * Balance Engine — computes net balances per group member and produces a
 * minimal set of settlement transactions (greedy max-heap matching of
 * largest creditor <-> largest debtor), which minimizes the number of
 * payments required to settle a group, rather than naive pairwise debts.
 */

export interface LedgerLine {
  userId: string;
  totalPaid: number;
  totalOwed: number; // sum of this user's shares across all expenses
}

export interface NetBalance {
  userId: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number; // positive = is owed money, negative = owes money
}

export interface SettlementSuggestion {
  fromUserId: string; // owes
  toUserId: string; // is owed
  amount: number;
}

const CENTS = 100;
const toMinor = (n: number) => Math.round(n * CENTS);
const toMajor = (n: number) => Math.round(n) / CENTS;

export function computeNetBalances(lines: LedgerLine[]): NetBalance[] {
  return lines.map((l) => ({
    userId: l.userId,
    totalPaid: l.totalPaid,
    totalOwed: l.totalOwed,
    netBalance: toMajor(toMinor(l.totalPaid) - toMinor(l.totalOwed)),
  }));
}

/**
 * Debt-minimization: repeatedly match the largest creditor against the
 * largest debtor until all balances are zeroed. This is the standard
 * greedy approximation that minimizes total transaction count for the
 * "splitwise" settle-up problem.
 */
export function minimizeSettlements(balances: NetBalance[]): SettlementSuggestion[] {
  type Node = { userId: string; amountMinor: number };

  const creditors: Node[] = balances
    .filter((b) => toMinor(b.netBalance) > 0)
    .map((b) => ({ userId: b.userId, amountMinor: toMinor(b.netBalance) }));
  const debtors: Node[] = balances
    .filter((b) => toMinor(b.netBalance) < 0)
    .map((b) => ({ userId: b.userId, amountMinor: -toMinor(b.netBalance) }));

  // Sanity check: total credit must equal total debit (within 1 paise for rounding).
  const totalCredit = creditors.reduce((s, c) => s + c.amountMinor, 0);
  const totalDebit = debtors.reduce((s, d) => s + d.amountMinor, 0);
  if (Math.abs(totalCredit - totalDebit) > 1) {
    throw new Error(
      `Ledger does not balance: total credit ${totalCredit} !== total debit ${totalDebit}. This indicates a data integrity bug upstream.`
    );
  }

  creditors.sort((a, b) => b.amountMinor - a.amountMinor);
  debtors.sort((a, b) => b.amountMinor - a.amountMinor);

  const settlements: SettlementSuggestion[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amountMinor, debtor.amountMinor);

    if (amount > 0) {
      settlements.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amount: toMajor(amount),
      });
    }

    creditor.amountMinor -= amount;
    debtor.amountMinor -= amount;

    if (creditor.amountMinor === 0) ci++;
    if (debtor.amountMinor === 0) di++;
  }

  return settlements;
}

/**
 * Convenience: go straight from raw ledger lines to a minimized settlement plan.
 */
export function computeSettlementPlan(lines: LedgerLine[]): {
  balances: NetBalance[];
  settlements: SettlementSuggestion[];
} {
  const balances = computeNetBalances(lines);
  const settlements = minimizeSettlements(balances);
  return { balances, settlements };
}
