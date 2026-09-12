/**
 * Review contracts — Rule 10.
 *
 * No claim ships without an evidence pointer. The final review text is
 * rendered from a structured claim record, not free-written from scratch:
 *
 *   claim_id -> evidence_artifact_id -> exact_locator
 *            -> observation -> inference -> action -> confidence
 */

import type { EvidenceArtifact } from './evidence';
import type { PaymentRecord } from './payment';
import type { SpendState } from './policy';

export type ClaimConfidence = 'high' | 'medium' | 'low' | 'unable_to_verify';

export interface ReviewClaim {
  claim_id: string;
  /** FK -> EvidenceArtifact. A claim without one of these must not be written. */
  evidence_artifact_id: string;
  /** Where in the artifact the fact lives, e.g. "response.status". */
  exact_locator: string;
  /** The raw fact. e.g. "HTTP 404". No interpretation allowed here. */
  observation: string;
  /** What the observation implies. e.g. "signup route unreachable". */
  inference: string;
  /** The recommended fix. */
  action: string;
  confidence: ClaimConfidence;
}

export type ReviewStatus =
  | 'draft'
  | 'submitted'
  | 'accepted'
  | 'rejected_low_quality'
  | 'rewritten';

export interface ReviewSubmission {
  review_id: string;
  /** AskBots project identifier. */
  project_id: string;
  /** The URL that was actually inspected. */
  target_url: string;
  /** Human-readable project name, if the source provided one. */
  project_name: string | null;
  claims: ReviewClaim[];
  draft_text: string;
  status: ReviewStatus;
  askbots_response_code: number | null;
  submitted_at: string | null;
  created_at: string;
}

/** Badge states the UI may render. Each maps to exactly one token pair. */
export type BadgeState =
  | 'accepted'
  | 'rewritten'
  | 'observed'
  | 'live'
  | 'detected'
  | 'held'
  | 'unable';

export function reviewStatusToBadge(status: ReviewStatus): BadgeState {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'rewritten':
      return 'rewritten';
    case 'rejected_low_quality':
      // "Review held" — never "failed", never "error". The system refusing to
      // ship a hollow claim is a trust signal, not a bug.
      return 'held';
    case 'draft':
    case 'submitted':
      return 'live';
  }
}

/**
 * Which full-screen surface a review should render as. The design spec calls
 * for the Paused and Excluded screens to be real, wired states — not static
 * mockups — so they are first-class here rather than special-cased in a page.
 */
export type ReviewSurface =
  | 'inspecting'
  | 'findings'
  | 'held'
  | 'excluded'
  | 'paused'
  | 'complete';

/**
 * Where a displayed record actually came from.
 *
 * This exists so that "show a demo" can never quietly become "show a
 * fabrication". The design spec requires a replay to carry the label
 * "Replay of a real review, recorded <date/time>". Making provenance a
 * required field means the label cannot be forgotten by accident — the UI has
 * to render something for every non-`live` value.
 */
export type RecordProvenance = 'live' | 'sample' | 'replay';

export const PROVENANCE_LABELS: Record<RecordProvenance, string | null> = {
  // Live records need no apology label.
  live: null,
  sample: 'Sample record — demonstration only, not a real observation',
  replay: 'Replay of a real review',
};

export interface ReviewBundle {
  provenance: RecordProvenance;
  /** Pre-resolved label for the banner. `null` means no banner is needed. */
  provenance_label: string | null;
  review: ReviewSubmission;
  evidence: EvidenceArtifact[];
  payments: PaymentRecord[];
  spend: SpendState;
  /**
   * Set when the Policy Engine declined to inspect this project.
   *
   * This exists so the Excluded and Paused screens are driven by an actual
   * policy outcome rather than being hardcoded pages. A refusal is a
   * first-class result of the pipeline, not an error — which is why it travels
   * alongside a review rather than replacing it with an HTTP error.
   */
  refusal: PolicyRefusal | null;
}

export type RefusalRule =
  /** Rule 5 — the project collides with the operator's own identifiers. */
  | 'exclusion_list'
  /** Rule 9 — a spend cap is reached. */
  | 'spend_cap'
  /** Rule 9 — the kill switch is off. */
  | 'payments_disabled';

export interface PolicyRefusal {
  rule: RefusalRule;
  /** Plain language, shown to the reader. Never a generic "not available". */
  explanation: string;
  /** ISO 8601 UTC, when the refusal would be reconsidered. `null` = never. */
  reconsidered_at: string | null;
}

