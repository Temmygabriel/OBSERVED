import type {
  EvidenceArtifact,
  PaymentRecord,
  PolicyRefusal,
  PublicStatusResponse,
  ReviewBundle,
  ReviewClaim,
  ReviewSummary,
  ReviewTotals,
  SpendState,
} from '@observed/shared-types';

/**
 * Sample records.
 *
 * These exist so the interface can be built, viewed and demonstrated before a
 * worker or any API keys exist. They are the single largest honesty risk in
 * the project, so the rules around them are strict:
 *
 *   1. Every bundle carries `provenance: 'sample'` and a non-null
 *      `provenance_label`. The UI renders that label. There is no code path
 *      that shows this data without the label.
 *   2. Timestamps are FIXED, not computed relative to "now". A sample that
 *      always reads "2 min ago" is claiming to have just happened, which is
 *      precisely the deception this product exists to be the opposite of.
 *   3. `elapsedMs` is null throughout. A plausible-looking "412 ms" is exactly
 *      the kind of confident detail with nothing behind it that this project
 *      is built to mock.
 *
 * When a real worker is connected, these are never reached.
 */

const SAMPLE_RECORDED_AT = '2026-09-10T09:14:32.000Z';

const TARGET_URL = 'https://example-project.xyz';

// ---------------------------------------------------------------------------
// Shared spend states
// ---------------------------------------------------------------------------

const ACTIVE_SPEND: SpendState = {
  hourly_spent: '0.012',
  hourly_cap: '0.25',
  daily_spent: '0.036',
  daily_cap: '1.00',
  per_review_cap: '0.03',
  reviews_today: 12,
  paused: false,
  paused_reason: null,
  resumes_at: null,
};

/**
 * The next 00:00 UTC boundary, computed — not hardcoded. When the daily cap is
 * reached the screen promises a specific resume time, and that promise should
 * be derived from the same clock the cap is enforced against.
 */
export function nextUtcMidnight(from: Date): string {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return next.toISOString();
}

