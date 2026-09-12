/**
 * Rule 9 — hard spend caps, fail closed.
 *
 * The ledger answers one question: "may this paid call happen?" It answers it
 * from an append-only file on disk plus the clock, and it answers NO whenever
 * anything is uncertain. That direction is deliberate. Refusing a call that
 * would have been fine costs a fraction of a cent; allowing a call that should
 * have been refused can cost the whole daily budget in one loop.
 *
 * Two rules inside Rule 9 that are easy to implement wrongly:
 *
 *   1. NO RETRY AFTER AN AMBIGUOUS OUTCOME. If a `buy` call times out, we do
 *      not know whether it settled. The temptation is to retry — the money was
 *      probably not spent. But "probably" is exactly the reasoning that
 *      double-spends. An ambiguous payment is recorded and COUNTED AGAINST THE
 *      BUDGET, and the call is not repeated. `isRetryable` from shared-types
 *      already encodes this; this module is what honours it.
 *
 *   2. ONE PAID CALL IN FLIGHT AT A TIME. Caps are checked against a ledger
 *      that is only accurate once a call's outcome is written. With two calls
 *      in flight, both can pass a check that neither would pass alone. The
 *      ledger therefore serialises: a caller must `record` before the next
 *      `authorize` is meaningful, and `authorize` refuses while an in-flight
 *      entry exists.
 *
 * All arithmetic goes through `decimal.ts`. No float ever compares against a cap.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PaymentStatus, SpendState } from '@observed/shared-types';
import { DEFAULT_SPEND_CAPS } from '@observed/shared-types';
import { compareAmounts, sumAmounts, toUnits, wouldExceedCap } from './decimal';

export interface SpendCaps {
  hourly: string;
  daily: string;
  perReview: string;
  perProviderRequest: string;
  maxPaidCallsPerProviderPerReview: number;
  maxConcurrentPaidCalls: number;
}

export const DEFAULT_CAPS: SpendCaps = {
  hourly: DEFAULT_SPEND_CAPS.hourly,
  daily: DEFAULT_SPEND_CAPS.daily,
  perReview: DEFAULT_SPEND_CAPS.perReview,
  perProviderRequest: DEFAULT_SPEND_CAPS.perProviderRequest,
  maxPaidCallsPerProviderPerReview:
    DEFAULT_SPEND_CAPS.maxPaidCallsPerProviderPerReview,
  maxConcurrentPaidCalls: DEFAULT_SPEND_CAPS.maxConcurrentPaidCalls,
};

/** One line in the append-only ledger file. */
export interface LedgerEntry {
  payment_id: string;
  review_session_id: string;
  provider_hostname: string;
  amount: string;
  status: PaymentStatus;
  /** ISO 8601 UTC — the moment the attempt was recorded, not the settlement. */
  recorded_at: string;
}

/**
 * Statuses that consume budget. `ambiguous_no_retry` is in this list on
 * purpose: the money may well have moved, and a budget that ignores money it
 * might have spent is not a budget.
 *
 * `quoted` is NOT here — a quote moves no money. It is the in-flight marker
 * instead. `failed` is not here either: a clean failure spent nothing.
 */
const BUDGET_CONSUMING: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'settled',
  'ambiguous_no_retry',
]);

/**
 * The one status meaning "a paid call is outstanding".
 *
 * `quoted` is appended before the call and the outcome is appended after it, so
 * it is the only non-terminal value in `PaymentStatus` — every other one is a
 * verdict. This set therefore has exactly one member, and that is a fact about
 * the union rather than a coincidence worth relying on silently.
 */
const IN_FLIGHT: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(['quoted']);

export function consumesBudget(status: PaymentStatus): boolean {
  return BUDGET_CONSUMING.has(status);
}

export function isInFlight(status: PaymentStatus): boolean {
  return IN_FLIGHT.has(status);
}

/**
 * Collapse the append-only log to one entry per payment: the last one written.
 *
 * The ledger records an attempt (`quoted`) before the paid call and the outcome
 * after it, and it can only ever append — there is no update. Read naively, a
 * settled payment therefore appears TWICE: once as outstanding and once as
 * spent. Both readings are wrong in a way that matters. The in-flight count
 * would never fall back to zero, so after the first paid call the concurrency
 * gate would refuse every later one; and a budget that counted the attempt as
 * well as the settlement would double every figure.
 *
 * Collapsing first is what makes "is this payment still outstanding?"
 * answerable at all: a payment is in flight exactly when its most recent entry
 * is still `quoted`.
 *
 * `Map` preserves insertion order, so the collapsed view keeps the ledger's own
 * chronology and two passes over the same file produce the same numbers.
 */
