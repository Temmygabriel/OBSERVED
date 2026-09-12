/**
 * Watchdog — Rules 7 and 12.
 *
 * The failure this exists to catch is NOT a crashed process. A crash is loud:
 * the host restarts it, the logs show a stack trace, someone notices.
 *
 * The failure that actually bites is a process that is perfectly alive and has
 * silently stopped doing its job — the poll loop is returning zero projects
 * because the API key expired, the `buy` MCP child died and every paid call is
 * being skipped, `/settle` is failing while `/verify` still reports healthy.
 * Every dashboard says green. The reviewer has reviewed nothing for six hours.
 *
 * So the probes below are BUSINESS probes, and the alert condition is business
 * inactivity — `inactivityAlertMessage(minutes)` from shared-types, verbatim.
 * The wording is fixed by the spec because "reviewer inactive for 90 minutes"
 * is a sentence someone can act on, and "process healthy" is not.
 */

import type {
  ProbeState,
  PublicStatusResponse,
  SpendState,
  StatusProbe,
  WatchdogState,
} from '@observed/shared-types';
import { inactivityAlertMessage } from '@observed/shared-types';

/** A probe is a named check plus the function that runs it. */
export interface ProbeDefinition {
  name: string;
  /** Must never throw — a probe that throws is a probe reporting `down`. */
  run: () => Promise<{ state: ProbeState; detail: string | null }>;
}

export interface WatchdogInput {
  probes: readonly ProbeDefinition[];
  spend: SpendState;
  paymentsEnabled: boolean;
  lastSuccessfulReviewAt: string | null;
  inactivityAlertMinutes: number;
  now: Date;
  /** Set by the recovery path when a previously-failing probe starts passing. */
  recovering?: boolean;
}

/**
 * What the state machine actually reads: the probe RESULTS, not the probe
 * definitions.
 *
 * These are two different types on purpose. A `ProbeDefinition` is a thing to
 * run and has no `.state`; a `StatusProbe` is a result and has nothing to run.
 * Keeping them apart is what makes it impossible to compute the state from
 * unchecked definitions — which would report HEALTHY on the strength of probes
 * that had not been executed yet.
 */
export interface WatchdogFacts {
  probes: readonly StatusProbe[];
  paymentsEnabled: boolean;
  lastSuccessfulReviewAt: string | null;
  inactivityAlertMinutes: number;
  now: Date;
  recovering?: boolean;
}

/**
 * The state machine: HEALTHY → DEGRADED → BLOCKED → RECOVERING → HEALTHY.
 *
 * The ordering of the branches IS the policy, so it is worth reading:
 *
 *   BLOCKED  — the business has stopped. Either nothing has succeeded for
 *              longer than the inactivity window, or the kill switch is on, or
 *              a probe is outright down.
 *   DEGRADED — something is wrong but the business is still moving. Note that
 *              `unknown` lands here, never in HEALTHY: an unverified check is
 *              not a passing check.
 *   RECOVERING — everything passes, but a failure happened recently enough that
 *              we do not yet claim health. This exists so the transition out of
 *              BLOCKED is not an instant, unearned "all clear".
 *   HEALTHY  — every probe ok AND a successful review inside the window.
 */
export function deriveState(facts: WatchdogFacts): WatchdogState {
  const { probes, now, inactivityAlertMinutes, lastSuccessfulReviewAt } = facts;

  const hasDown = probes.some((probe) => probe.state === 'down');
  const hasDegraded = probes.some(
    (probe) => probe.state === 'degraded' || probe.state === 'unknown',
  );

  if (!facts.paymentsEnabled) return 'BLOCKED';
  if (hasDown) return 'BLOCKED';

  const minutesSince = minutesSinceLastReview(lastSuccessfulReviewAt, now);

  // Rule 12's actual condition. `null` means no successful review has EVER been
  // recorded — for a running reviewer that is the worst case, not an unknown.
  if (minutesSince === null || minutesSince > inactivityAlertMinutes) {
    return 'BLOCKED';
  }

  if (hasDegraded) return 'DEGRADED';
  if (facts.recovering) return 'RECOVERING';
  return 'HEALTHY';
}

