/**
 * The worker's HTTP surface.
 *
 * Only two things here are real, and the honesty of the third is the point:
 *
 *   /healthz  — is this process alive. Cheap, no dependencies. This is the one
 *               endpoint a platform's liveness check should use.
 *   /readyz   — can this process do its job. Checks dependencies. This is the
 *               one a load balancer should use, and the two are different
 *               questions that are routinely conflated.
 *   /status   — the public watchdog mirror the web app's /status page reads.
 *   /reviews  — NOT IMPLEMENTED. Answers 503 with a reason.
 *
 * The `/reviews` behaviour is deliberate rather than lazy. The web app treats a
 * non-2xx response as "worker is up, but has nothing to give me" and renders
 * that reason verbatim. Serving an empty list instead would make the History
 * screen claim "no reviews yet" — which is a fact about the world — when the
 * truth is "this endpoint does not exist yet", which is a fact about the code.
 * Rule 12's whole premise is that those two must never be confused.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { PublicStatusResponse, SpendState } from '@observed/shared-types';
import {
  INACTIVITY_ALERT_MINUTES,
  AUDIT_LEDGER_PATH,
  PORT,
  SPEND_CAP_DAILY,
  SPEND_CAP_HOURLY,
  SPEND_CAP_PER_REVIEW,
  SPEND_LEDGER_PATH,
  ASKBOTS_API_KEY,
  ATTRIBUTION_TAG,
  BUY_MCP_ENDPOINT,
  hasWalletKey,
  paymentsEnabled,
} from './config';
import { IMPLEMENTED_COLLECTORS } from './evidence-worker';
import { DEFAULT_CAPS, computeSpendState, readLedger } from './policy-engine';
import { readChain, verifyChain } from './audit-ledger';
import { runWatchdog, type ProbeDefinition } from './watchdog';

/** The caps this process is actually enforcing, from the environment. */
const CAPS = {
  ...DEFAULT_CAPS,
  hourly: SPEND_CAP_HOURLY,
  daily: SPEND_CAP_DAILY,
  perReview: SPEND_CAP_PER_REVIEW,
};

function emptySpend(): SpendState {
  return {
    hourly_spent: '0',
    hourly_cap: CAPS.hourly,
    daily_spent: '0',
    daily_cap: CAPS.daily,
    per_review_cap: CAPS.perReview,
    reviews_today: 0,
    paused: false,
    paused_reason: null,
    resumes_at: null,
  };
}

/**
 * The probes. Every one of these reports a BUSINESS fact, not a process fact.
 *
 * Note what is absent: there is no "is the event loop responsive" probe. That
 * question is answered by /healthz, and duplicating it here would pad the list
 * with checks that cannot fail, which makes the list look healthier than it is.
 */
