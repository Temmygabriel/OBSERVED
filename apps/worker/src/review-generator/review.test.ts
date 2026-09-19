/**
 * Tests for the review loop — the first tests in this repository.
 *
 * Why these exist, in the project's own terms: nothing here executed code until
 * session 6, so "complete" meant "compiles", and a fetcher that sent nothing at
 * all survived three sessions because a type checker cannot see a missing
 * `request.end()`. The collectors now run in CI. The review loop did not, and
 * its failure mode is worse than a crash: this is the code that decides what the
 * product is allowed to SAY about somebody else's project. A bug here does not
 * throw. It publishes a confident, cited, false sentence.
 *
 * So these tests are not coverage for its own sake. Each one pins a specific
 * fabrication this codebase has already been bitten by or has explicitly
 * designed against, and most of them assert a NEGATIVE — that a particular
 * sentence is absent from the output. `assert.ok(!text.includes(...))` reads
 * oddly until you remember what the alternative is.
 *
 * The fixtures mirror metadata shapes recorded by real runs, field for field,
 * including the ones that differ between collectors (TLS has two `invalid`
 * shapes with different keys; DNS has three; the repo collector uses
 * `http_status`, not `status_code`). A fixture invented from memory would test
 * the drafter against metadata no collector produces, which is how a test suite
 * becomes decoration.
 *
 * Run: `npm test --workspace @observed/worker`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CollectorKind, EvidenceArtifact } from '@observed/shared-types';
import { draftClaimsFromEvidence } from './draft-from-evidence';
import { ClaimsHeldError, generateDraft, renderDraft, validateClaims } from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function artifact(over: Partial<EvidenceArtifact> & { collector: CollectorKind }): EvidenceArtifact {
  return {
    artifact_id: `ev-test-${over.collector}`,
    review_session_id: 'test-session',
    collector: over.collector,
    collector_version: '0.1.0',
    target_url: 'https://example.test/',
    resolved_ip: null,
    observed_at: '2026-09-19T12:00:00.000Z',
    status: 'valid',
    content_hash: 'a'.repeat(64),
    raw_ref: `inline://${over.collector}/test`,
    metadata: {},
    provider_request_id: null,
    ...over,
  };
}

/**
 * The eight artifacts a real run produced, with the metadata the collectors
 * actually recorded. Everything the drafter claims about the world has to come
 * out of these fields and nothing else.
 */
function realRun(): EvidenceArtifact[] {
  const session = 'obs-2026-09-19T12-00-00-000Z-abc123';

  return [
    artifact({
      collector: 'dns',
      artifact_id: `ev-${session}-dns`,
      target_url: 'https://celobuilders.xyz',
      resolved_ip: '137.184.23.32',
      raw_ref: 'inline://dns/celobuilders.xyz',
      metadata: {
        hostname: 'celobuilders.xyz',
        addresses: ['137.184.23.32'],
        address_count: 1,
        non_public_addresses: [],
        elapsed_ms: 41,
      },
    }),
    artifact({
      collector: 'tls',
      artifact_id: `ev-${session}-tls`,
      target_url: 'https://celobuilders.xyz',
      resolved_ip: '137.184.23.32',
      raw_ref: 'inline://tls/finding',
      metadata: {
        port: 443,
        protocol: 'TLSv1.3',
        cipher: 'TLS_AES_256_GCM_SHA384',
        authorized: true,
        authorization_error: null,
        subject_cn: 'celobuilders.xyz',
        issuer_cn: 'YE1',
        issuer_org: "Let's Encrypt",
        valid_from: 'Aug  1 10:06:51 2026 GMT',
        valid_to: 'Nov  1 10:06:50 2026 GMT',
        days_until_expiry: 42,
        within_validity_window: true,
        serial_number: '00AB',
        subject_alt_names: ['celobuilders.xyz'],
        elapsed_ms: 120,
      },
    }),
    artifact({
      collector: 'repo',
      artifact_id: `ev-${session}-repo`,
      target_url: 'https://github.com/Temmygabriel/OBSERVED',
      resolved_ip: '140.82.113.5',
      raw_ref: 'inline://repo/finding',
      metadata: {
        http_status: 200,
        full_name: 'Temmygabriel/OBSERVED',
        default_branch: 'main',
        head_commit_at: '2026-09-19T16:31:50Z',
        has_license: false,
        rate_limited: false,
        distinguishable_from_private: true,
      },
    }),
    artifact({
      collector: 'html',
      artifact_id: `ev-${session}-html`,
      target_url: 'https://celobuilders.xyz',
      resolved_ip: '208.103.161.33',
      raw_ref: 'store://raw/abc123',
      metadata: {
        status_code: 200,
        final_url: 'https://celoplatform.notion.site/Agents-at-Work-Hackathon-3c1d5cb8',
        content_type: 'text/html; charset=utf-8',
        is_html: true,
        title: 'Agents at Work Hackathon | Notion',
        title_length: 32,
        meta_description: null,
        html_lang: 'en',
        has_viewport_meta: true,
        redirect_count: 1,
        body_bytes: 40000,
        body_truncated: false,
        // The sweep's own accounting, spread onto the page record by `html.ts`.
        links_found: 4,
        links_checked: 4,
        links_skipped_over_cap: 0,
        links_skipped_unsupported: 0,
        links_skipped_self: 0,
        links_deduplicated: 0,
        links_method_downgraded: 0,
      },
    }),
    // A healthy link with no redirect. The drafter is expected to say NOTHING
    // about it individually — see the 'links' claim drawn from the page above.
    artifact({
      collector: 'html',
      artifact_id: `ev-${session}-link-0`,
      target_url: 'https://www.youtube.com/watch?v=J5jC7HJMwVI',
      resolved_ip: '142.251.155.4',
      raw_ref: 'inline://link/0-watch',
      metadata: {
        method: 'GET',
        declared_method: 'GET',
        method_downgraded: false,
        kind: 'link',
        href: 'https://www.youtube.com/watch?v=J5jC7HJMwVI',
        found_on: 'https://celobuilders.xyz',
        status_code: 200,
        refused_by_status: false,
        redirect_count: 0,
        content_type: 'text/html; charset=utf-8',
        body_bytes: 512,
        body_truncated: false,
        bytes_sent: 0,
        elapsed_ms: 300,
      },
    }),
  ];
}

