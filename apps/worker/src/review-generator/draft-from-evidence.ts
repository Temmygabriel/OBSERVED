/**
 * Deterministic claim drafting — Rule 2 and Rule 10.
 *
 * The review generator had one unimplemented step, and it was the one that
 * produces anything to say. `validateClaims` was real, `renderDraft` was real,
 * and `draftClaims` threw unconditionally — so the pipeline was complete except
 * for its content, and no review could ever be produced. That is a larger hole
 * than any missing collector: the product's central claim is a review whose
 * every sentence cites a hash-verified artifact, and there was no review.
 *
 * WHY THIS IS DETERMINISTIC AND NOT A MODEL CALL
 *
 * The obvious reading is that `draftClaims` should call a language model. It
 * should not, and the reason is structural rather than pragmatic.
 *
 * `validateClaims` is the gate. Every claim — whoever wrote it — must cite an
 * artifact we hold, must not assert against an `unknown_*` observation, and must
 * carry an observation. A model and this file are held to exactly the same
 * standard, so the guarantee does not depend on which one drafts. What differs
 * is the failure mode: a model can invent a plausible claim that passes, and a
 * deterministic function cannot invent anything at all. Rule 2 already says the
 * checks are deterministic code and never model judgment; the same argument
 * applies to the sentence built on top of them.
 *
 * The model's only remaining contribution would be phrasing variety — and
 * `renderDraft` already assembles the prose from the validated record, which is
 * what makes "rendered from the record, not generated freely" a property of the
 * code. A model inserted at this seam may rephrase; it cannot add a fact, and it
 * cannot remove the citation. **If one is added, `validateClaims` stays the gate
 * and this file stays the fallback.**
 *
 * WHAT THIS FILE MAY AND MAY NOT DO
 *
 * The `observation` field is a raw fact with no interpretation, and `inference`
 * is separate — that separation is what lets a reader check the reasoning rather
 * than trust it. Two rules are load-bearing and both are checked by the very
 * next function in the pipeline:
 *
 *   - An `unknown_*` artifact produces exactly ONE claim, with confidence
 *     `unable_to_verify` and NO inference. Writing an inference there would be
 *     asserting against an observation we do not have, which is Rule 3's
 *     cardinal error. The claim says what we failed to observe and stops.
 *   - A claim is only ever built FROM an artifact, so its `evidence_artifact_id`
 *     is real by construction. If `validateClaims` ever holds a claim from this
 *     file, that is a bug here, not a judgement call there — which makes the two
 *     modules a check on each other rather than one trusting the other.
 */

import type {
  ClaimConfidence,
  EvidenceArtifact,
  ReviewClaim,
} from '@observed/shared-types';

// ---------------------------------------------------------------------------
// Typed readers over the artifact metadata bag
// ---------------------------------------------------------------------------

/**
 * `metadata` is `Record<string, unknown>`, deliberately — it is collector-shaped
 * and each collector differs. Reading it through these four functions means a
 * missing or unexpected field degrades to "no claim" rather than to the string
 * "undefined" appearing inside a sentence that cites a hash. A review that says
 * "resolves to undefined" would be a fabricated observation, which is worse than
 * saying nothing.
 */
function str(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(meta: Record<string, unknown>, key: string): boolean | null {
  const value = meta[key];
  return typeof value === 'boolean' ? value : null;
}

/** Accepts either a bare string or an array of them, since collectors differ. */
function strList(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  if (typeof value === 'string' && value.trim() !== '') return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }
  return [];
}

// ---------------------------------------------------------------------------
// Claim construction
// ---------------------------------------------------------------------------

function makeClaim(
  artifact: EvidenceArtifact,
  suffix: string,
  locator: string,
  observation: string,
  inference: string,
  action: string,
  confidence: ClaimConfidence,
): ReviewClaim {
  return {
    // Namespaced by artifact id, so two claims from one artifact stay distinct
    // and every id traces back to the record it came from.
    claim_id: `${artifact.artifact_id}#${suffix}`,
    evidence_artifact_id: artifact.artifact_id,
    exact_locator: locator,
    observation,
    inference,
    action,
    confidence,
  };
}

/**
 * The single claim an `unknown_*` artifact is allowed to produce.
 *
 * `inference` is empty on purpose. The claim states what we could not observe
 * and refuses to draw a conclusion from it; `renderDraft` turns that into
 * "Unable to verify: …" and the UI renders it as neither Observed nor Detected.
 */