const PROBES: readonly ProbeDefinition[] = [
  {
    name: 'Worker public API',
    run: async () => ({ state: 'ok', detail: 'this process is serving requests' }),
  },
  {
    name: 'Evidence collectors',
    run: async () => {
      const ready = IMPLEMENTED_COLLECTORS;
      return ready.length === 0
        ? { state: 'down', detail: 'no collector is implemented yet' }
        : {
            state: 'degraded',
            detail: `implemented: ${ready.join(', ')} — the rest are not written yet`,
          };
    },
  },
  {
    name: 'AskBots authenticated path',
    run: async () =>
      ASKBOTS_API_KEY
        ? { state: 'unknown', detail: 'key present but the authenticated path has not been exercised' }
        : { state: 'unknown', detail: 'ASKBOTS_API_KEY is not set' },
  },
  {
    name: 'buy MCP process',
    run: async () =>
      BUY_MCP_ENDPOINT
        ? { state: 'unknown', detail: 'endpoint configured; the paid path has not been exercised' }
        : { state: 'unknown', detail: 'BUY_MCP_ENDPOINT is not set' },
  },
  {
    name: 'Wallet',
    run: async () =>
      hasWalletKey()
        ? { state: 'unknown', detail: 'key present and never logged; balance not yet read' }
        : { state: 'unknown', detail: 'BUY_WALLET_PRIVATE_KEY is not set' },
  },
  {
    name: 'Attribution config (Rule 8)',
    run: async () =>
      ATTRIBUTION_TAG
        ? { state: 'ok', detail: 'attribution tag is configured' }
        : {
            state: 'down',
            detail:
              'no attribution tag has been issued, so no mainnet transaction may be made (Rule 8)',
          },
  },
  {
    name: 'Celo x402 /settle',
    run: async () => ({
      state: 'unknown',
      // The spec's warning, surfaced where someone will read it: the cheap
      // checks passing proves nothing about /settle, which needs its own key.
      detail:
        'not probed — /verify and /supported can report healthy while /settle fails, so this needs its own check',
    }),
  },
  {
    name: 'Audit ledger chain',
    run: async () => {
      try {
        const entries = await readChain(AUDIT_LEDGER_PATH);
        const result = verifyChain(entries);
        return result.valid
          ? {
              state: 'ok' as const,
              detail:
                entries.length === 0
                  ? 'chain is empty and valid'
                  : `${result.length} entries verified`,
            }
          : {
              state: 'down' as const,
              detail: `chain broken at entry ${result.broken_at}: ${result.reason}`,
            };
      } catch (error) {
        // An unreadable ledger is a hard failure: an unverifiable audit trail
        // is worse than none, because it is trusted.
        return {
          state: 'down' as const,
          detail: error instanceof Error ? error.message : 'ledger could not be read',
        };
      }
    },
  },
];

async function buildStatus(): Promise<PublicStatusResponse> {
  let spend: SpendState;
  try {
    const entries = await readLedger(SPEND_LEDGER_PATH);
    spend = computeSpendState(entries, CAPS, new Date());
  } catch {
    // A spend ledger we cannot read is not a zero-spend ledger. Reporting 0
    // would understate what has been spent, which is the direction that lets a
    // cap be exceeded.
    spend = {
      ...emptySpend(),
      paused: true,
      paused_reason: 'daily_cap_reached',
    };
  }

  return runWatchdog({
    probes: PROBES,
    spend,
    paymentsEnabled: paymentsEnabled(),
    // No review has completed yet, so this is honestly null rather than a
    // fabricated timestamp. Rule 12 reads null as the worst case.
    lastSuccessfulReviewAt: null,
    inactivityAlertMinutes: INACTIVITY_ALERT_MINUTES,
    now: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function sendJson(response: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'only GET is supported' });
    return;
  }

  // Liveness: is this process alive. Touches nothing else on purpose — a
  // liveness check that fails because a dependency is down will restart a
  // healthy process, which fixes nothing and loses in-flight work.
  if (path === '/healthz') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (path === '/status') {
    sendJson(response, 200, await buildStatus());
    return;
  }

  if (path === '/readyz') {
    const status = await buildStatus();
    const failing = status.probes.filter((probe) => probe.state === 'down');
    sendJson(response, failing.length === 0 ? 200 : 503, {
      ready: failing.length === 0,
      watchdog_state: status.watchdog_state,
      failing: failing.map((probe) => ({ name: probe.name, detail: probe.detail })),
    });
    return;
  }

  if (path === '/reviews') {
    sendJson(response, 503, {
      error:
        'The reviews index is not implemented yet. The evidence store and the review pipeline exist, but nothing has been wired to this endpoint.',
    });
    return;
  }

  if (path.startsWith('/reviews/')) {
    sendJson(response, 503, {
      error:
        'Individual reviews are not served yet. No review has been run to completion, so there is nothing to look up.',
    });
    return;
  }

  sendJson(response, 404, { error: `no route for ${path}` });
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    // A handler that throws must still answer, or the client hangs until its
    // own timeout and the failure looks like a network problem.
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'unhandled error',
    });
  });
});

server.listen(PORT, () => {
  // Rule 11: this line names which secrets are PRESENT, never their values.
  console.log(
    `observed worker listening on :${PORT} — payments ${paymentsEnabled() ? 'enabled' : 'DISABLED'}`,
  );
});