/** The rendered review for a set of artifacts, through the real pipeline. */
async function review(artifacts: EvidenceArtifact[]): Promise<string> {
  const draft = await generateDraft(artifacts);
  return draft.draft_text;
}

// ---------------------------------------------------------------------------
// The loop, end to end
// ---------------------------------------------------------------------------

test('the loop produces a review from a real run, holding nothing', async () => {
  const artifacts = realRun();
  const draft = await generateDraft(artifacts);

  assert.ok(draft.claims.length > 0, 'a real run must produce claims');
  assert.deepEqual(draft.held_reasons, [], 'no claim built from a collected artifact may be refused');
  assert.ok(draft.draft_text.length > 0, 'the review must have text');
});

test('every claim cites an artifact that was actually collected', () => {
  const artifacts = realRun();
  const claims = draftClaimsFromEvidence(artifacts);
  const held = new Set(artifacts.map((a) => a.artifact_id));

  for (const claim of claims) {
    assert.ok(
      held.has(claim.evidence_artifact_id),
      `claim ${claim.claim_id} cites ${claim.evidence_artifact_id}, which is not in the bundle`,
    );
  }
});

test('the rendered review never leaks a raw field name or a missing value', async () => {
  const text = await review(realRun());

  // A review that says "resolves to undefined" is a fabricated observation with
  // a hash attached to it. This is the assertion that stops the typed readers
  // in the drafter from being "defensive" in name only.
  for (const leak of ['undefined', 'null', 'NaN', '[object Object]']) {
    assert.ok(!text.includes(leak), `the review contains "${leak}": ${text}`);
  }
});

test('every sentence in the review starts uppercase', async () => {
  const text = await review(realRun());

  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const first = sentence.trim().charAt(0);
    if (first === '') continue;
    assert.equal(
      first,
      first.toUpperCase(),
      `a sentence starts lowercase: "${sentence}" — renderDraft must capitalise observations with no inference`,
    );
  }
});

test('the same evidence always produces the same review', async () => {
  const artifacts = realRun();
  const first = await review(artifacts);
  const second = await review(artifacts);

  assert.equal(first, second, 'the review must be a pure function of the evidence record');
});

test('the review attributes the facts it observed, and does not invent others', async () => {
  const text = await review(realRun());

  // Drawn from the fixture's own fields.
  assert.ok(text.includes('137.184.23.32'), 'the resolved address must appear');
  assert.ok(text.includes('celobuilders.xyz'), 'the hostname must appear');
  assert.ok(text.includes('Agents at Work Hackathon | Notion'), 'the observed title must appear');
  assert.ok(text.includes('Temmygabriel/OBSERVED'), 'the repository must appear');
  assert.ok(text.includes('42 days remaining'), 'the certificate expiry must appear');
});

