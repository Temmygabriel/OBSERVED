/**
 * Evidence Worker — the orchestrator for collectors.
 *
 * Owns NO wallet and NO AskBots key. It resolves the target once through the
 * SSRF guard, runs the collectors it was told to run, and returns typed
 * artifacts. Deciding what they mean, and paying for anything, both happen
 * somewhere else.
 *
 * The behaviour worth reading carefully is the failure handling. A collector
 * that fails for OUR reasons (`CollectorNotImplementedError`, or a missing paid
 * fetch) is NOT converted into an evidence artifact. Only failures that are
 * genuinely observations about the target become artifacts, and those are
 * already classified by the collector itself. Everything else propagates, so a
 * gap in our own code can never be displayed as a fact about someone's project.
 */

import type { CollectorKind, EvidenceArtifact } from '@observed/shared-types';
import { ResolutionFailedError, assertPublicTarget, type Resolver } from './ssrf-guard';
import { dnsCollector } from './collectors/dns';
import { htmlCollector } from './collectors/html';
import { repoCollector } from './collectors/repo';
import { screenshotCollector } from './collectors/screenshot';
import { tlsCollector } from './collectors/tls';
import {
  CollectorNotImplementedError,
  MissingPaidFetchError,
  type Collector,
  type CollectorContext,
  type PaidFetchResult,
} from './collectors/types';

export const COLLECTORS: Record<CollectorKind, Collector> = {
  html: htmlCollector,
  tls: tlsCollector,
  dns: dnsCollector,
  screenshot: screenshotCollector,
  repo: repoCollector,
};

/**
 * Which collectors run by default.
 *
 * `screenshot` is absent because it is the one that costs money, and money is
 * spent by the Payment Worker on an explicit decision — never as a side effect
 * of "run the default set".
 */
export const DEFAULT_COLLECTORS: readonly CollectorKind[] = ['dns', 'html', 'tls'];

export interface CollectInput {
  review_session_id: string;
  target_url: string;
  resolve: Resolver;
  storeRaw: CollectorContext['storeRaw'];
  /** Paid results, keyed by collector kind. The orchestrator never buys. */
  paid_fetches?: Partial<Record<CollectorKind, PaidFetchResult>>;
  collectors?: readonly CollectorKind[];
  timeout_ms?: number;
  now?: () => Date;
}

export interface CollectResult {
  artifacts: EvidenceArtifact[];
  /** Collectors that produced no artifact, with the reason. Never silent. */
  skipped: { collector: CollectorKind; reason: string }[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Run the collectors.
 *
 * Rule 4 is applied to the target BEFORE anything is fetched, so a project
 * pointing at private address space is refused at the door rather than being
 * partially observed. The DNS collector still runs for such a target — the fact
 * that it resolves to a private address is a finding worth recording, and it is
 * recorded without a single outbound connection to that address.
 */
export async function collectEvidence(input: CollectInput): Promise<CollectResult> {
  const now = input.now ?? (() => new Date());
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const kinds = input.collectors ?? DEFAULT_COLLECTORS;

  const artifacts: EvidenceArtifact[] = [];
  const skipped: { collector: CollectorKind; reason: string }[] = [];

  for (const kind of kinds) {
    const collector = COLLECTORS[kind];
    if (!collector) {
      skipped.push({ collector: kind, reason: 'no collector is registered' });
      continue;
    }

    // Rule 4, per collector and per target. Cheap, and it means a future
    // collector added without its own guard is still covered.
    try {
      await assertPublicTarget(input.target_url, input.resolve);
    } catch (error) {
      // Two different refusals, and only one of them is a reason to skip.
      //
      // `dns` always runs: it reports the address rather than connecting to it,
      // so a target pointing into private space is a finding it can state
      // without a single packet sent that way.
      //
      // A resolution failure is not a property of the target at all — our
      // resolver did not answer. Skipping would leave an unexplained gap in the
      // evidence set; running the collector is what produces the honest
      // `unknown_*` record instead. Everything else is a target we will not
      // touch, and there is nothing to observe.
      const isTargetRefusal = !(error instanceof ResolutionFailedError);

      if (kind === 'dns' || !isTargetRefusal) {
        artifacts.push(await runCollector(collector, input, now, timeoutMs));
      } else {
        skipped.push({
          collector: kind,
          reason: error instanceof Error ? error.message : 'blocked by the SSRF guard',
        });
      }
      continue;
    }

    if (collector.requires_paid_fetch && !input.paid_fetches?.[kind]) {
      // Not a failure to report as an observation — a decision that has not
      // been made yet. The orchestrator's caller buys, then re-runs.
      skipped.push({
        collector: kind,
        reason: 'requires a paid fetch that has not been authorised yet',
      });
      continue;
    }

    try {
      artifacts.push(await runCollector(collector, input, now, timeoutMs));
    } catch (error) {
      // Our own bugs must not become facts about the target.
      if (
        error instanceof CollectorNotImplementedError ||
        error instanceof MissingPaidFetchError
      ) {
        throw error;
      }
      skipped.push({
        collector: kind,
        reason: error instanceof Error ? error.message : 'collector threw',
      });
    }
  }

  return { artifacts, skipped };
}

async function runCollector(
  collector: Collector,
  input: CollectInput,
  now: () => Date,
  timeoutMs: number,
): Promise<EvidenceArtifact> {
  const paidFetch = input.paid_fetches?.[collector.kind];

  const context: CollectorContext = {
    review_session_id: input.review_session_id,
    target_url: input.target_url,
    resolve: input.resolve,
    now,
    storeRaw: input.storeRaw,
    timeout_ms: timeoutMs,
    ...(paidFetch ? { paid_fetch: paidFetch } : {}),
  };

  return collector.collect(context);
}

/**
 * The collectors that are actually written, for the /readyz probe.
 *
 * Stated as a literal rather than inferred, because "is this collector
 * finished" is not a question the type system can answer — it is a fact about
 * the repository. Keeping it in one named place means the /readyz output is
 * either right or visibly stale, and never quietly optimistic.
 */
export const IMPLEMENTED_COLLECTORS: readonly CollectorKind[] = [
  'dns',
  'html',
  'tls',
];

export type { Collector, CollectorContext, PaidFetchResult };
export { CollectorNotImplementedError, MissingPaidFetchError };
export { assertPublicTarget, assertRedirectHop, MAX_REDIRECT_HOPS } from './ssrf-guard';