function unverifiable(artifact: EvidenceArtifact, locator: string, what: string): ReviewClaim {
  // The cause is worth keeping when it IS a failure — "timed out" and "the
  // network refused us" are different stories. It is only appended for
  // `unknown_*`; on a conclusive artifact it would render as
  // "Unable to verify: … (valid)", which reads as a contradiction.
  const cause = isUnknown(artifact) ? ` (${artifact.status.replace('unknown_', '').replace(/_/g, ' ')})` : '';

  return makeClaim(
    artifact,
    'unverified',
    locator,
    `${what}${cause}`,
    '',
    '',
    'unable_to_verify',
  );
}

function isUnknown(artifact: EvidenceArtifact): boolean {
  return artifact.status === 'unknown_timeout' || artifact.status === 'unknown_network_error';
}

// ---------------------------------------------------------------------------
// Per-collector drafting
// ---------------------------------------------------------------------------

function dnsClaims(artifact: EvidenceArtifact): ReviewClaim[] {
  const m = artifact.metadata;

  if (isUnknown(artifact)) {
    return [unverifiable(artifact, 'metadata.error', 'DNS resolution did not answer')];
  }

  const addresses = strList(m, 'addresses');
  const nonPublic = strList(m, 'non_public_addresses');
  // Named in the observation, not just implied by the artifact: a review
  // sentence reading "the hostname resolves to 1.2.3.4" does not say which
  // hostname, and a claim a reader cannot tie to a name is not citable.
  const hostname = str(m, 'hostname') ?? artifact.target_url;

  if (nonPublic.length > 0) {
    // `dns.ts` sets `invalid` for this, and it is a citable finding about the
    // SUBMISSION rather than about the internet: the domain points into address
    // space that is not publicly routable. Observed may not be able to reach it,
    // and neither can anyone else.
    return [
      makeClaim(
        artifact,
        'non-public',
        'metadata.non_public_addresses',
        `${hostname} resolves to non-public addresses: ${nonPublic.join(', ')}`,
        'the domain does not point at publicly routable address space',
        'point the domain at a public address',
        'high',
      ),
    ];
  }

  if (artifact.status === 'invalid') {
    // THREE DIFFERENT CAUSES land on `invalid` here and they do not share a
    // metadata shape: a malformed target URL (no `hostname` field at all), an
    // NXDOMAIN, and an empty answer. Deriving a cause from the shape would
    // mislabel the malformed case as "this domain publishes no address record"
    // — a specific, wrong claim about somebody's domain, built on our own bad
    // input. So this restates the collector's own recorded `error` verbatim
    // instead. `dns.ts` already decided what happened; this does not re-decide.
    const error = str(m, 'error') ?? 'the hostname could not be resolved';

    // The inference is the one sentence true of all three causes, which is why
    // it is worded around what WE could not do rather than what the domain is.
    return [
      makeClaim(
        artifact,
        'unresolved',
        'metadata.error',
        error,
        'this hostname did not resolve to a public address',
        'check the domain is registered and publishes an address record',
        'high',
      ),
    ];
  }

  // `dns.ts` cannot produce a `valid` artifact with no addresses, so this is
  // unreachable through today's collectors. It is here because the alternative
  // failure is a sentence reading "the hostname resolves to " with nothing after
  // it, citing a content hash — a malformed observation is worse than a refused
  // one, and refusing costs one line.
  if (addresses.length === 0) {
    return [unverifiable(artifact, 'metadata.addresses', 'DNS resolved but recorded no addresses')];
  }

  const count = num(m, 'address_count') ?? addresses.length;
  return [
    makeClaim(
      artifact,
      'resolves',
      'metadata.addresses',
      `${hostname} resolves to ${addresses.join(', ')}${count > 1 ? ` (${count} addresses)` : ''}`,
      'the domain is publicly resolvable',
      '',
      'high',
    ),
  ];
}