test('an empty bundle is refused rather than answered', async () => {
  await assert.rejects(() => generateDraft([]), ClaimsHeldError);
});

// ---------------------------------------------------------------------------
// Rule 3 — an `unknown_*` observation can never become an assertion
// ---------------------------------------------------------------------------

const UNKNOWN_CASES: Array<{ name: string; build: () => EvidenceArtifact }> = [
  {
    name: 'dns timeout',
    build: () =>
      artifact({
        collector: 'dns',
        status: 'unknown_timeout',
        raw_ref: 'inline://dns/unavailable/example.test',
        metadata: { hostname: 'example.test', error: 'query timed out' },
      }),
  },
  {
    name: 'tls network error',
    build: () =>
      artifact({
        collector: 'tls',
        status: 'unknown_network_error',
        raw_ref: 'inline://tls/unavailable',
        metadata: { port: 443, error: 'ECONNRESET', certificate_finding: false, target_refused: false },
      }),
  },
  {
    name: 'page timeout',
    build: () =>
      artifact({
        collector: 'html',
        status: 'unknown_timeout',
        raw_ref: 'store://raw/x',
        metadata: { error: 'the request exceeded its deadline' },
      }),
  },
  {
    name: 'repo rate limited',
    build: () =>
      artifact({
        collector: 'repo',
        status: 'unknown_network_error',
        raw_ref: 'inline://repo/unavailable',
        metadata: { rate_limited: true, detail: 'the GitHub API rate limit was reached' },
      }),
  },
  {
    name: 'link refused by status',
    build: () =>
      artifact({
        collector: 'html',
        status: 'unknown_network_error',
        raw_ref: 'inline://link/0-watch/unavailable',
        target_url: 'https://www.youtube.com/watch?v=J5jC7HJMwVI',
        metadata: {
          href: 'https://www.youtube.com/watch?v=J5jC7HJMwVI',
          status_code: 429,
          refused_by_status: true,
        },
      }),
  },
];

for (const { name, build } of UNKNOWN_CASES) {
  test(`an unknown observation asserts nothing: ${name}`, async () => {
    const one = [build()];
    const claims = draftClaimsFromEvidence(one);

    assert.equal(claims.length, 1, 'an unknown artifact produces exactly one claim');
    const claim = claims[0]!;
    assert.equal(claim.confidence, 'unable_to_verify', 'confidence must not be an assertion');
    assert.equal(claim.inference, '', 'an unknown observation supports no inference at all');
    assert.equal(claim.action, '', 'nothing may be recommended from an observation we do not have');
    assert.notEqual(claim.observation.trim(), '', 'it still has to say what we failed to observe');

    const text = await review(one);
    assert.ok(text.startsWith('Unable to verify:'), `expected a refusal, got: ${text}`);
  });
}

test('a link refused with 429 is never published as a broken link', async () => {
  const claims = draftClaimsFromEvidence(UNKNOWN_CASES[4]!.build());
  const text = await review([UNKNOWN_CASES[4]!.build()]);

  assert.ok(!text.includes('broken'), 'a throttled link is not a broken link');
  assert.ok(!text.includes('404'), 'no status code may be invented');
  assert.equal(claims.length, 1);
});

// ---------------------------------------------------------------------------
// The specific traps, one test each
// ---------------------------------------------------------------------------

test('an unreadable repository is never described as not existing', async () => {
  // GitHub answers 404 for a private repository to an unauthenticated caller, so
  // `repo.ts` records `distinguishable_from_private: false`. The claim may say
  // "not publicly readable" and must never say "does not exist".
  const one = artifact({
    collector: 'repo',
    status: 'invalid',
    target_url: 'https://github.com/someone/private-repo',
    raw_ref: 'inline://repo/not-found',
    metadata: {
      http_status: 404,
      reason: 'not_found',
      detail: 'the API answered 404',
      distinguishable_from_private: false,
    },
  });

  const text = await review([one]);

  assert.ok(text.includes('not publicly readable'), `expected the careful wording, got: ${text}`);
  assert.ok(!text.includes('does not exist'), `claimed absence from a 404: ${text}`);
  assert.ok(text.includes('private'), 'it must name the indistinguishable case');
});

test('a repository that IS distinguishable may say it does not exist', async () => {
  const one = artifact({
    collector: 'repo',
    status: 'invalid',
    raw_ref: 'inline://repo/not-found',
    metadata: { http_status: 404, detail: 'gone', distinguishable_from_private: true },
  });

  const text = await review([one]);
  assert.ok(text.includes('does not exist'), `expected the definite wording, got: ${text}`);
});

