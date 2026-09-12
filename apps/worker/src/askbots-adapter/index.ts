/**
 * AskBots Adapter — the only component holding the AskBots API key.
 *
 * Two jobs, and the second one is the interesting one.
 *
 * 1. Poll for reviewable projects and submit finished reviews.
 *
 * 2. Handle the `422 low_quality` response as a REWRITE REQUEST, not an error.
 *    This is the "Rewritten, not failed" framing from the UX spec, and it is
 *    the difference between a bot that looks broken and a bot that looks like
 *    it has standards. A 422 means AskBots found the draft unspecific — so the
 *    review goes back to the Review Generator to be rewritten FROM THE SAME
 *    EVIDENCE. No new collection, no new spend, no new paid call. The evidence
 *    was already bought; only the sentence was wrong.
 *
 * That second point is why this module takes a rewrite callback rather than
 * re-running the pipeline: re-running would spend money to fix a writing
 * problem, and the spend ledger would show it.
 */

import type { ReviewSubmission } from '@observed/shared-types';

export interface AskBotsProject {
  project_id: string;
  target_url: string;
  project_name: string | null;
  github_owner: string | null;
  telegram_handle: string | null;
  wallet_addresses: string[] | null;
  erc8004_agent_id: string | null;
}

export type SubmissionResult =
  | { kind: 'accepted'; response_code: number }
  | { kind: 'rewrite_requested'; response_code: 422; detail: string | null }
  | { kind: 'rejected'; response_code: number; detail: string | null }
  /** Rate limited, or the API did not answer. Not a verdict on the review. */
  | { kind: 'inconclusive'; detail: string };

/**
 * The rewrite path. Per the UX spec this may run more than once, but it must
 * never collect new evidence and must never make a paid call — which is why
 * the callback signature takes no budget and no provider, only the submission.
 */
export type RewriteFn = (
  submission: ReviewSubmission,
) => Promise<ReviewSubmission>;

export interface SubmitOptions {
  /** Rewrites attempted before giving up. Each one is free. */
  max_rewrites?: number;
  rewrite?: RewriteFn;
}

const DEFAULT_MAX_REWRITES = 2;

/**
 * Classify a response code.
 *
 * Note that only 422 is a rewrite. A 400 is a malformed request from us, a 401
 * is a credential problem, a 429 is a rate limit — none of those are statements
 * about the review's quality, and treating them as "rewrite it" would burn the
 * rewrite budget on a problem rewriting cannot fix.
 */
export function classifyResponse(
  code: number,
  detail: string | null,
): SubmissionResult {
  if (code >= 200 && code < 300) return { kind: 'accepted', response_code: code };
  if (code === 422) {
    return { kind: 'rewrite_requested', response_code: 422, detail };
  }
  if (code === 429 || code === 503 || code === 504) {
    return {
      kind: 'inconclusive',
      detail: `AskBots answered ${code}; this is a transport problem, not a verdict on the review.`,
    };
  }
  return { kind: 'rejected', response_code: code, detail };
}

/**
 * Submit, rewriting on 422 up to the limit.
 *
 * The returned `submission` is the version that was actually accepted, so the
 * audit ledger records the text that shipped rather than the first draft.
 */
export async function submitWithRewrites(
  submission: ReviewSubmission,
  send: (candidate: ReviewSubmission) => Promise<SubmissionResult>,
  options: SubmitOptions = {},
): Promise<{ result: SubmissionResult; submission: ReviewSubmission; rewrites: number }> {
  const maxRewrites = options.max_rewrites ?? DEFAULT_MAX_REWRITES;

  let current = submission;
  let rewrites = 0;

  for (;;) {
    const result = await send(current);

    if (result.kind !== 'rewrite_requested') {
      return { result, submission: current, rewrites };
    }

    if (rewrites >= maxRewrites || !options.rewrite) {
      // Out of rewrites. The 422 is returned as-is: the review stays held, and
      // that is reported honestly rather than being resent until it sticks.
      return { result, submission: current, rewrites };
    }

    current = await options.rewrite(current);
    rewrites += 1;
  }
}

/**
 * NOT IMPLEMENTED YET.
 *
 * What remains: the HTTP calls themselves, plus the day-one verification the
 * build spec insists on. The spec flags a live contradiction about submission
 * cadence — the hackathon page describes daily limits scaling 2→5→15→50 with
 * account age and rating, while a separate read of askbots.ai/docs describes no
 * daily cap and one-review-per-project, first-come-first-paid.
 *
 * Those cannot both be true, and guessing wrong means either submitting into a
 * 429 wall or leaving reviews unsubmitted. So the limit gets MEASURED against
 * the live API rather than assumed, and the measured number is what the Policy
 * Engine enforces. `ASKBOTS_DAILY_LIMIT_UNRESOLVED` in the web app's config is
 * the flag that stays true until that measurement exists.
 */
export async function pollProjects(): Promise<AskBotsProject[]> {
  throw new Error(
    'askbots-adapter.pollProjects is not implemented yet — needs the live base URL verified against skill.md first',
  );
}
