/**
 * Public sanitized audit manifest.
 *
 * The build spec asks for "a sanitized public manifest (no raw secrets, no
 * private artifact contents) … so a judge can independently check the
 * claim-to-evidence chain". This is that file's generator.
 *
 * The whole value of the manifest is that it is CHECKABLE, so the design follows
 * from what a judge can actually do without our help:
 *
 *   - Every artifact appears with its `content_hash`, so a reader who has a raw
 *     artifact can confirm it is the bytes the manifest describes.
 *   - Every claim appears with the id of the artifact it cites. A claim whose
 *     cited artifact is absent from this manifest is a claim that cannot be
 *     checked, and the manifest can be tested for that.
 *   - The claims are RE-DERIVED here from the bundle by the same deterministic
 *     drafter the application uses. Nothing is read back from a document we
 *     wrote earlier, so the manifest cannot attest to a claim the pipeline would
 *     no longer produce.
 *   - The body is hashed and the hash is printed, so the manifest is bound to
 *     the commit that produced it. A manifest nobody can pin to a revision
 *     proves nothing.
 *
 * Determinism matters more than it looks. `draftClaimsFromEvidence` makes no
 * network call and consults no clock, so the same bundle always yields the same
 * manifest — which is what makes the body hash meaningful rather than a random
 * number that changes every run.
 *
 * What is deliberately NOT here: `raw_ref`. It points at stored raw bytes — the
 * full response body of somebody's page — and the spec excludes raw artifact
 * contents for a reason. The `content_hash` is the part that makes the artifact
 * verifiable, and it is the part that ships.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { EvidenceArtifact } from '@observed/shared-types';
import { canonicalize } from '../audit-ledger';
import { draftClaimsFromEvidence } from '../review-generator/draft-from-evidence';
import { renderDraft, validateClaims } from '../review-generator';

/** Fields dropped from every artifact, and why. */
const WITHHELD_ARTIFACT_FIELDS = ['raw_ref'] as const;

/**
 * A metadata key that looks like a credential is dropped rather than shipped.
 *
 * This is belt-and-braces: the collectors are not supposed to record secrets in
 * metadata, and Rule 11 says they never read any. But a manifest is published,
 * and "we did not expect that field to be sensitive" is the sentence that
 * precedes every accidental disclosure. The check is cheap and it fails closed,
 * and `withheld_metadata_keys` records that something was removed rather than
 * silently dropping it — a sanitizer that hides its own edits cannot be
 * audited.
 */
const SECRETISH = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|authorization|cookie|bearer)/i;

export interface SanitizedArtifact {
  artifact_id: string;
  collector: string;
  collector_version: string;
  status: string;
  target_url: string;
  resolved_ip: string | null;
  observed_at: string;
  content_hash: string;
  /** `buy` receipt id, when the artifact came from a paid call. */
  provider_request_id: string | null;
  metadata: Record<string, unknown>;
  withheld_metadata_keys: string[];
}

function sanitize(artifact: EvidenceArtifact): SanitizedArtifact {
  const metadata: Record<string, unknown> = {};
  const withheld: string[] = [];

  for (const [key, value] of Object.entries(artifact.metadata ?? {})) {
    if (SECRETISH.test(key)) withheld.push(key);
    else metadata[key] = value;
  }

  for (const field of WITHHELD_ARTIFACT_FIELDS) {
    if (artifact[field] !== undefined && artifact[field] !== null) withheld.push(field);
  }

  return {
    artifact_id: artifact.artifact_id,
    collector: artifact.collector,
    collector_version: artifact.collector_version,
    status: artifact.status,
    target_url: artifact.target_url,
    resolved_ip: artifact.resolved_ip,
    observed_at: artifact.observed_at,
    content_hash: artifact.content_hash,
    provider_request_id: artifact.provider_request_id,
    metadata,
    withheld_metadata_keys: withheld.sort(),
  };
}

interface ManifestBody {
  manifest_version: 1;
  generated_by: string;
  session_id: string | null;
  target: string | null;
  repo_url: string | null;
  artifact_count: number;
  artifacts: SanitizedArtifact[];
  claim_count: number;
  claims: Array<{
    claim_id: string;
    evidence_artifact_id: string;
    /** Where in the artifact the fact lives, e.g. "response.status". */
    exact_locator: string;
    confidence: string;
    observation: string;
    inference: string;
    action: string;
  }>;
  held_reasons: string[];
  review_text: string;
  verification: string;
}

