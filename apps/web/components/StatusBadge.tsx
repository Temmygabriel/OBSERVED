import type { BadgeState } from '@observed/shared-types';

/**
 * StatusBadge — the colour pairing is FIXED per state (design spec Section 6).
 *
 *   Accepted                     -> confirmed-green pair
 *   Rewritten / Observed / Live  -> evidence-blue pair
 *   Detected / held / error      -> detected-amber pair
 *   Unable to verify             -> neutral, no accent
 *
 * Two rules that matter and are easy to get wrong:
 *   - "Rewritten" must never use detected-amber. Self-correction is not failure.
 *   - There is no fourth accent colour. "Unable to verify" is ink-on-paper with
 *     a hairline border, because uncertainty is not a verdict.
 */

const LABELS: Record<BadgeState, string> = {
  accepted: 'Accepted',
  rewritten: 'Rewritten',
  observed: 'Observed',
  live: 'Live',
  detected: 'Detected',
  held: 'Review held',
  unable: 'Unable to verify',
};

export function StatusBadge({ state }: { state: BadgeState }) {
  return <span className={`badge badge--${state}`}>{LABELS[state]}</span>;
}

export { LABELS as BADGE_LABELS };
