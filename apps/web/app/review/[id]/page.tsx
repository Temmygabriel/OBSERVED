import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type {
  CollectorKind,
  EvidenceArtifact,
  ReviewBundle,
  ReviewClaim,
} from '@observed/shared-types';
import { evidenceStatusToCopyState } from '@observed/shared-types';
import { ClaimCard } from '@/components/ClaimCard';
import { ExcludedScreen } from '@/components/ExcludedScreen';
import { HeldScreen } from '@/components/HeldScreen';
import { HeroSequence, type HeroCheck } from '@/components/HeroSequence';
import { PausedScreen } from '@/components/PausedScreen';
import { ProvenanceBanner } from '@/components/ProvenanceBanner';
import { metaNumber, metaText } from '@/lib/claims';
import {
  getReviewBundle,
  getSampleBundle,
  isConnected,
  isSampleReviewId,
} from '@/lib/data';
import { compactUrl } from '@/lib/format';

/**
 * Screen 2 (Live review / the hero), plus Screens 5, 6 and 7 as real states of
 * the same route.
 *
 * The surface is chosen from the POLICY OUTCOME, not from the URL. Excluded
 * and Paused are what the pipeline actually returned for this project; they are
 * not separate hardcoded pages, which is what the design spec requires.
 */

type ReviewLookup =
  | { kind: 'found'; bundle: ReviewBundle }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: string };

async function lookupReview(reviewId: string): Promise<ReviewLookup> {
  // Samples are only ever reached by their own explicit id. They are never a
  // fallback for a failed or missing real review.
  if (isSampleReviewId(reviewId)) {
    const bundle = getSampleBundle(reviewId);
    return bundle ? { kind: 'found', bundle } : { kind: 'missing' };
  }

  const loaded = await getReviewBundle(reviewId);
  if (loaded.status === 'ok') return { kind: 'found', bundle: loaded.data };
  return { kind: 'unavailable', reason: loaded.reason };
}

function artifactFor(
  evidence: EvidenceArtifact[],
  claim: ReviewClaim,
): EvidenceArtifact | null {
  return (
    evidence.find((item) => item.artifact_id === claim.evidence_artifact_id) ??
    null
  );
}

/**
 * The first artifact from a collector.
 *
 * This is used for the checklist rows, which report one duration per check, and
 * it is only correct because of an ordering guarantee on the worker side: the
 * HTML collector emits the PAGE artifact first and its link artifacts after, and
 * the orchestrator preserves that order. Taking the first `html` artifact is
 * therefore the page.
 *
 * If that order ever changes, this silently starts reporting a link's timing as
 * the page's. The fix then is to select by artifact id (`ev-<session>-html`)
 * rather than by position.
 */
