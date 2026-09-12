/**
 * Evidence contracts — Rules 2 and 3.
 *
 * Rule 2: TLS/DNS/HTTP status checks are deterministic code, never LLM
 *         judgment calls. The LLM's only job is turning a structured evidence
 *         record into a sentence.
 * Rule 3: every check result is tri-state. An `unknown_*` result can NEVER
 *         silently become a pass or a fail — it forces "unable to verify".
 */

export type EvidenceStatus =
  | 'valid'
  | 'invalid'
  | 'unknown_timeout'
  | 'unknown_network_error';

export const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  'valid',
  'invalid',
  'unknown_timeout',
  'unknown_network_error',
];

/** The two results that were actually observed. Only these can support a claim. */
export function isConclusive(status: EvidenceStatus): boolean {
  return status === 'valid' || status === 'invalid';
}

/** The two results where the network, not the target, failed us. */
export function isUnknown(status: EvidenceStatus): boolean {
  return status === 'unknown_timeout' || status === 'unknown_network_error';
}

/**
 * Rule 10 — no claim ships without an evidence pointer. A claim may only be
 * written against a conclusive observation, so this is the gate the Review
 * Generator must pass before it is allowed to assert anything.
 */
export function canSupportClaim(status: EvidenceStatus): boolean {
  return isConclusive(status);
}

/**
 * The three states uncertainty is allowed to have in copy, per the design
 * spec. Nothing may collapse an `unknown_*` into "Observed" or "Detected".
 */
export type CopyState = 'Observed' | 'Detected' | 'Unable to verify';

export function evidenceStatusToCopyState(status: EvidenceStatus): CopyState {
  switch (status) {
    case 'valid':
      return 'Observed';
    case 'invalid':
      return 'Detected';
    case 'unknown_timeout':
    case 'unknown_network_error':
      return 'Unable to verify';
  }
}

/** Which deterministic collector produced an artifact. */
export type CollectorKind = 'html' | 'tls' | 'dns' | 'screenshot' | 'repo';

export const COLLECTOR_KINDS: readonly CollectorKind[] = [
  'html',
  'tls',
  'dns',
  'screenshot',
  'repo',
];

/** Checklist labels, matching the copy used on the Landing screen. */
export const COLLECTOR_LABELS: Record<CollectorKind, string> = {
  html: 'Live page',
  tls: 'TLS',
  dns: 'DNS',
  screenshot: 'Screenshot',
  repo: 'Repo',
};

export interface EvidenceArtifact {
  artifact_id: string;
  review_session_id: string;
  collector: CollectorKind;
  collector_version: string;
  target_url: string;
  resolved_ip: string | null;
  /** ISO 8601, UTC. Always the real observation time — never rewritten. */
  observed_at: string;
  status: EvidenceStatus;
  /** sha256 of the raw artifact. */
  content_hash: string;
  /** Pointer to the stored raw artifact. Private — never shown to the LLM. */
  raw_ref: string;
  /** Status codes, headers, cert fingerprint, etc. Safe to show to the LLM. */
  metadata: Record<string, unknown>;
  /** `buy` request/receipt id, when this artifact came from a paid call. */
  provider_request_id: string | null;
}
