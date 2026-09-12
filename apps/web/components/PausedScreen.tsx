import type { PolicyRefusal, SpendState } from '@observed/shared-types';

/**
 * Screen 6 — Paused (spend cap reached).
 *
 * Same calm, non-alarmist voice as the rest of the product. This is Rule 9
 * working exactly as designed, so there is no error styling here: no detected-
 * amber, no alert icon, no apology. A system that stops itself at its own
 * limit is a system behaving correctly.
 *
 * The numbers are the real ledger values. Nothing on this screen is estimated.
 */
export function PausedScreen({
  spend,
  refusal,
}: {
  spend: SpendState;
  refusal: PolicyRefusal | null;
}) {
  const resumesAt = spend.resumes_at ?? refusal?.reconsidered_at ?? null;

  return (
    <section className="state">
      <h2 className="state__title">Paused</h2>

      <p className="state__body">
        {resumesAt
          ? `Daily review budget reached. Resuming at ${formatResume(resumesAt)}.`
          : 'Daily review budget reached. Observed stops spending rather than exceeding its cap.'}
      </p>

      <dl className="kv" style={{ maxWidth: '360px' }}>
        <dt className="kv__key">Reviews today</dt>
        <dd className="kv__val">{spend.reviews_today}</dd>

        <dt className="kv__key">Spend today</dt>
        <dd className="kv__val">
          ${spend.daily_spent} of ${spend.daily_cap}
        </dd>

        <dt className="kv__key">This hour</dt>
        <dd className="kv__val">
          ${spend.hourly_spent} of ${spend.hourly_cap}
        </dd>

        <dt className="kv__key">Per review cap</dt>
        <dd className="kv__val">${spend.per_review_cap}</dd>
      </dl>
    </section>
  );
}

/** Renders "00:00 UTC" from an ISO boundary, rather than echoing the raw ISO. */
function formatResume(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'the next UTC day boundary';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes} UTC`;
}