test('DNS reports the cause the collector recorded, not one inferred from shape', async () => {
  // A malformed target URL has no `hostname` field at all. Deriving a cause from
  // the metadata's shape would describe our own bad input as a property of
  // somebody's domain — "this domain publishes no address record".
  const one = artifact({
    collector: 'dns',
    status: 'invalid',
    target_url: 'not-a-url',
    raw_ref: 'inline://dns/malformed-target',
    metadata: { error: 'target_url is not a valid absolute URL' },
  });

  const text = await review([one]);

  assert.ok(text.includes('not a valid absolute URL'), `expected the recorded error, got: ${text}`);
  assert.ok(!text.includes('publishes no address record'), `invented a DNS cause: ${text}`);
});

test('a private-space answer is a citable finding, not a refusal to look', async () => {
  const one = artifact({
    collector: 'dns',
    status: 'invalid',
    raw_ref: 'inline://dns/example.test',
    metadata: {
      hostname: 'example.test',
      addresses: ['10.0.0.5'],
      address_count: 1,
      non_public_addresses: ['10.0.0.5'],
    },
  });

  const text = await review([one]);

  assert.ok(text.includes('10.0.0.5'), `the address must be named: ${text}`);
  assert.ok(text.includes('non-public'), `expected the finding, got: ${text}`);
});

test('a refused TLS connection does not claim the certificate was checked', async () => {
  const one = artifact({
    collector: 'tls',
    status: 'invalid',
    raw_ref: 'inline://tls/finding',
    metadata: {
      port: 443,
      error: 'the target resolved to a non-public address',
      certificate_finding: false,
      target_refused: true,
    },
  });

  const text = await review([one]);

  assert.ok(text.includes('refused the connection'), `expected the refusal, got: ${text}`);
  assert.ok(
    !text.includes('certificate warning'),
    `a connection never made cannot produce a certificate finding: ${text}`,
  );
});

test('a completed handshake with an untrusted certificate is not called a refusal', async () => {
  // The other `invalid` shape: the handshake FINISHED and `trustworthy` was
  // still false. It carries `authorized`/`within_validity_window` and neither of
  // the two finding flags. Reading it as a refusal would state "the TLS check
  // could not be completed" about a check that completed and found a bad
  // certificate — a false statement about our own behaviour.
  const one = artifact({
    collector: 'tls',
    status: 'invalid',
    raw_ref: 'inline://tls/finding',
    metadata: {
      port: 443,
      protocol: 'TLSv1.2',
      authorized: false,
      authorization_error: 'certificate has expired',
      subject_cn: 'example.test',
      valid_to: 'Jan  1 00:00:00 2026 GMT',
      within_validity_window: false,
    },
  });

  const text = await review([one]);

  assert.ok(text.includes('certificate'), `expected a certificate finding, got: ${text}`);
  assert.ok(!text.includes('could not be completed'), `an assertion about our own failure: ${text}`);
  assert.ok(text.includes('expired'), `the recorded reason must survive: ${text}`);
});

test('a bad certificate and a refusal are different claims from the same status', async () => {
  const cert = artifact({
    collector: 'tls',
    status: 'invalid',
    raw_ref: 'inline://tls/finding',
    metadata: { port: 443, error: 'self signed certificate', certificate_finding: true, target_refused: false },
  });
  const refused = artifact({
    collector: 'tls',
    status: 'invalid',
    raw_ref: 'inline://tls/finding',
    metadata: { port: 443, error: 'blocked port', certificate_finding: false, target_refused: true },
  });

  const certText = await review([cert]);
  const refusedText = await review([refused]);

  assert.notEqual(certText, refusedText, 'two different causes must not render identically');
  assert.ok(certText.includes('certificate'));
  assert.ok(!refusedText.includes('certificate warning'));
});

test('a link artifact and the page artifact are told apart by raw_ref alone', async () => {
  // Both carry `collector: 'html'` — MEMORY.md decision 22. If they were merged,
  // "the page returned 404" and "a link on the page returned 404" would be the
  // same claim, and only one of them is true at a time.
  const page = artifact({
    collector: 'html',
    raw_ref: 'store://raw/page',
    status: 'invalid',
    metadata: { status_code: 404 },
  });
  const link = artifact({
    collector: 'html',
    raw_ref: 'inline://link/2-pricing',
    status: 'invalid',
    target_url: 'https://example.test/pricing',
    metadata: { href: '/pricing', status_code: 404 },
  });

  const pageText = await review([page]);
  const linkText = await review([link]);

  assert.ok(pageText.includes('the URL returned HTTP 404'), `page claim: ${pageText}`);
  assert.ok(linkText.includes('the link'), `link claim must name the link: ${linkText}`);
  assert.ok(linkText.includes('/pricing'), `the link must be identifiable: ${linkText}`);
});