export function latestByPayment(
  entries: readonly LedgerEntry[],
): LedgerEntry[] {
  const latest = new Map<string, LedgerEntry>();
  for (const entry of entries) latest.set(entry.payment_id, entry);
  return [...latest.values()];
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/**
 * Read the ledger. A malformed line is a hard failure, not a skipped line:
 * silently dropping a record we cannot parse is how spend goes missing.
 */
export async function readLedger(path: string): Promise<LedgerEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const entries: LedgerEntry[] = [];
  const lines = text.split('\n');

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed) as LedgerEntry);
    } catch {
      throw new Error(
        `ledger ${path} line ${index + 1} is not valid JSON — refusing to continue with an incomplete view of spend`,
      );
    }
  }

  return entries;
}

/** Append one entry. Never rewrites, never truncates. */
export async function recordPayment(
  path: string,
  entry: LedgerEntry,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

function startOfUtcHour(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      0,
      0,
      0,
    ),
  );
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
}

export function nextUtcMidnight(now: Date): string {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Roll the ledger up into the `SpendState` the UI renders.
 *
 * Reads the collapsed view, so an attempt and its outcome are counted once.
 *
 * `reviews_today` counts distinct review sessions with a budget-consuming
 * entry, not entries — one review makes several paid calls and is still one
 * review.
 */
export function computeSpendState(
  entries: readonly LedgerEntry[],
  caps: SpendCaps,
  now: Date,
): SpendState {
  const hourStart = startOfUtcHour(now).getTime();
  const dayStart = startOfUtcDay(now).getTime();

  const hourly: string[] = [];
  const daily: string[] = [];
  const reviewSessionsToday = new Set<string>();

  for (const entry of latestByPayment(entries)) {
    if (!consumesBudget(entry.status)) continue;

    const at = new Date(entry.recorded_at).getTime();
    if (Number.isNaN(at)) continue;

    if (at >= dayStart) {
      daily.push(entry.amount);
      reviewSessionsToday.add(entry.review_session_id);
    }
    if (at >= hourStart) hourly.push(entry.amount);
  }

  const dailySpent = sumAmounts(daily);
  const hourlySpent = sumAmounts(hourly);

  const dailyReached = compareAmounts(dailySpent, caps.daily) >= 0;
  const hourlyReached = compareAmounts(hourlySpent, caps.hourly) >= 0;
  const paused = dailyReached || hourlyReached;

  return {
    hourly_spent: hourlySpent,
    hourly_cap: caps.hourly,
    daily_spent: dailySpent,
    daily_cap: caps.daily,
    per_review_cap: caps.perReview,
    reviews_today: reviewSessionsToday.size,
    paused,
    paused_reason: dailyReached
      ? 'daily_cap_reached'
      : hourlyReached
        ? 'hourly_cap_reached'
        : null,
    // A pause that never lifts is not a pause. The hourly window rolls over on
    // its own, but the UI promises a specific time, so name the day boundary —
    // it is the later of the two and therefore always true.
    resumes_at: paused ? nextUtcMidnight(now) : null,
  };
}

// ---------------------------------------------------------------------------
// Authorisation — the actual gate
// ---------------------------------------------------------------------------

export type SpendDecision =
  | { allowed: true }
  | { allowed: false; reason: string; refusal_rule: 'spend_cap' | 'payments_disabled' };

export interface AuthorizeInput {
  entries: readonly LedgerEntry[];
  caps: SpendCaps;
  now: Date;
  /** Rule 9: read at call time, never cached at process start (Rule 5.8). */
  paymentsEnabled: boolean;
  reviewSessionId: string;
  providerHostname: string;
  amount: string;
}

/** Paid calls already authorised for this provider within this review. */
function paidCallsForProvider(
  entries: readonly LedgerEntry[],
  reviewSessionId: string,
  providerHostname: string,
): number {
  return latestByPayment(entries).filter(
    (entry) =>
      entry.review_session_id === reviewSessionId &&
      entry.provider_hostname === providerHostname &&
      (consumesBudget(entry.status) || isInFlight(entry.status)),
  ).length;
}

function spendForReview(
  entries: readonly LedgerEntry[],
  reviewSessionId: string,
): string {
  return sumAmounts(
    latestByPayment(entries)
      .filter(
        (entry) =>
          entry.review_session_id === reviewSessionId &&
          consumesBudget(entry.status),
      )
      .map((entry) => entry.amount),
  );
}

/**
 * May this paid call happen? Every branch that is not an explicit yes is a no.
 *
 * The checks are ordered cheapest-and-most-absolute first, so the log line for
 * a refusal names the real reason rather than the first cap that happened to
 * be reached.
 */
export function authorizeSpend(input: AuthorizeInput): SpendDecision {
  // 5.8 Kill switch. Checked here, per call, from the live value.
  if (!input.paymentsEnabled) {
    return {
      allowed: false,
      reason:
        'PAYMENTS_ENABLED is false. The kill switch is on, so no paid call is made.',
      refusal_rule: 'payments_disabled',
    };
  }

  const { caps, entries, now } = input;

  // A single request that costs more than the per-request cap is refused before
  // any budget is considered — otherwise a large quote could consume a whole
  // day's allowance in one call.
  if (compareAmounts(input.amount, caps.perProviderRequest) > 0) {
    return {
      allowed: false,
      reason: `quote ${input.amount} exceeds the per-request cap of ${caps.perProviderRequest}`,
      refusal_rule: 'spend_cap',
    };
  }

  // Rule 9's concurrency limit. Computed from in-flight ENTRIES, not from a
  // counter held in memory, so a restart cannot lose the fact that a call is
  // outstanding. Collapsed first: an attempt that has since been given an
  // outcome is no longer outstanding, and counting it would wedge the gate shut
  // permanently after the very first paid call.
  const inFlight = latestByPayment(entries).filter((entry) =>
    isInFlight(entry.status),
  ).length;
  if (inFlight >= caps.maxConcurrentPaidCalls) {
    return {
      allowed: false,
      reason: `${inFlight} paid call(s) already in flight, limit is ${caps.maxConcurrentPaidCalls}`,
      refusal_rule: 'spend_cap',
    };
  }

  const perProvider = paidCallsForProvider(
    entries,
    input.reviewSessionId,
    input.providerHostname,
  );
  if (perProvider >= caps.maxPaidCallsPerProviderPerReview) {
    return {
      allowed: false,
      reason: `${input.providerHostname} has already been paid ${perProvider} time(s) in this review, limit is ${caps.maxPaidCallsPerProviderPerReview}`,
      refusal_rule: 'spend_cap',
    };
  }

  const reviewSpent = spendForReview(entries, input.reviewSessionId);
  if (wouldExceedCap(reviewSpent, input.amount, caps.perReview)) {
    return {
      allowed: false,
      reason: `this review has spent ${reviewSpent} of its ${caps.perReview} cap`,
      refusal_rule: 'spend_cap',
    };
  }

  const state = computeSpendState(entries, caps, now);
  if (wouldExceedCap(state.hourly_spent, input.amount, caps.hourly)) {
    return {
      allowed: false,
      reason: `hourly spend ${state.hourly_spent} of ${caps.hourly} would be exceeded by this ${input.amount} call`,
      refusal_rule: 'spend_cap',
    };
  }
  if (wouldExceedCap(state.daily_spent, input.amount, caps.daily)) {
    return {
      allowed: false,
      reason: `daily spend ${state.daily_spent} of ${caps.daily} would be exceeded by this ${input.amount} call`,
      refusal_rule: 'spend_cap',
    };
  }

  return { allowed: true };
}

/**
 * The budget consumed so far today, for the Rule 9 "alert at 50% of daily cap"
 * requirement.
 *
 * The comparison is `spent * denominator >= cap * numerator`, done in BigInt
 * micro-units — not `spent / cap >= 0.5`. Dividing first would introduce a
 * float at exactly the point where being wrong matters, and 49.9999% rendering
 * as "50% used" is the kind of near-miss that erodes trust in the number.
 */
export function dailyCapAlert(
  state: SpendState,
  threshold: { numerator: bigint; denominator: bigint } = {
    numerator: 1n,
    denominator: 2n,
  },
): { shouldAlert: boolean; detail: string } {
  const spent = toUnits(state.daily_spent);
  const cap = toUnits(state.daily_cap);

  if (cap === 0n) {
    return { shouldAlert: false, detail: 'daily cap is zero; no spend is possible' };
  }

  const shouldAlert =
    spent * threshold.denominator >= cap * threshold.numerator;

  // Integer percentage, rounded down, computed in BigInt — display only.
  const percent = (spent * 100n) / cap;

  return {
    shouldAlert,
    detail: `${state.daily_spent} of ${state.daily_cap} used (${percent}%)`,
  };
}