function tlsClaims(artifact: EvidenceArtifact): ReviewClaim[] {
  const m = artifact.metadata;

  if (isUnknown(artifact)) {
    // Only the failure path can be `unknown_*` — a handshake that completes
    // returns valid or invalid — and that path always records `error`.
    const reason = str(m, 'error') ?? str(m, 'authorization_error') ?? 'the handshake did not complete';
    return [unverifiable(artifact, 'metadata.error', `TLS could not be checked: ${reason}`)];
  }

  if (artifact.status === 'invalid') {
    // THREE DIFFERENT THINGS land on `invalid` and they must not be merged: a
    // bad certificate, a refusal by the guard, and a handshake that COMPLETED
    // but whose certificate we would not accept. `tls.ts` records which one it
    // was — see the comment above its failure branch — precisely so this does
    // not re-derive it from error text. The three also do not share a metadata
    // shape: the failure path has the two flags and `error`; the completed path
    // has `authorized`, `within_validity_window` and `authorization_error`.
    const isCertificateFinding = bool(m, 'certificate_finding') === true;
    const isRefusal = bool(m, 'target_refused') === true;

    if (isCertificateFinding) {
      const reason = str(m, 'error') ?? 'the certificate was rejected';
      return [
        makeClaim(
          artifact,
          'certificate',
          'metadata.certificate_finding',
          reason,
          'a browser visiting this host will be shown a certificate warning',
          'replace the certificate with one valid for this hostname',
          'high',
        ),
      ];
    }

    if (isRefusal) {
      const reason = str(m, 'error') ?? 'the connection was refused';
      return [
        makeClaim(
          artifact,
          'refused',
          'metadata.target_refused',
          reason,
          'the host refused the connection, so nothing about its certificate was observed',
          'confirm the host serves HTTPS on a publicly routable address',
          'high',
        ),
      ];
    }

    // The remaining shape: the handshake finished and `trustworthy` was still
    // false, which by `tls.ts`'s own definition means the certificate was
    // presented and not accepted — expired, or not authorised. This is a real
    // finding about the certificate, NOT a refusal, so it must not be phrased as
    // one: saying "the check could not be completed" here would be a false
    // statement about our own behaviour, which is its own kind of fabrication.
    const authorized = bool(m, 'authorized');
    const inWindow = bool(m, 'within_validity_window');
    const error = str(m, 'authorization_error');
    const validTo = str(m, 'valid_to');

    const parts = ['a TLS handshake completed but the certificate was not accepted'];
    if (authorized === false) parts.push('the connection reported itself as unauthorised');
    if (inWindow === false) parts.push('the certificate is outside its validity window');
    if (validTo !== null) parts.push(`it states a validity end of ${validTo}`);
    if (error !== null) parts.push(error);

    return [
      makeClaim(
        artifact,
        'untrusted',
        'metadata.within_validity_window',
        parts.join(', '),
        'a browser visiting this host will be shown a certificate warning',
        'renew or replace the certificate for this hostname',
        'high',
      ),
    ];
  }

  const port = num(m, 'port') ?? 443;
  const subjectCn = str(m, 'subject_cn');
  const issuerCn = str(m, 'issuer_cn');
  const validTo = str(m, 'valid_to');
  const days = num(m, 'days_until_expiry');

  const parts = [`a TLS handshake completed on port ${port}`];
  if (subjectCn !== null) parts.push(`for ${subjectCn}`);
  if (issuerCn !== null) parts.push(`issued by ${issuerCn}`);
  if (validTo !== null) parts.push(`valid until ${validTo}`);
  if (days !== null) parts.push(`${days} day${days === 1 ? '' : 's'} remaining`);

  // Expiry inside 30 days is worth an action, but it is not a defect today, so
  // the confidence stays high for the observation and the action carries the
  // urgency. The observation itself is unchanged either way.
  const expiringSoon = days !== null && days <= 30;

  return [
    makeClaim(
      artifact,
      'handshake',
      'metadata.days_until_expiry',
      parts.join(', '),
      'traffic to this host is encrypted with a currently-valid certificate',
      expiringSoon ? 'renew the certificate before it expires' : '',
      'high',
    ),
  ];
}

/**
 * Link artifacts and the page artifact BOTH carry `collector: 'html'`.
 *
 * See MEMORY.md decision 22: that shared label is a known fabricated-finding
 * risk, because "the page returned an error" and "a link on the page returned an
 * error" are different claims about different subjects. `raw_ref` is the only
 * thing that distinguishes them, so this reads it explicitly rather than
 * inferring from metadata shape — an inference here would be exactly the mistake
 * decision 22 warns about.
 */
function isLinkArtifact(artifact: EvidenceArtifact): boolean {
  return artifact.raw_ref.startsWith('inline://link/');
}