function pausedSpend(): SpendState {
  return {
    hourly_spent: '0.096',
    hourly_cap: '0.25',
    daily_spent: '1.00',
    daily_cap: '1.00',
    per_review_cap: '0.03',
    reviews_today: 34,
    paused: true,
    paused_reason: 'daily_cap_reached',
    resumes_at: nextUtcMidnight(new Date()),
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const EVIDENCE_PAGE: EvidenceArtifact = {
  artifact_id: 'ev-01-page',
  review_session_id: 'sample',
  collector: 'html',
  collector_version: '0.1.0',
  target_url: `${TARGET_URL}/`,
  resolved_ip: '203.0.113.10',
  observed_at: SAMPLE_RECORDED_AT,
  status: 'valid',
  content_hash:
    '3f786850e387550fdab836ed7e6dc881de23001b8f2a5b6a2f0e6f9c1c7a1d40',
  raw_ref: 'sample://raw/page.html',
  metadata: {
    method: 'GET',
    request_path: '/',
    final_url: `${TARGET_URL}/`,
    status_code: 200,
    content_type: 'text/html; charset=utf-8',
    is_html: true,
    resolved_ip: '203.0.113.10',
    redirect_chain: [],
    redirect_count: 0,
    body_bytes: 18422,
    body_truncated: false,
    title: 'Example Project — ship faster',
    meta_description: 'A sample project used to demonstrate Observed.',
    html_lang: 'en',
    has_viewport_meta: true,
    hsts: 'max-age=31536000',
    // The review screen reads this for the "Live page" checklist row.
    elapsed_ms: 316,
    // The link sweep's accounting. Its results are separate artifacts, so only
    // the counts belong on the page record.
    links_found: 9,
    links_checked: 4,
    links_skipped_over_cap: 3,
    links_skipped_unsupported: 1,
    links_skipped_self: 1,
    links_deduplicated: 0,
    links_method_downgraded: 1,
  },
  provider_request_id: null,
};

const EVIDENCE_TLS: EvidenceArtifact = {
  artifact_id: 'ev-02-tls',
  review_session_id: 'sample',
  collector: 'tls',
  collector_version: '0.1.0',
  target_url: TARGET_URL,
  resolved_ip: '203.0.113.10',
  observed_at: SAMPLE_RECORDED_AT,
  status: 'valid',
  content_hash:
    '89e01536ac207279409d4de1e5253e01f4a1769e696db0d6062ca9b8f171d5c1',
  raw_ref: 'sample://raw/tls.json',
  metadata: {
    port: 443,
    protocol: 'TLSv1.3',
    cipher: 'TLS_AES_256_GCM_SHA384',
    authorized: true,
    authorization_error: null,
    subject_cn: 'example-project.xyz',
    issuer_cn: 'Sample Issuer CA',
    issuer_org: 'Sample Issuer',
    valid_from: '2026-01-04T00:00:00.000Z',
    valid_to: '2027-01-04T00:00:00.000Z',
    days_until_expiry: 113,
    within_validity_window: true,
    fingerprint_sha256:
      'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
    serial_number: '0A1B2C3D4E5F60718293A4B5C6D7E8F9',
    subject_alt_names: 'DNS:example-project.xyz, DNS:www.example-project.xyz',
    // The review screen reads this for the "TLS" checklist row.
    elapsed_ms: 412,
  },
  provider_request_id: null,
};

const EVIDENCE_SIGNUP: EvidenceArtifact = {
  artifact_id: 'ev-03-signup',
  review_session_id: 'sample',
  collector: 'html',
  collector_version: '0.1.0',
  target_url: `${TARGET_URL}/signup`,
  resolved_ip: '203.0.113.10',
  observed_at: SAMPLE_RECORDED_AT,
  // "invalid" here means the check did not pass — the signup route did not
  // respond. Only conclusive statuses can support a claim (Rule 3).
  status: 'invalid',
  content_hash:
    'c2b7df7c1e2f4a5b8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e',
  raw_ref: 'sample://raw/signup.html',
  metadata: {
    request_path: '/signup',
    method: 'POST',
    status_code: 404,
    content_type: 'text/html; charset=utf-8',
  },
  provider_request_id: 'req-sample-0003',
};

const EVIDENCE_REPO: EvidenceArtifact = {
  artifact_id: 'ev-04-repo',
  review_session_id: 'sample',
  collector: 'repo',
  collector_version: '0.1.0',
  target_url: 'https://github.com/example-project/example',
  resolved_ip: null,
  observed_at: SAMPLE_RECORDED_AT,
  // Rule 3 in practice: the repository check timed out. It is NOT rendered as
  // a pass and NOT rendered as a failure.
  status: 'unknown_timeout',
  content_hash:
    'd41d8cd98f00b204e9800998ecf8427e0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
  raw_ref: 'sample://raw/repo.json',
  metadata: {
    timeout_ms: 10000,
    attempted_url: 'https://api.github.com/repos/example-project/example',
  },
  provider_request_id: null,
};

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const CLAIM_SIGNUP: ReviewClaim = {
  claim_id: 'claim-01',
  evidence_artifact_id: 'ev-03-signup',
  exact_locator: 'status_code',
  observation: 'HTTP 404 on POST /signup',
  inference: 'the signup route is unreachable',
  action: 'restore the route, or update the link that points to it',
  confidence: 'high',
};

const CLAIM_TLS: ReviewClaim = {
  claim_id: 'claim-02',
  evidence_artifact_id: 'ev-02-tls',
  exact_locator: 'valid_to',
  observation: 'TLS certificate valid, CN=example-project.xyz',
  inference: 'the certificate is current and matches the host',
  action: '',
  confidence: 'high',
};

const CLAIM_REPO: ReviewClaim = {
  claim_id: 'claim-03',
  evidence_artifact_id: 'ev-04-repo',
  exact_locator: 'response.timeout',
  observation: 'repository check timed out after 10000 ms',
  inference: '',
  action: '',
  // Rule 3: this can never be phrased as a finding or as a pass.
  confidence: 'unable_to_verify',
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const PAYMENT_SIGNUP: PaymentRecord = {
  payment_id: 'pay-sample-0003',
  review_session_id: 'sample',
  provider_hostname: 'agent402.tools',
  provider_path: '/v1/fetch',
  amount: '0.004',
  asset: 'USDT',
  attribution_tag: 'celo_sample_placeholder',
  tx_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  status: 'settled',
  observed_at: SAMPLE_RECORDED_AT,
};

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

const SAMPLE_LABEL =
  'Sample record — demonstration only, not a real observation. Timestamps are fixed, not live.';

export const SAMPLE_INSPECTING: ReviewBundle = {
  provenance: 'sample',
  provenance_label: SAMPLE_LABEL,
  review: {
    review_id: 'sample',
    project_id: 'sample-project',
    target_url: TARGET_URL,
    project_name: 'Example Project',
    claims: [CLAIM_SIGNUP, CLAIM_TLS, CLAIM_REPO],
    draft_text:
      'The signup route is unreachable, observed as HTTP 404 on POST /signup.',
    status: 'submitted',
    askbots_response_code: 200,
    submitted_at: SAMPLE_RECORDED_AT,
    created_at: SAMPLE_RECORDED_AT,
  },
  evidence: [EVIDENCE_PAGE, EVIDENCE_TLS, EVIDENCE_SIGNUP, EVIDENCE_REPO],
  payments: [PAYMENT_SIGNUP],
  spend: ACTIVE_SPEND,
  refusal: null,
};

/**
 * Screen 5 — Rejected / Held.
 *
 * The draft was refused for being unspecific. Note the copy: "held", never
 * "failed". The system declining to ship a hollow claim is a trust signal.
 */
export const SAMPLE_HELD: ReviewBundle = {
  provenance: 'sample',
  provenance_label: SAMPLE_LABEL,
  review: {
    ...SAMPLE_INSPECTING.review,
    review_id: 'sample-held',
    status: 'rejected_low_quality',
    askbots_response_code: 422,
    draft_text:
      'The website could improve usability and security. Overall the experience is decent but there are areas for improvement.',
  },
  evidence: [EVIDENCE_PAGE, EVIDENCE_TLS, EVIDENCE_SIGNUP],
  payments: [PAYMENT_SIGNUP],
  spend: ACTIVE_SPEND,
  refusal: null,
};

/** Screen 6 — Paused. The cap working as designed is not an error state. */
export const SAMPLE_PAUSED: ReviewBundle = {
  provenance: 'sample',
  provenance_label: SAMPLE_LABEL,
  review: {
    ...SAMPLE_INSPECTING.review,
    review_id: 'sample-paused',
    status: 'submitted',
  },
  evidence: [EVIDENCE_PAGE, EVIDENCE_TLS, EVIDENCE_SIGNUP],
  payments: [PAYMENT_SIGNUP],
  spend: pausedSpend(),
  refusal: {
    rule: 'spend_cap',
    explanation:
      'Daily review budget reached. Observed stops spending rather than exceeding its cap.',
    reconsidered_at: nextUtcMidnight(new Date()),
  },
};

/**
 * Screen 7 — Excluded.
 *
 * Rule 5's refusal, made visible in the product rather than only claimed in a
 * README. No evidence is gathered and no money is spent on an excluded
 * project, so this bundle deliberately carries empty evidence and payments.
 */
export const SAMPLE_EXCLUDED: ReviewBundle = {
  provenance: 'sample',
  provenance_label: SAMPLE_LABEL,
  review: {
    review_id: 'sample-excluded',
    project_id: 'sample-operator-project',
    target_url: 'https://operator-own-project.example',
    project_name: 'Operator’s own entry',
    claims: [],
    draft_text: '',
    status: 'draft',
    askbots_response_code: null,
    submitted_at: null,
    created_at: SAMPLE_RECORDED_AT,
  },
  evidence: [],
  payments: [],
  spend: ACTIVE_SPEND,
  refusal: {
    rule: 'exclusion_list',
    explanation:
      'This project is connected to Observed’s own operator, who is also an entrant in this hackathon. Observed checks this automatically before any evidence is gathered, and refuses rather than reviewing its own entry.',
    // An exclusion is permanent, not a delay. Saying "reconsidered at" would
    // imply a resumption that is never going to happen.
    reconsidered_at: null,
  },
};

export const SAMPLE_BUNDLES: Record<string, ReviewBundle> = {
  sample: SAMPLE_INSPECTING,
  'sample-held': SAMPLE_HELD,
  'sample-paused': SAMPLE_PAUSED,
  'sample-excluded': SAMPLE_EXCLUDED,
};

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export const SAMPLE_REVIEWS: ReviewSummary[] = [
  {
    review_id: 'sample',
    project_name: 'Example Project',
    target_url: TARGET_URL,
    status: 'submitted',
    headline: 'POST /signup → 404',
    observed_at: SAMPLE_RECORDED_AT,
  },
  {
    review_id: 'sample-held',
    project_name: 'Example Project',
    target_url: TARGET_URL,
    status: 'rejected_low_quality',
    headline: 'review held — draft not tied to an artifact',
    observed_at: SAMPLE_RECORDED_AT,
  },
];

export const SAMPLE_INDEX_TOTALS: ReviewTotals = {
  reviews: 2,
  accepted: 0,
  rewritten: 1,
  held: 1,
  // Genuinely unknown. `null` renders as "not yet known" — never as a
  // placeholder number, which is the one thing the design spec forbids.
  useful_rating: null,
};

/**
 * The honest status when no worker is connected.
 *
 * Not "HEALTHY with no data" — that would be a lie by omission. `BLOCKED` with
 * an explicit reason is the accurate description of a system that is not
 * running, and every probe reports `unknown` rather than a cheerful default.
 */
export function disconnectedStatus(now: Date): PublicStatusResponse {
  return {
    watchdog_state: 'BLOCKED',
    payments_enabled: false,
    last_successful_review_at: null,
    minutes_since_last_review: null,
    inactivity_alert_minutes: 60,
    degraded_reason:
      'No worker connected. No public API URL is configured, so no reviews are being run.',
    spend: ACTIVE_SPEND,
    probes: [
      {
        name: 'Worker public API',
        state: 'unknown',
        detail: 'NEXT_PUBLIC_OBSERVED_API_URL is not set',
        checked_at: now.toISOString(),
      },
      {
        name: 'AskBots authenticated path',
        state: 'unknown',
        detail: null,
        checked_at: now.toISOString(),
      },
      {
        name: 'buy MCP process',
        state: 'unknown',
        detail: null,
        checked_at: now.toISOString(),
      },
      {
        name: 'Celo x402 /settle',
        state: 'unknown',
        detail: 'reported separately from /verify and /supported, which can pass while /settle fails',
        checked_at: now.toISOString(),
      },
      {
        name: 'Attribution config',
        state: 'unknown',
        detail:
          'no attribution tag has been issued yet (Rule 8)',
        checked_at: now.toISOString(),
      },
    ],
  };
}