test('a refusal by the SSRF guard is a finding about the published link', async () => {
  const one = artifact({
    collector: 'html',
    status: 'invalid',
    raw_ref: 'inline://link/3-admin/refused',
    target_url: 'http://10.0.0.5/admin',
    metadata: {
      href: 'http://10.0.0.5/admin',
      status_code: null,
      error: 'the target resolved to a non-public address',
      refusal: 'the target resolved to a non-public address',
    },
  });

  const text = await review([one]);
  assert.ok(text.includes('non-public address space'), `expected the refusal finding, got: ${text}`);
});

// ---------------------------------------------------------------------------
// Link sweep coverage
// ---------------------------------------------------------------------------

test('the page claim reports link coverage without claiming the links work', async () => {
  const one = artifact({
    collector: 'html',
    raw_ref: 'store://raw/page',
    metadata: {
      status_code: 200,
      is_html: true,
      has_viewport_meta: true,
      links_found: 60,
      links_checked: 12,
      links_skipped_over_cap: 48,
      links_skipped_unsupported: 0,
    },
  });

  const claims = draftClaimsFromEvidence(one);
  const links = claims.find((c) => c.claim_id.endsWith('#links'));
  assert.ok(links, 'a page with links must report coverage');
  const coverage = links!;

  assert.ok(coverage.observation.includes('60'), 'the declared count must appear');
  assert.ok(coverage.observation.includes('12'), 'the probed count must appear');
  assert.ok(coverage.observation.includes('48'), 'the skipped count must be stated, not hidden');

  // `links_checked` counts links PROBED, not links that worked — a 404 counts as
  // checked. Reading health out of it would assert something the record does not
  // contain, and a broken link already has a claim citing its own artifact.
  assert.equal(coverage.inference, '', 'coverage supports no inference about the links');
  for (const word of ['work', 'valid', 'reachable', 'all']) {
    assert.ok(
      !coverage.observation.includes(word),
      `the coverage claim implies link health ("${word}"): ${coverage.observation}`,
    );
  }
});

test('healthy links produce no claims of their own', () => {
  const healthy = artifact({
    collector: 'html',
    raw_ref: 'inline://link/0-root',
    metadata: { status_code: 200, redirect_count: 0 },
  });

  assert.deepEqual(
    draftClaimsFromEvidence([healthy]),
    [],
    'a working link with no redirect is not worth a sentence — the review length has to mean something',
  );
});

test('a link that redirects is worth exactly one sentence', () => {
  const moved = artifact({
    collector: 'html',
    raw_ref: 'inline://link/1-docs',
    target_url: 'https://example.test/docs',
    metadata: { href: '/docs', status_code: 200, redirect_count: 2 },
  });

  const claims = draftClaimsFromEvidence([moved]);
  assert.equal(claims.length, 1);
  assert.ok(claims[0]!.observation.includes('/docs'));
  assert.equal(claims[0]!.inference, 'the link works but its destination has moved');
});

// ---------------------------------------------------------------------------
// The validator still guards the seam a model would use
// ---------------------------------------------------------------------------

test('validateClaims refuses a claim citing an artifact we do not hold', () => {
  const artifacts = realRun();
  const invented = draftClaimsFromEvidence(artifacts);
  const first = invented[0]!;

  const { accepted, held } = validateClaims(
    [{ ...first, evidence_artifact_id: 'ev-does-not-exist' }],
    artifacts,
  );

  assert.equal(accepted.length, 0, 'an invented citation must not be accepted');
  assert.equal(held.length, 1);
  assert.ok(held[0]!.includes('which was not collected'), held[0]);
});

test('validateClaims sees through a drafter that asserts on an unknown artifact', () => {
  // The drafter does not do this — the test exists because a MODEL at this seam
  // could, which is the whole reason the gate is separate from the drafter.
  const unknown = UNKNOWN_CASES[0]!.build();
  const forged = {
    claim_id: 'forged#1',
    evidence_artifact_id: unknown.artifact_id,
    exact_locator: 'metadata.error',
    observation: 'the hostname did not resolve',
    inference: 'the domain does not exist',
    action: 'register the domain',
    confidence: 'high' as const,
  };

  const { accepted } = validateClaims([forged], [unknown]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.confidence, 'unable_to_verify', 'the gate must correct the confidence');
  assert.equal(renderDraft(accepted).startsWith('Unable to verify:'), true);
});