function pageClaims(artifact: EvidenceArtifact): ReviewClaim[] {
  const m = artifact.metadata;

  if (isUnknown(artifact)) {
    const reason = str(m, 'error') ?? 'the page could not be fetched';
    return [unverifiable(artifact, 'metadata.error', `the page could not be fetched: ${reason}`)];
  }

  const statusCode = num(m, 'status_code');
  const finalUrl = str(m, 'final_url');
  const contentType = str(m, 'content_type');

  if (artifact.status === 'invalid') {
    const refusal = str(m, 'refusal');
    if (refusal !== null) {
      // A refused fetch is a finding about the submitted URL — it points into
      // non-public space, or redirects there, or loops. That is what Rule 4
      // exists to catch, and it is citable.
      return [
        makeClaim(
          artifact,
          'refused',
          'metadata.refusal',
          refusal,
          'the submitted URL targets address space that is not publicly reachable',
          'point the URL at a publicly reachable host',
          'high',
        ),
      ];
    }

    return [
      makeClaim(
        artifact,
        'status',
        'metadata.status_code',
        `the URL returned HTTP ${statusCode ?? 'an error status'}`,
        'the page is not serving successfully to an anonymous visitor',
        'check the page loads without signing in',
        'high',
      ),
    ];
  }

  const redirects = num(m, 'redirect_count') ?? 0;
  const observation =
    redirects > 0 && finalUrl !== null
      ? `the URL returned HTTP ${statusCode ?? 200} after ${redirects} redirect${redirects === 1 ? '' : 's'}, ending at ${finalUrl}`
      : `the URL returned HTTP ${statusCode ?? 200}${contentType !== null ? ` with content type ${contentType}` : ''}`;

  const claims: ReviewClaim[] = [
    makeClaim(
      artifact,
      'status',
      'metadata.status_code',
      observation,
      'the page is publicly reachable and served without authentication',
      '',
      'high',
    ),
  ];

  const isHtml = bool(m, 'is_html') === true;
  const title = str(m, 'title');

  if (isHtml && title !== null) {
    claims.push(
      makeClaim(
        artifact,
        'title',
        'metadata.title',
        `the document title is "${title}"`,
        'the page declares its own subject, which can be compared against the project description',
        '',
        'medium',
      ),
    );
  }

  if (isHtml && bool(m, 'has_viewport_meta') === false) {
    claims.push(
      makeClaim(
        artifact,
        'viewport',
        'metadata.has_viewport_meta',
        'the document declares no viewport meta tag',
        'the page will render at desktop width on a phone',
        'add a viewport meta tag',
        'medium',
      ),
    );
  }

  return claims;
}

function linkClaims(artifact: EvidenceArtifact): ReviewClaim[] {
  const m = artifact.metadata;
  const href = str(m, 'href') ?? artifact.target_url;

  if (isUnknown(artifact)) {
    // The refusal mapping in `html-links.ts` lands here for 403 and 429. A
    // platform throttling a datacenter address is not a defect in somebody's
    // project, so this reports that we could not verify the link and claims
    // nothing about it.
    const refused = bool(m, 'refused_by_status') === true;
    const what = refused
      ? `the link ${href} answered but refused the request`
      : `the link ${href} could not be checked`;
    return [unverifiable(artifact, 'metadata.status_code', what)];
  }

  const statusCode = num(m, 'status_code');

  if (artifact.status === 'invalid') {
    const refusal = str(m, 'refusal');
    if (refusal !== null) {
      return [
        makeClaim(
          artifact,
          'refused',
          'metadata.refusal',
          `the link ${href} targets non-public address space`,
          'a visitor clicking this link will not reach a public destination',
          'point the link at a public address',
          'high',
        ),
      ];
    }

    return [
      makeClaim(
        artifact,
        'broken',
        'metadata.status_code',
        `the link ${href} returned HTTP ${statusCode ?? 'an error status'}`,
        'the link is published but does not resolve to a working page',
        'fix or remove the link',
        'high',
      ),
    ];
  }

  // Only links that redirected are worth a claim when they work. A page with
  // twelve healthy links should not produce twelve sentences saying so — the
  // review's length has to mean something.
  const redirects = num(m, 'redirect_count') ?? 0;
  if (redirects === 0) return [];

  return [
    makeClaim(
      artifact,
      'redirect',
      'metadata.redirect_count',
      `the link ${href} returned HTTP ${statusCode ?? 200} after ${redirects} redirect${redirects === 1 ? '' : 's'}`,
      'the link works but its destination has moved',
      'update the link to its current address',
      'medium',
    ),
  ];
}