function firstOfCollector(
  evidence: EvidenceArtifact[],
  collector: CollectorKind,
): EvidenceArtifact | undefined {
  return evidence.find((item) => item.collector === collector);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const lookup = await lookupReview(id);
  if (lookup.kind !== 'found') return { title: 'Review' };

  const name =
    lookup.bundle.review.project_name ?? compactUrl(lookup.bundle.review.target_url);
  return { title: name };
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ play?: string }>;
}) {
  const { id } = await params;
  const { play } = await searchParams;

  const lookup = await lookupReview(id);

  if (lookup.kind === 'missing') notFound();

  if (lookup.kind === 'unavailable') {
    return (
      <div className="stack">
        <h1 className="h1">That review isn&rsquo;t available.</h1>
        <p className="lede">{lookup.reason}</p>
        <p className="meta">
          This is not the same as &ldquo;no review exists&rdquo;. Observed
          distinguishes the two on purpose.
        </p>
      </div>
    );
  }

  const { bundle } = lookup;
  const { review, evidence, refusal, spend } = bundle;

  // The policy outcome decides which screen this is. Order matters: an
  // exclusion is checked before anything is spent, so it wins over a cap.
  const surface = (() => {
    if (refusal?.rule === 'exclusion_list') return 'excluded' as const;
    if (refusal?.rule === 'spend_cap' || spend.paused) return 'paused' as const;
    if (review.status === 'rejected_low_quality') return 'held' as const;
    return 'inspecting' as const;
  })();

  const provenanceBanner = (
    <ProvenanceBanner
      provenance={bundle.provenance}
      label={bundle.provenance_label}
    />
  );

  if (surface === 'excluded' && refusal) {
    return (
      <div className="stack">
        {provenanceBanner}
        <ExcludedScreen refusal={refusal} />
      </div>
    );
  }

  if (surface === 'paused') {
    return (
      <div className="stack">
        {provenanceBanner}
        <PausedScreen spend={spend} refusal={refusal} />
      </div>
    );
  }

  if (surface === 'held') {
    return (
      <div className="stack">
        {provenanceBanner}
        <HeldScreen
          review={review}
          evidence={evidence}
          canRewrite={isConnected()}
        />
      </div>
    );
  }

  const primaryClaim = review.claims[0] ?? null;
  const remainingClaims = primaryClaim ? review.claims.slice(1) : [];
  const primaryArtifact = primaryClaim
    ? artifactFor(evidence, primaryClaim)
    : null;

  // The hero is the *live* review screen. A finished review reads as a plain
  // list of claims instead — replaying an animation over last week's review
  // would dress up a historical record as if it were happening now.
  const showHero =
    play === '1' ||
    review.status === 'draft' ||
    review.status === 'submitted';

  const heroChecks: HeroCheck[] = [
    {
      label: 'Live page',
      elapsedMs: metaNumber(firstOfCollector(evidence, 'html'), 'elapsed_ms'),
    },
    {
      label: 'TLS',
      elapsedMs: metaNumber(firstOfCollector(evidence, 'tls'), 'elapsed_ms'),
    },
    // The link sweep is part of the same HTML pass, and a per-link duration is
    // not recorded separately — so this one reports nothing rather than
    // borrowing a number that belongs to a different check.
    { label: 'Broken links', elapsedMs: null },
  ];

  if (showHero && primaryClaim) {
    const method = primaryArtifact
      ? metaText(primaryArtifact, 'method')
      : null;
    const path = primaryArtifact
      ? metaText(primaryArtifact, 'request_path')
      : null;
    const statusCode = primaryArtifact
      ? metaText(primaryArtifact, 'status_code')
      : null;

    return (
      <div className="stack" style={{ gap: 'var(--s6)' }}>
        {provenanceBanner}

        <HeroSequence
          projectName={review.project_name}
          targetUrl={review.target_url}
          fact={{
            request: `${method ?? 'GET'} ${path ?? compactUrl(review.target_url)}`,
            result: statusCode ?? primaryClaim.observation,
            observedAt: primaryArtifact?.observed_at ?? review.created_at,
          }}
          copyState={
            primaryArtifact
              ? evidenceStatusToCopyState(primaryArtifact.status)
              : 'Unable to verify'
          }
          checks={heroChecks}
          claim={primaryClaim}
          artifact={primaryArtifact}
        />

        {remainingClaims.length > 0 ? (
          <section className="stack stack--tight">
            <h2 className="h2">Also observed</h2>
            {remainingClaims.map((claim, index) => (
              <ClaimCard
                key={claim.claim_id}
                claim={claim}
                artifact={artifactFor(evidence, claim)}
                index={index + 2}
              />
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      {provenanceBanner}

      <header className="stack stack--tight">
        <h1 className="h1">
          {review.project_name ?? compactUrl(review.target_url)}
        </h1>
        <p className="mono muted" style={{ margin: 0 }}>
          {review.target_url}
        </p>
      </header>

      {review.claims.length > 0 ? (
        <div className="stack">
          {review.claims.map((claim, index) => (
            <ClaimCard
              key={claim.claim_id}
              claim={claim}
              artifact={artifactFor(evidence, claim)}
              index={index + 1}
            />
          ))}
        </div>
      ) : (
        <section className="state">
          <h2 className="state__title">No claims were recorded.</h2>
          <p className="state__body">
            This review produced no observation conclusive enough to support a
            claim. That is a result, not a failure.
          </p>
        </section>
      )}
    </div>
  );
}
