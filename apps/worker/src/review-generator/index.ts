/**
 * Review Generator — Rule 10, and Rule 2.
 *
 * The shape of this module is the product's central claim made structural.
 *
 * Rule 2: TLS/DNS/HTTP checks are deterministic code, never LLM judgment. The
 * model's only job is turning a structured evidence record into a sentence.
 *
 * Rule 10: every claim carries claim → evidence → action, and the final review
 * text is RENDERED FROM that record rather than free-written. So there are two
 * distinct steps here, and keeping them distinct is what makes the claim
 * checkable:
 *
 *   draftClaims()  — the model proposes. Its output is data, not prose.
 *   renderDraft()  — the prose is assembled from the validated data only.
 *
 * The critical property: a model output that cites an artifact id we do not
 * hold, or that asserts a conclusion against an `unknown_*` observation, is
 * DISCARDED rather than softened. `validateClaims` is the gate, and it is
 * deliberately strict — the demo's credibility rests on the system visibly
 * refusing to ship a claim it cannot support, so a validator that "fixes"
 * bad output would remove the very behaviour being demonstrated.
 */

import type {
  EvidenceArtifact,
  ReviewClaim,
  ReviewSubmission,
} from '@observed/shared-types';
import { canSupportClaim } from '@observed/shared-types';

/** Raised when no claim survives validation. This is a normal outcome. */
export class ClaimsHeldError extends Error {
  readonly rule = 'evidence_sufficiency' as const;

  constructor(readonly reasons: readonly string[]) {
    super(
      `every proposed claim was refused: ${reasons.join('; ')}. The review is held rather than shipped.`,
    );
    this.name = 'ClaimsHeldError';
  }
}

export interface GeneratedDraft {
  claims: ReviewClaim[];
  draft_text: string;
  /** Why any individual claim was dropped. Shown on the Held screen. */
  held_reasons: string[];
}

/**
 * The claim validator. Every branch here is a claim that must NOT ship.
 *
 * Note the direction of each check: it looks for a reason to refuse. A
 * validator that looks for a reason to accept will eventually find one.
 */
export function validateClaims(
  proposed: readonly ReviewClaim[],
  evidence: readonly EvidenceArtifact[],
): { accepted: ReviewClaim[]; held: string[] } {
  const accepted: ReviewClaim[] = [];
  const held: string[] = [];

  const byId = new Map(evidence.map((artifact) => [artifact.artifact_id, artifact]));

  for (const claim of proposed) {
    // Rule 10: no claim without an evidence pointer.
    if (!claim.evidence_artifact_id) {
      held.push(`claim ${claim.claim_id} cites no evidence artifact`);
      continue;
    }

    // The cited artifact must be one we actually hold. A model that invents a
    // plausible id produces a sentence that looks cited and is not.
    const artifact = byId.get(claim.evidence_artifact_id);
    if (!artifact) {
      held.push(
        `claim ${claim.claim_id} cites artifact ${claim.evidence_artifact_id}, which was not collected`,
      );
      continue;
    }

    // Rule 3: an `unknown_*` observation can never support an assertion. It may
    // only be restated as "unable to verify", which renderClaimSentence already
    // enforces by wording — but the confidence field is what other code reads,
    // so it is corrected here rather than trusted.
    if (!canSupportClaim(artifact.status) && claim.confidence !== 'unable_to_verify') {
      accepted.push({ ...claim, confidence: 'unable_to_verify' });
      continue;
    }

    if (claim.observation.trim() === '') {
      held.push(`claim ${claim.claim_id} has no observation attached`);
      continue;
    }

    accepted.push(claim);
  }

  return { accepted, held };
}

/**
 * Render the draft from the accepted claims.
 *
 * This is a pure function of the claim record, so the same evidence always
 * produces the same text. No model is involved at this step, which is what
 * makes "the review text is rendered from the record, not generated freely" a
 * property of the code rather than a promise in a README.
 */
export function renderDraft(claims: readonly ReviewClaim[]): string {
  const sentences = claims.map((claim) => {
    const observation = claim.observation.trim().replace(/\.+$/, '');
    const inference = claim.inference.trim().replace(/\.+$/, '');

    if (claim.confidence === 'unable_to_verify') {
      return observation === ''
        ? 'Unable to verify — no conclusive observation was recorded.'
        : `Unable to verify: ${observation}.`;
    }

    if (inference === '') return `${observation}.`;
    return `${inference.charAt(0).toUpperCase()}${inference.slice(1)}, observed as ${observation}.`;
  });

  return sentences.join(' ');
}

// ---------------------------------------------------------------------------
// Stubs — the model call itself
// ---------------------------------------------------------------------------

/**
 * NOT IMPLEMENTED YET.
 *
 * What this must do, and the one thing it must never do:
 *
 *   - the prompt receives ONLY `EvidenceArtifact` records. Never raw HTML, never
 *     a screenshot's pixels, never the target's own marketing copy. `raw_ref`
 *     is a private pointer and must not be resolved into the prompt.
 *   - the model is asked for structured claims (`ReviewClaim[]`), not prose.
 *   - the output is parsed, then handed to `validateClaims` above. Whatever
 *     survives is what ships.
 *
 * The model cannot choose network targets and cannot call `buy`: it has no such
 * capability in this process, so those are absences rather than prohibitions it
 * is trusted to respect.
 */
export async function draftClaims(
  artifacts: readonly EvidenceArtifact[],
): Promise<ReviewClaim[]> {
  if (artifacts.length === 0) {
    // Refusing here rather than calling a model with an empty prompt: there is
    // nothing to observe, so there is nothing to say.
    throw new ClaimsHeldError(['no evidence artifacts were collected']);
  }

  throw new Error(
    'review-generator.draftClaims is not implemented yet — needs the model call plus the claim-evidence-action schema prompt',
  );
}

/**
 * The full path: propose, validate, render. Callers use this, not the pieces.
 *
 * `ClaimsHeldError` is thrown when nothing survives validation. That is the
 * Held screen's trigger, and it is a success of the system rather than a
 * failure of it — which is why the error carries the reasons rather than a
 * generic message.
 */
export async function generateDraft(
  artifacts: readonly EvidenceArtifact[],
): Promise<GeneratedDraft> {
  const proposed = await draftClaims(artifacts);
  const { accepted, held } = validateClaims(proposed, artifacts);

  if (accepted.length === 0) throw new ClaimsHeldError(held);

  return { claims: accepted, draft_text: renderDraft(accepted), held_reasons: held };
}

export type { ReviewSubmission };