/**
 * The instructions a reader needs to check this themselves.
 *
 * Kept as one field rather than prose in the repository, so the procedure cannot
 * drift away from the file it describes.
 */
const VERIFICATION_NOTE = [
  'To check this manifest without trusting it:',
  '1. Every claim cites evidence_artifact_id. Confirm it appears in artifacts[].',
  '2. Recompute sha256 of an artifact\'s raw bytes and compare to content_hash.',
  '3. Rebuild this body without the integrity field, canonicalize it with sorted',
  '   keys and no whitespace, sha256 that, and compare to integrity.body_hash.',
  '   The hash announced on the commit that produced this file must match.',
  '4. Determine the claims from artifacts[] with the drafter in',
  '   apps/worker/src/review-generator/draft-from-evidence.ts and confirm they match.',
].join('\n');

function buildBody(bundle: Record<string, unknown>): ManifestBody {
  const artifacts = (bundle.artifacts ?? []) as EvidenceArtifact[];

  // Re-derived, not read back. See the header.
  const proposed = draftClaimsFromEvidence(artifacts);
  const { accepted, held } = validateClaims(proposed, artifacts);

  return {
    manifest_version: 1,
    generated_by: 'apps/worker/src/cli/manifest.ts',
    session_id: typeof bundle.session_id === 'string' ? bundle.session_id : null,
    target: typeof bundle.target === 'string' ? bundle.target : null,
    repo_url: typeof bundle.repo_url === 'string' ? bundle.repo_url : null,
    artifact_count: artifacts.length,
    artifacts: artifacts.map(sanitize),
    claim_count: accepted.length,
    claims: accepted.map((claim) => ({
      claim_id: claim.claim_id,
      evidence_artifact_id: claim.evidence_artifact_id,
      exact_locator: claim.exact_locator,
      confidence: claim.confidence,
      observation: claim.observation,
      inference: claim.inference,
      action: claim.action,
    })),
    held_reasons: held,
    review_text: renderDraft(accepted),
    verification: VERIFICATION_NOTE,
  };
}

/** sha256 over the canonical form, so key order can never change the hash. */
function hashBody(body: unknown): string {
  return createHash('sha256').update(canonicalize(body), 'utf8').digest('hex');
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function say(level: 'notice' | 'error', message: string): void {
  const flat = String(message).replace(/%/g, '%25').replace(/\r?\n/g, ' ');
  console.log(`::${level}::${flat}`);
}

async function main(): Promise<number> {
  const bundlePath = process.argv[2];
  if (!bundlePath || bundlePath.startsWith('--')) {
    console.error('usage: tsx src/cli/manifest.ts <run.json> [--out <file>]');
    return 2;
  }

  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(await readFile(resolve(bundlePath), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    say('error', `could not read the observation bundle at ${bundlePath}: ${String(error)}`);
    return 1;
  }

  const body = buildBody(bundle);
  const bodyHash = hashBody(body);

  const manifest = {
    ...body,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'sorted keys, no whitespace (see audit-ledger canonicalize)',
      note: 'body_hash covers this document without the integrity field.',
      body_hash: bodyHash,
    },
  };

  // A manifest claiming evidence it does not contain is worse than no manifest:
  // it looks checkable. So the one invariant that can be tested here is tested
  // here, and a violation is a non-zero exit rather than a warning.
  const present = new Set(body.artifacts.map((artifact) => artifact.artifact_id));
  const dangling = body.claims.filter((claim) => !present.has(claim.evidence_artifact_id));
  if (dangling.length > 0) {
    say(
      'error',
      `${dangling.length} claim(s) cite an artifact absent from this manifest: ${dangling
        .map((claim) => `${claim.claim_id} -> ${claim.evidence_artifact_id}`)
        .join(', ')}`,
    );
    return 1;
  }

  const outFile = flag('--out');
  if (outFile) {
    const outPath = resolve(outFile);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`written       ${outPath}`);
  }

  console.log(`artifacts     ${body.artifact_count}`);
  console.log(`claims        ${body.claim_count}`);
  console.log(`held          ${body.held_reasons.length}`);
  say(
    'notice',
    `manifest: ${body.artifact_count} artifact(s), ${body.claim_count} claim(s), every claim resolved to an artifact in this file. body_hash=${bodyHash}`,
  );

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    say('error', `manifest generation crashed: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  });
