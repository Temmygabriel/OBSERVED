/**
 * Policy Engine — the gate everything passes through before money moves.
 *
 * It re-exports the two halves rather than reimplementing them, so there is
 * exactly one implementation of Rule 5 and one of Rule 9 in the codebase. A
 * second copy is how the two drift, and a drifted exclusion check is a reviewer
 * that scores its own entry.
 *
 * `evaluateProject` is the single function the pipeline calls. Read its branch
 * order, because the order IS the policy: exclusion is checked before anything
 * looks at a budget, so an excluded project can never even be quoted a price.
 */

import type { PolicyRefusal } from '@observed/shared-types';
import { checkExclusion, type ProjectIdentity } from './exclusion';
import {
  authorizeSpend,
  computeSpendState,
  dailyCapAlert,
  type AuthorizeInput,
  type LedgerEntry,
  type SpendCaps,
  type SpendDecision,
} from './spend-ledger';

export interface EvaluateInput {
  project: ProjectIdentity;
  exclusion_list: Parameters<typeof checkExclusion>[1];
  /** Rule 9's ledger. Read fresh — a cached ledger is a stale cap. */
  spend_entries: readonly LedgerEntry[];
  caps: SpendCaps;
  now: Date;
  payments_enabled: boolean;
  review_session_id: string;
  provider_hostname: string;
  /** The quoted price of the call being considered. */
  amount: string;
}

export type PolicyDecision =
  | { allowed: true; alerts: string[] }
  | { allowed: false; refusal: PolicyRefusal; rule: 'exclusion_list' | 'spend_cap' | 'payments_disabled' };

/**
 * Rule 5 first, then Rule 9.
 *
 * The exclusion check runs on the project identity, which is available before
 * any quote exists. That ordering is what makes "refused before any money is
 * spent" literally true rather than approximately true: there is no code path
 * where a price is fetched for an excluded project, so there is nothing to
 * unwind.
 */
export function evaluateProject(input: EvaluateInput): PolicyDecision {
  const exclusion = checkExclusion(input.project, input.exclusion_list);
  if (exclusion) {
    return { allowed: false, refusal: exclusion, rule: 'exclusion_list' };
  }

  const decision: SpendDecision = authorizeSpend({
    entries: input.spend_entries,
    caps: input.caps,
    now: input.now,
    paymentsEnabled: input.payments_enabled,
    reviewSessionId: input.review_session_id,
    providerHostname: input.provider_hostname,
    amount: input.amount,
  } satisfies AuthorizeInput);

  if (!decision.allowed) {
    return {
      allowed: false,
      rule: decision.refusal_rule,
      refusal: {
        rule: decision.refusal_rule === 'payments_disabled' ? 'spend_cap' : decision.refusal_rule,
        explanation: decision.reason,
        // A cap pause lifts at the next UTC day boundary; the kill switch does
        // not lift on a schedule, so promising a resume time would be a lie.
        reconsidered_at:
          decision.refusal_rule === 'spend_cap'
            ? computeSpendState(input.spend_entries, input.caps, input.now).resumes_at
            : null,
      },
    };
  }

  // Alerts are informational and never block: the cap check above is what
  // decides. Reporting them alongside an approval keeps the 50% warning from
  // ever being mistaken for a refusal.
  const { shouldAlert, detail } = dailyCapAlert(
    computeSpendState(input.spend_entries, input.caps, input.now),
  );

  return { allowed: true, alerts: shouldAlert ? [detail] : [] };
}

export { checkExclusion, findExclusion } from './exclusion';
export type { ProjectIdentity } from './exclusion';
export {
  authorizeSpend,
  computeSpendState,
  dailyCapAlert,
  recordPayment,
  readLedger,
  DEFAULT_CAPS,
  nextUtcMidnight,
  consumesBudget,
  isInFlight,
} from './spend-ledger';
export type { LedgerEntry, SpendCaps, SpendDecision } from './spend-ledger';
