import type { Metadata } from 'next';
import type {
  ProbeState,
  PublicStatusResponse,
  WatchdogState,
} from '@observed/shared-types';
import { inactivityAlertMessage } from '@observed/shared-types';
import { RelativeTime } from '@/components/RelativeTime';
import { getPublicStatus } from '@/lib/data';

export const metadata: Metadata = { title: 'Status' };

/**
 * Screen 8 — Status.
 *
 * Rule 12 is the reason this page exists. The watchdog does not alert on
 * "is the process running" — a crashed process is loud and obvious. It alerts
 * on BUSINESS inactivity: no successful review in N minutes while the process
 * is cheerfully alive. That is the silent failure, and it is the one this page
 * is built to make impossible to miss.
 *
 * Note that `getPublicStatus` never returns "unavailable". A status page that
 * cannot report its own unavailability is useless, so when the worker is
 * unreachable the page degrades to BLOCKED with an explicit reason rather than
 * showing nothing.
 */

const WATCHDOG_LABELS: Record<WatchdogState, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  BLOCKED: 'Blocked',
  RECOVERING: 'Recovering',
};

/** Only HEALTHY reads as anything other than "look at me". */
function watchdogTone(state: WatchdogState): string {
  return state === 'HEALTHY' ? 'ok' : 'down';
}

const PROBE_LABELS: Record<ProbeState, string> = {
  ok: 'ok',
  degraded: 'degraded',
  down: 'down',
  unknown: 'unknown',
};

function Watchdog({ status }: { status: PublicStatusResponse }) {
  const tone = watchdogTone(status.watchdog_state);

  return (
    <section className="state">
      <div className="row" style={{ marginBottom: 'var(--s3)' }}>
        <span className={`probe__state probe__state--${tone}`}>
          {WATCHDOG_LABELS[status.watchdog_state]}
        </span>
        <h2 className="state__title" style={{ margin: 0 }}>
          Watchdog
        </h2>
      </div>

      <p className="state__body">
        {status.degraded_reason ??
          'The reviewer is running and its last attempt succeeded.'}
      </p>

      <dl className="kv" style={{ maxWidth: '420px' }}>
        <dt className="kv__key">Payments</dt>
        <dd className="kv__val">
          {status.payments_enabled ? 'enabled' : 'disabled'}
        </dd>

        <dt className="kv__key">Last successful review</dt>
        <dd className="kv__val">
          {status.last_successful_review_at ? (
            <RelativeTime iso={status.last_successful_review_at} />
          ) : (
            'none recorded'
          )}
        </dd>

        {/* The Rule 12 metric, stated as the metric itself rather than as a
            raw timestamp the reader has to subtract from in their head. */}
        <dt className="kv__key">Inactivity</dt>
        <dd className="kv__val">
          {status.minutes_since_last_review === null
            ? `no successful review recorded; alerts at ${inactivityAlertMessage(
                status.inactivity_alert_minutes,
              )}`
            : `${status.minutes_since_last_review} min since last successful review · alerts at ${
                status.inactivity_alert_minutes
              } min`}
        </dd>

        <dt className="kv__key">Spend today</dt>
        <dd className="kv__val">
          ${status.spend.daily_spent} of ${status.spend.daily_cap} ·{' '}
          {status.spend.reviews_today} reviews
        </dd>
      </dl>
    </section>
  );
}

export default async function StatusPage() {
  const status = await getPublicStatus();

  return (
    <div className="stack">
      <header className="stack stack--tight">
        <h1 className="h1">Status</h1>
        <p className="lede">
          What Observed is doing right now, including when the answer is
          &ldquo;nothing&rdquo;.
        </p>
      </header>

      <Watchdog status={status} />

      <section className="stack stack--tight">
        <p className="section-label">Checks</p>

        <div>
          {status.probes.map((probe) => (
            <div key={probe.name} className="probe">
              <span className="probe__name">{probe.name}</span>
              <span className="probe__detail">{probe.detail ?? ''}</span>
              <span className={`probe__state probe__state--${probe.state}`}>
                {PROBE_LABELS[probe.state]}
              </span>
            </div>
          ))}
        </div>

        {/* "unknown" is not a soft pass. Saying so explicitly is the whole
            point of reporting a tri-state at all. */}
        <p className="meta" style={{ margin: 0 }}>
          A check reported as <span className="mono">unknown</span> has not been
          verified. It is not a pass.
        </p>
      </section>
    </div>
  );
}
