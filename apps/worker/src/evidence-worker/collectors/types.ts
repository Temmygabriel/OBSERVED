/**
 * The collector contract.
 *
 * A collector fetches one thing and normalizes it into an `EvidenceArtifact`.
 * It never interprets meaning — deciding what an observation *means* is the
 * Review Generator's job, and Rule 2 keeps those two apart on purpose.
 *
 * The boundary that matters is in the types below. `CollectorContext` has NO
 * payment capability. A collector cannot buy anything, cannot reach a wallet,
 * and cannot see the AskBots key — the screenshot collector receives an
 * already-purchased `PaidFetchResult` and can only hash and describe it. That
 * is the spec's "Evidence Worker has no wallet" requirement, expressed as
 * something the compiler enforces rather than something a comment promises.
 */

import type { CollectorKind, EvidenceArtifact } from '@observed/shared-types';
import type { Resolver } from '../ssrf-guard';

/**
 * The RESULT of a paid fetch. Deliberately a value, not a function: handing a
 * collector a result it cannot re-invoke is what makes "a collector cannot
 * spend money" a property of the type rather than of the reviewer's attention.
 */
export interface PaidFetchResult {
  provider_hostname: string;
  path: string;
  status_code: number;
  content_type: string | null;
  body: Uint8Array;
  provider_request_id: string | null;
  elapsed_ms: number;
}

export interface CollectorContext {
  review_session_id: string;
  target_url: string;
  /**
   * The project's declared source repository, when it published one.
   *
   * Deliberately separate from `target_url`, because they are different
   * subjects: the website is what `html`/`tls`/`dns` observe, and the repository
   * is what `repo` observes. The artifact a collector returns names the subject
   * it is actually about, so a citation cannot confuse the two.
   *
   * Absent means the project declared no repository. That is not a finding, so
   * `repo` returns no artifact at all rather than an `invalid` one.
   */
  repo_url?: string;
  /** Injected so the SSRF guard's resolution can be stubbed in a test. */
  resolve: Resolver;
  now: () => Date;
  /**
   * Raw artifacts (screenshots, HTML dumps) are stored out of band. Only the
   * hash and the metadata reach the LLM.
   */
  storeRaw: (
    suggested_name: string,
    bytes: Uint8Array,
    content_type: string,
  ) => Promise<string>;
  timeout_ms: number;
  /** Present only for collectors whose `requires_paid_fetch` is true. */
  paid_fetch?: PaidFetchResult;
}

export interface Collector {
  kind: CollectorKind;
  version: string;
  /** True for `screenshot`, which runs against a `buy`-purchased endpoint. */
  requires_paid_fetch: boolean;
  /**
   * One observation pass.
   *
   * Returns one artifact, or SEVERAL when a single pass has parts that must not
   * share a status. The HTML collector is the only one that does: its link sweep
   * produces an artifact per link, because folding "three links are broken" into
   * the page's own status would destroy the tri-state. A page can be perfectly
   * live while three of its links are unreachable, and the two facts are
   * separately citable.
   */
  collect: (
    context: CollectorContext,
  ) => Promise<EvidenceArtifact | EvidenceArtifact[]>;
}

/**
 * The tri-state helper every collector must route its outcome through.
 *
 * Rule 3: a network failure is `unknown_*`, never `invalid`. Conflating the two
 * would turn "we could not reach it" into "it is broken", which is the single
 * most damaging bug this codebase could ship — it is the exact behaviour the
 * product exists to be the opposite of.
 */
export function classifyFailure(error: unknown, timedOut: boolean): EvidenceArtifact['status'] {
  if (timedOut) return 'unknown_timeout';

  const name =
    error instanceof Error ? error.name.toLowerCase() : '';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code).toUpperCase()
      : '';

  // A DNS failure is about the network path, not about the target's behaviour.
  if (name.includes('timeout') || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'unknown_timeout';
  }

  return 'unknown_network_error';
}

/**
 * Raised when a collector is invoked without the paid fetch it declared it
 * needs. Thrown loudly rather than returning an `unknown_*` artifact, because
 * "the orchestrator forgot to buy the screenshot" is a bug in our own code, and
 * recording it as an observation about the target would put our mistake into
 * someone's review.
 */
export class MissingPaidFetchError extends Error {
  constructor(kind: CollectorKind) {
    super(
      `collector "${kind}" requires a paid fetch but none was supplied — this is a bug in the orchestrator, not an observation about the target`,
    );
    this.name = 'MissingPaidFetchError';
  }
}

/**
 * Raised by a collector that has not been written yet.
 *
 * This is deliberately NOT converted into an `unknown_*` evidence artifact. An
 * `unknown_*` status is a statement about the TARGET — "we could not reach it".
 * Our own unfinished code is not a fact about someone else's project, and
 * writing it into their review would be the exact category error Rule 3 is
 * about. The orchestrator lets this propagate and fails the session instead.
 */
export class CollectorNotImplementedError extends Error {
  constructor(kind: CollectorKind, note: string) {
    super(`collector "${kind}" is not implemented yet: ${note}`);
    this.name = 'CollectorNotImplementedError';
  }
}
