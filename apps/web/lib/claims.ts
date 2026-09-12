import type { EvidenceArtifact, ReviewClaim } from '@observed/shared-types';
import { formatClockUtc } from './format';

/**
 * Rule 10, made mechanical.
 *
 * The spec requires that "the final review text is rendered from this record,
 * not generated freely". This module is the only place a ReviewClaim becomes
 * prose. Keeping it a pure function means:
 *
 *   - there is no code path where a claim can be asserted without an
 *     observation attached, because the sentence is built FROM the observation;
 *   - a claim whose confidence is `unable_to_verify` cannot accidentally read
 *     as an assertion — the branch below refuses to phrase it as one;
 *   - the sentence is unit-testable, which model output is not.
 *
 * If a later version wants a language model to phrase these more naturally,
 * the model's output still has to pass back through here to be assembled, so
 * the evidence pointer cannot be dropped on the way.
 */

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripTrailingPeriod(text: string): string {
  return text.replace(/\.+$/, '');
}

export function renderClaimSentence(claim: ReviewClaim): string {
  const inference = stripTrailingPeriod(claim.inference.trim());
  const observation = stripTrailingPeriod(claim.observation.trim());

  // An unverifiable claim is not allowed to sound like a finding.
  if (claim.confidence === 'unable_to_verify') {
    if (observation.length === 0) {
      return 'Unable to verify — no conclusive observation was recorded.';
    }
    return `Unable to verify: ${observation}. Not enough evidence to support a conclusion.`;
  }

  if (inference.length === 0) {
    return `${capitalize(observation)}.`;
  }

  if (observation.length === 0) {
    return `${capitalize(inference)}.`;
  }

  return `${capitalize(inference)}, observed as ${observation}.`;
}

/**
 * The suggested fix. Only reachable for conclusive observations — there is no
 * "fix" to recommend for a timeout, and offering one would be pretending to
 * know something we do not.
 */
export function renderClaimAction(claim: ReviewClaim): string | null {
  if (claim.confidence === 'unable_to_verify') return null;
  const action = claim.action.trim();
  if (action.length === 0) return null;
  return `${capitalize(stripTrailingPeriod(action))}.`;
}

const CONFIDENCE_LABELS: Record<ReviewClaim['confidence'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unable_to_verify: 'Unable to verify',
};

export function claimConfidenceLabel(claim: ReviewClaim): string {
  return CONFIDENCE_LABELS[claim.confidence];
}

export function metaText(
  artifact: EvidenceArtifact,
  key: string,
): string | null {
  const value = artifact.metadata[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** A recorded duration, or null. Never guessed, never defaulted to a number. */
export function metaNumber(
  artifact: EvidenceArtifact | undefined,
  key: string,
): number | null {
  if (!artifact) return null;
  const value = artifact.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * `/signup · 404 · 09:14:32 UTC` — the citation that sits under a claim.
 *
 * The timestamp is never omitted. A citation without a time is not checkable,
 * and checkability is the entire product.
 */
export function buildCitation(
  claim: ReviewClaim,
  artifact: EvidenceArtifact | null,
): string {
  const parts: string[] = [];

  if (artifact) {
    const path = metaText(artifact, 'request_path');
    if (path) parts.push(path);

    const code = metaText(artifact, 'status_code');
    if (code) parts.push(code);
  }

  // With no structured path/code to cite, the observation itself is the most
  // precise thing we can point at. It is never omitted — a citation with no
  // observation in it would be decoration.
  if (parts.length === 0 && claim.observation.trim().length > 0) {
    parts.push(claim.observation.trim());
  }

  parts.push(
    artifact ? formatClockUtc(artifact.observed_at) : 'time not recorded',
  );

  return parts.join(' · ');
}