export function minutesSinceLastReview(
  lastSuccessfulReviewAt: string | null,
  now: Date,
): number | null {
  if (lastSuccessfulReviewAt === null) return null;
  const then = new Date(lastSuccessfulReviewAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 60_000));
}

/** The operator-facing alert, or null when there is nothing to say. */
export function inactivityAlert(
  state: WatchdogState,
  minutesSince: number | null,
  inactivityAlertMinutes: number,
): string | null {
  if (state !== 'BLOCKED') return null;
  if (minutesSince === null) {
    return `no successful review has ever been recorded — ${inactivityAlertMessage(
      inactivityAlertMinutes,
    )} is the alert threshold`;
  }
  if (minutesSince > inactivityAlertMinutes) {
    return inactivityAlertMessage(minutesSince);
  }
  return null;
}

function degradedReason(
  state: WatchdogState,
  probes: readonly StatusProbe[],
  minutesSince: number | null,
  inactivityAlertMinutes: number,
  paymentsEnabled: boolean,
): string | null {
  if (state === 'HEALTHY') return null;

  if (!paymentsEnabled) {
    return 'PAYMENTS_ENABLED is false. The kill switch is on: no paid call is being made, so no review can complete.';
  }

  const down = probes.filter((probe) => probe.state === 'down');
  if (down.length > 0) {
    return `${down.map((probe) => probe.name).join(', ')} reported down.`;
  }

  const alert = inactivityAlert(state, minutesSince, inactivityAlertMinutes);
  if (alert) {
    return `${alert}. The process is running; the business is not.`;
  }

  const unsure = probes.filter(
    (probe) => probe.state === 'unknown' || probe.state === 'degraded',
  );
  if (unsure.length > 0) {
    return `${unsure
      .map((probe) => probe.name)
      .join(', ')} could not be verified. An unverified check is not a passing check.`;
  }

  if (state === 'RECOVERING') {
    return 'Checks are passing again. Holding at RECOVERING until a successful review confirms it.';
  }

  return null;
}

/**
 * Run every probe and assemble the public status.
 *
 * A probe that throws is recorded as `down` with the error message as its
 * detail — never as `ok`, and never omitted. An exception escaping a probe is
 * information about the system, and swallowing it would be the exact silent
 * failure this module is built to prevent.
 */
export async function runWatchdog(
  input: WatchdogInput,
): Promise<PublicStatusResponse> {
  const probes: StatusProbe[] = [];

  for (const definition of input.probes) {
    const checkedAt = input.now.toISOString();
    try {
      const result = await definition.run();
      probes.push({
        name: definition.name,
        state: result.state,
        detail: result.detail,
        checked_at: checkedAt,
      });
    } catch (error) {
      probes.push({
        name: definition.name,
        state: 'down',
        detail: `probe threw: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
        checked_at: checkedAt,
      });
    }
  }

  const minutesSince = minutesSinceLastReview(
    input.lastSuccessfulReviewAt,
    input.now,
  );

  const state = deriveState({
    probes,
    paymentsEnabled: input.paymentsEnabled,
    lastSuccessfulReviewAt: input.lastSuccessfulReviewAt,
    inactivityAlertMinutes: input.inactivityAlertMinutes,
    now: input.now,
    recovering: input.recovering,
  });

  return {
    watchdog_state: state,
    payments_enabled: input.paymentsEnabled,
    last_successful_review_at: input.lastSuccessfulReviewAt,
    minutes_since_last_review: minutesSince,
    inactivity_alert_minutes: input.inactivityAlertMinutes,
    degraded_reason: degradedReason(
      state,
      probes,
      minutesSince,
      input.inactivityAlertMinutes,
      input.paymentsEnabled,
    ),
    spend: input.spend,
    probes,
  };
}
