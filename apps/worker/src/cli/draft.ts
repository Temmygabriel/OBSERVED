/**
 * Draft the review from a recorded observation.
 *
 * This closes the loop the observation CLI left open. `observe.ts` proves the
 * collectors ran; it says nothing about the product, because the product is the
 * REVIEW, and until now the review could not be produced at all. This reads the
 * bundle `observe.ts` wrote, drafts claims from it, runs them through the same
 * validator the app uses, and prints the rendered text.
 *
 * Usage:
 *   tsx src/cli/draft.ts <bundle.json>
 *
 * ── Why a held review is an ERROR here, and was not before ───────────────────
 *
 * `ClaimsHeldError` used to be the normal outcome of asking a model to draft:
 * the validator refused its unsupported claims, and the review was held rather
 * than shipped. That refusal is a success of the system.
 *
 * With a deterministic drafter it means something different. Every claim is
 * built FROM a collected artifact, so its citation is real by construction, its
 * observation is non-empty by construction, and `validateClaims` should have no
 * reason to refuse any of it. A held claim therefore means this code produced
 * something the gate would not accept — a bug in the drafter, not a judgement
 * call. So this exits non-zero and says so, which is what makes the two modules
 * a check on each other rather than one trusting the other.
 *
 * Exit code is 1 when the draft could not be produced for OUR reasons: an
 * unreadable bundle, a bundle with no artifacts, or a claim the validator
 * refused. A review full of `unable_to_verify` claims is a successful run,
 * because "we could not verify this" is a finding too.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvidenceArtifact, ReviewClaim } from '@observed/shared-types';
import { ClaimsHeldError, generateDraft, type GeneratedDraft } from '../review-generator';

interface Bundle {
  session_id?: unknown;
  target?: unknown;
  artifacts?: unknown;
}

/**
 * Workflow commands are parsed from STDOUT — see the note in `observe.ts`.
 * Newlines are flattened because a command's parameters run to the end of the
 * line, and `%` is escaped because it introduces the escaping scheme itself.
 */
function say(level: 'notice' | 'warning' | 'error', message: string): void {
  const flat = String(message).replace(/\r?\n/g, ' ').replace(/%/g, '%25');
  console.log(`::${level}::${flat}`);
}

function fail(message: string): void {
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error::draft: ${escaped}`);
  console.error(`\n${message}`);
}

/** One line per claim, so a reader can trace a sentence back to its artifact. */
function describeClaim(claim: ReviewClaim): string {
  const bits = [
    `[${claim.confidence}]`,
    claim.claim_id,
    `evidence=${claim.evidence_artifact_id}`,
    `at=${claim.exact_locator}`,
    `| ${claim.observation}`,
  ];
  if (claim.inference !== '') bits.push(`=> ${claim.inference}`);
  if (claim.action !== '') bits.push(`ACTION: ${claim.action}`);
  return bits.join(' ');
}

function readArtifacts(bundle: Bundle): EvidenceArtifact[] {
  // The bundle is JSON from disk, so its shape is a claim about a file rather
  // than a type the compiler can hold. Checked, not asserted: silently drafting
  // from an empty array would look exactly like an observation that found
  // nothing, and those are different failures.
  if (!Array.isArray(bundle.artifacts)) {
    throw new Error('the bundle has no `artifacts` array — is this a file observe.ts wrote?');
  }
  return bundle.artifacts as EvidenceArtifact[];
}

async function main(): Promise<number> {
  const bundlePath = process.argv[2];
  if (!bundlePath || bundlePath.startsWith('--')) {
    console.error('usage: tsx src/cli/draft.ts <bundle.json>');
    return 2;
  }

  const path = resolve(bundlePath);

  let bundle: Bundle;
  try {
    bundle = JSON.parse(await readFile(path, 'utf8')) as Bundle;
  } catch (error) {
    fail(`could not read the observation bundle at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const artifacts = readArtifacts(bundle);

  console.log(`bundle        ${path}`);
  console.log(`session       ${String(bundle.session_id ?? '(unrecorded)')}`);
  console.log(`target        ${String(bundle.target ?? '(unrecorded)')}`);
  console.log(`artifacts     ${artifacts.length}`);
  console.log('');

  if (artifacts.length === 0) {
    // Not a drafting failure — there was nothing observed to draft from. Said
    // plainly rather than reported as a held review, because a review nobody
    // could have written is a different problem from one the gate refused.
    fail('the bundle recorded no artifacts, so there is nothing to review');
    return 1;
  }

  let draft: GeneratedDraft;
  try {
    draft = await generateDraft(artifacts);
  } catch (error) {
    if (error instanceof ClaimsHeldError) {
      fail(
        `${error.message} — with a deterministic drafter this is a bug in the drafter, not a model misbehaving: every claim it builds cites a collected artifact by construction.`,
      );
      for (const reason of error.reasons) fail(`  held: ${reason}`);
      return 1;
    }
    throw error;
  }

  // The product. Printed first, and as one annotation, because this is the text
  // a reader is here to judge. The target is named inside the annotation so the
  // sentence stands on its own in a list of annotations, with no context from
  // the lines above it.
  console.log('REVIEW');
  console.log(draft.draft_text);
  console.log('');

  say('notice', `review of ${String(bundle.target ?? '(unrecorded target)')}: ${draft.draft_text}`);

  console.log('CLAIMS');
  for (const claim of draft.claims) console.log(`  ${describeClaim(claim)}`);

  // Warnings, not notices: a claim the gate refused is the system working, and
  // it should stand out in the annotation list next to the review it shaped.
  for (const reason of draft.held_reasons) say('warning', `held: ${reason}`);

  const unverified = draft.claims.filter((claim) => claim.confidence === 'unable_to_verify').length;
  say(
    'notice',
    `drafted ${draft.claims.length} claim(s) from ${artifacts.length} artifact(s); ${unverified} unable to verify; ${draft.held_reasons.length} held`,
  );

  if (draft.held_reasons.length > 0) {
    console.log('');
    console.log(`held (${draft.held_reasons.length})`);
    for (const reason of draft.held_reasons) console.log(`  ${reason}`);
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail(`drafting from ${process.argv[2] ?? '(no bundle)'} threw: ${detail}`);
    process.exitCode = 1;
  });
