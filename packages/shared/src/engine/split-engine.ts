/**
 * Split Engine — server-authoritative expense math.
 *
 * Client-submitted totals/shares are NEVER trusted directly. This module
 * recomputes every split from the raw inputs and validates that the result
 * balances to the penny before an expense is allowed to persist.
 *
 * All money math is done in integer minor units (paise/cents) to avoid
 * floating point drift, then converted back to Decimal-string for storage.
 */

export type SplitMethod = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface Payer {
  userId: string;
  amountPaid: number; // major units, e.g. rupees
}

export interface ParticipantInput {
  userId: string;
  // Only the field relevant to the chosen split method needs to be set.
  exactAmount?: number; // EXACT
  percentage?: number; // PERCENTAGE (0-100)
  shareUnits?: number; // SHARES
}

export interface ResolvedParticipant {
  userId: string;
  shareAmount: number; // major units
  sharePercent?: number;
  shareUnits?: number;
}

export interface SplitResult {
  totalAmount: number;
  payers: Payer[];
  participants: ResolvedParticipant[];
}

export class SplitValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "SplitValidationError";
  }
}

const CENTS = 100;

function toMinor(amount: number): number {
  return Math.round(amount * CENTS);
}

function toMajor(minor: number): number {
  return Math.round(minor) / CENTS;
}

/**
 * Distributes `totalMinor` across `count` participants as evenly as possible,
 * assigning the leftover paise to the first participants (deterministic,
 * stable ordering) so the sum always reconciles exactly to totalMinor.
 */
function distributeEqually(totalMinor: number, count: number): number[] {
  if (count <= 0) throw new SplitValidationError("At least one participant is required", "NO_PARTICIPANTS");
  const base = Math.floor(totalMinor / count);
  let remainder = totalMinor - base * count;
  const shares: number[] = [];
  for (let i = 0; i < count; i++) {
    shares.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return shares;
}

export function calculateSplit(
  totalAmount: number,
  method: SplitMethod,
  payers: Payer[],
  participants: ParticipantInput[]
): SplitResult {
  if (totalAmount <= 0) {
    throw new SplitValidationError("Expense amount must be greater than zero", "INVALID_AMOUNT");
  }
  if (participants.length === 0) {
    throw new SplitValidationError("At least one participant is required", "NO_PARTICIPANTS");
  }
  if (payers.length === 0) {
    throw new SplitValidationError("At least one payer is required", "NO_PAYERS");
  }

  const totalMinor = toMinor(totalAmount);

  // Validate payers sum to the total (multi-payer support).
  const paidMinorSum = payers.reduce((sum, p) => sum + toMinor(p.amountPaid), 0);
  if (paidMinorSum !== totalMinor) {
    throw new SplitValidationError(
      `Payer amounts (${toMajor(paidMinorSum)}) do not sum to the expense total (${totalAmount})`,
      "PAYER_MISMATCH"
    );
  }

  let resolvedMinor: number[];

  switch (method) {
    case "EQUAL": {
      resolvedMinor = distributeEqually(totalMinor, participants.length);
      break;
    }

    case "EXACT": {
      resolvedMinor = participants.map((p) => {
        if (p.exactAmount === undefined) {
          throw new SplitValidationError(`Missing exact amount for participant ${p.userId}`, "MISSING_EXACT_AMOUNT");
        }
        return toMinor(p.exactAmount);
      });
      const sum = resolvedMinor.reduce((a, b) => a + b, 0);
      if (sum !== totalMinor) {
        throw new SplitValidationError(
          `Exact shares (${toMajor(sum)}) do not sum to the expense total (${totalAmount})`,
          "EXACT_SUM_MISMATCH"
        );
      }
      break;
    }

    case "PERCENTAGE": {
      const percentages = participants.map((p) => {
        if (p.percentage === undefined) {
          throw new SplitValidationError(`Missing percentage for participant ${p.userId}`, "MISSING_PERCENTAGE");
        }
        return p.percentage;
      });
      const percentSum = percentages.reduce((a, b) => a + b, 0);
      if (Math.abs(percentSum - 100) > 0.01) {
        throw new SplitValidationError(`Percentages sum to ${percentSum}, must sum to 100`, "PERCENT_SUM_MISMATCH");
      }
      // Largest-remainder method for penny-accurate rounding.
      resolvedMinor = allocateByWeight(
        totalMinor,
        percentages.map((p) => p)
      );
      break;
    }

    case "SHARES": {
      const units = participants.map((p) => {
        if (!p.shareUnits || p.shareUnits <= 0) {
          throw new SplitValidationError(`Missing/invalid share units for participant ${p.userId}`, "MISSING_SHARE_UNITS");
        }
        return p.shareUnits;
      });
      resolvedMinor = allocateByWeight(totalMinor, units);
      break;
    }

    default:
      throw new SplitValidationError(`Unsupported split method: ${method}`, "UNSUPPORTED_METHOD");
  }

  const resolvedParticipants: ResolvedParticipant[] = participants.map((p, idx) => ({
    userId: p.userId,
    shareAmount: toMajor(resolvedMinor[idx]),
    sharePercent: p.percentage,
    shareUnits: p.shareUnits,
  }));

  // Final reconciliation guard — never let an expense persist unbalanced.
  const finalSum = resolvedMinor.reduce((a, b) => a + b, 0);
  if (finalSum !== totalMinor) {
    throw new SplitValidationError("Internal split reconciliation failed", "RECONCILIATION_FAILURE");
  }

  return {
    totalAmount,
    payers,
    participants: resolvedParticipants,
  };
}

/**
 * Allocates totalMinor proportionally to `weights` using the largest-remainder
 * method, guaranteeing the output sums exactly to totalMinor.
 */
function allocateByWeight(totalMinor: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    throw new SplitValidationError("Weights must sum to a positive number", "INVALID_WEIGHTS");
  }

  const rawShares = weights.map((w) => (totalMinor * w) / weightSum);
  const floorShares = rawShares.map((s) => Math.floor(s));
  let allocated = floorShares.reduce((a, b) => a + b, 0);
  let remaining = totalMinor - allocated;

  const remainders = rawShares
    .map((s, idx) => ({ idx, remainder: s - Math.floor(s) }))
    .sort((a, b) => b.remainder - a.remainder);

  const result = [...floorShares];
  for (let i = 0; i < remaining; i++) {
    result[remainders[i % remainders.length].idx] += 1;
  }

  return result;
}