function repoClaims(artifact: EvidenceArtifact): ReviewClaim[] {
  const m = artifact.metadata;

  if (isUnknown(artifact)) {
    const limited = bool(m, 'rate_limited') === true;
    const detail = str(m, 'detail') ?? str(m, 'error');

    // One `unknown_*` member covers two unrelated causes here: GitHub's
    // unauthenticated rate limit, and a declared host this prober does not cover
    // (`unsupported_host`). Both mean we learned nothing about the repository,
    // which is the only thing this claim is allowed to say — but they are worth
    // telling apart to a reader, so the collector's own detail is carried
    // through rather than flattened into one sentence.
    const what = limited
      ? 'the repository could not be checked because the GitHub API rate limit was reached'
      : detail !== null
        ? `the repository could not be checked: ${detail}`
        : 'the repository could not be checked';

    return [unverifiable(artifact, limited ? 'metadata.rate_limited' : 'metadata.detail', what)];
  }

  if (artifact.status === 'invalid') {
    const detail = str(m, 'detail') ?? str(m, 'reason') ?? 'the repository was not readable';
    // The one sentence that must never be written here is "the repository does
    // not exist". Unauthenticated GitHub answers 404 for a private repository
    // too, so absence of access is NOT evidence of absence — `repo.ts` records
    // `distinguishable_from_private: false` for exactly this reason.
    const distinguishable = bool(m, 'distinguishable_from_private') === true;
    return [
      makeClaim(
        artifact,
        'unreadable',
        'metadata.distinguishable_from_private',
        `the repository is not publicly readable: ${detail}`,
        distinguishable
          ? 'the repository does not exist at this address'
          : 'the repository is either private or does not exist — GitHub answers the same way for both',
        distinguishable
          ? 'correct the repository URL'
          : 'make the repository public, or confirm the URL points at the intended repository',
        distinguishable ? 'high' : 'medium',
      ),
    ];
  }

  const fullName = str(m, 'full_name') ?? artifact.target_url;
  const branch = str(m, 'default_branch');
  const headCommitAt = str(m, 'head_commit_at');
  const hasLicense = bool(m, 'has_license');

  const parts = [`the repository ${fullName} is publicly readable`];
  if (branch !== null) parts.push(`with default branch ${branch}`);
  if (headCommitAt !== null) parts.push(`last committed to at ${headCommitAt}`);

  const claims: ReviewClaim[] = [
    makeClaim(
      artifact,
      'readable',
      'metadata.full_name',
      parts.join(', '),
      'the source code is available for inspection without authentication',
      '',
      'high',
    ),
  ];

  if (headCommitAt !== null) {
    claims.push(
      makeClaim(
        artifact,
        'activity',
        'metadata.head_commit_at',
        `the most recent commit on the default branch is dated ${headCommitAt}`,
        'the project has been changed at least once at or after this date',
        '',
        'medium',
      ),
    );
  }

  if (hasLicense === false) {
    claims.push(
      makeClaim(
        artifact,
        'license',
        'metadata.has_license',
        'no licence file was found at the repository root',
        'the terms under which others may use this code are not stated',
        'add a licence file',
        'medium',
      ),
    );
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function claimsFor(artifact: EvidenceArtifact): ReviewClaim[] {
  switch (artifact.collector) {
    case 'dns':
      return dnsClaims(artifact);
    case 'tls':
      return tlsClaims(artifact);
    case 'repo':
      return repoClaims(artifact);
    case 'html':
      return isLinkArtifact(artifact) ? linkClaims(artifact) : pageClaims(artifact);
    case 'screenshot':
      // Not written yet, and it never emits an artifact until it is — a
      // collector we have not built must not be able to produce a claim. This
      // arm exists so that adding the collector is a compile error here until
      // its claims are considered, rather than a silent omission.
      return [];
    default: {
      // Exhaustiveness: `CollectorKind` is a closed union, so this is reachable
      // only if a new kind is added without a case above — which the compiler
      // will flag as an unused-variable error on the assertion below.
      const unreachable: never = artifact.collector;
      return unreachable;
    }
  }
}

/**
 * Draft one claim set from the collected evidence.
 *
 * Ordering follows the input, which follows the collectors, so the same evidence
 * always produces the same review — a property worth having when the claim is
 * that the text is rendered from the record rather than generated.
 */
export function draftClaimsFromEvidence(artifacts: readonly EvidenceArtifact[]): ReviewClaim[] {
  const claims: ReviewClaim[] = [];
  for (const artifact of artifacts) claims.push(...claimsFor(artifact));
  return claims;
}
