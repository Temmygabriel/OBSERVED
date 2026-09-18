/**
 * The link sweep — the second pass over a page's parsed body.
 *
 * It exists because of what it must NOT do: fold per-link results into the
 * page's own status. A page can be perfectly live while three of its links are
 * unreachable, and "3 links unverified" is not a property of the page. So this
 * pass produces ONE ARTIFACT PER LINK, each with its own tri-state, each
 * separately citable, and none of them touching the page's status.
 *
 * The shape matches the sample record: the claim "HTTP 404 on POST /signup"
 * points at an artifact of its own (`ev-03-signup`), not at the page.
 *
 * ── The POST rule, which is the part to review ──────────────────────────────
 *
 * A form's action is probed with the method the form declares, because that is
 * the only way to find out whether the route the form actually submits to
 * exists — the spec's own worked example is `POST /signup -> 404`. That is an
 * outward-facing request against somebody else's live product, so it is fenced:
 *
 *   1. THE BODY IS ALWAYS EMPTY. The question is "does this route exist", never
 *      "what happens if someone signs up". No field values are ever sent.
 *   2. POST IS SAME-SITE ONLY. A cross-origin form action is a third-party form
 *      service, and POSTing to one is precisely the case that sends real mail or
 *      files a real record somewhere we do not control. Those are probed with
 *      GET, which is defined as safe, and the artifact records that the method
 *      was downgraded rather than pretending the POST was made.
 *   3. A POST NEVER FOLLOWS A REDIRECT (enforced in `fetchPinned`). A 3xx means
 *      the request was accepted and did something; following it would do that
 *      thing again somewhere nobody validated.
 *
 * Together those mean the only POST we ever send is an empty one to the reviewed
 * project's own form handler — which is what the demo claims and nothing more.
 */

import { createHash } from 'node:crypto';
import type { EvidenceArtifact } from '@observed/shared-types';
import { BlockedTargetError, ResolutionFailedError } from '../ssrf-guard';
import { ProbeTimeoutError } from '../probe-timeout';
import { TooManyRedirectsError, fetchPinned } from '../pinned-request';
import { classifyFailure, type CollectorContext } from './types';

/**
 * How many links one page is allowed to cost us.
 *
 * Each entry is a request to somebody else's server, and a page with 400 links
 * would turn one review into 400. The first N in document order are taken —
 * navigation and hero links, which are the ones a review is actually about —
 * and the remainder are COUNTED, never silently dropped.
 */
const MAX_LINKS = 12;

/** A link body is never read for content, only to know the route answered. */
const LINK_BODY_CAP = 64 * 1024;

/** Per link, and capped below the page's own budget so one dead host cannot eat the sweep. */
const LINK_TIMEOUT_CAP_MS = 5_000;

const LINK_MAX_REDIRECTS = 2;

/** Sent for POST probes. Empty by design — see rule 1 at the top of this file. */
const EMPTY_BODY = new Uint8Array(0);

/**
 * Whether a form's declared POST is actually sent, or weakened to a GET.
 *
 * THIS IS THE ONE SWITCH FOR THE WHOLE POST QUESTION, and it is off.
 *
 * Off means: every link and every form is probed with GET, which is defined as
 * safe and changes nothing on the target. A form is still detected, still
 * checked, and still citable — the artifact records `declared_method: "POST"`
 * with `method: "GET"`, so the review says "probed with GET" rather than
 * implying a submission happened. Nothing is hidden; only the side effect is
 * withheld.
 *
 * On means: a form that declares POST, whose action is on the reviewed
 * project's OWN site, is genuinely submitted with an EMPTY body. That is the
 * build spec's worked example (`POST /signup -> 404`), and it is the only way to
 * observe whether the route a form really submits to exists. It also means that
 * when a project's signup form WORKS, we have just signed up for it — on a real
 * product belonging to someone else in this hackathon.
 *
 * Turned off 2026-09-13 by the operator, who did not want to authorise an
 * outward-facing side effect before understanding it. That is the correct order
 * for this decision: the switch is one line, and it should only be flipped with
 * the demo's target sites in front of you.
 */
const SEND_FORM_POST = false;

export interface SweepStats {
  links_found: number;
  links_checked: number;
  /** Beyond `MAX_LINKS`. Counted so the page record can say so out loud. */
  links_skipped_over_cap: number;
  /** `mailto:`, `tel:`, `javascript:`, `data:` — links, but not fetchable ones. */
  links_skipped_unsupported: number;
  /** The page linking to itself. Observed already; not worth a second request. */
  links_skipped_self: number;
  links_deduplicated: number;
  /** Forms whose declared POST was downgraded to GET because it was cross-site. */
  links_method_downgraded: number;
}

interface LinkTarget {
  method: 'GET' | 'POST';
  /** The method the document declared, which may differ from `method`. */
  declared_method: string;
  url: string;
  href: string;
  kind: 'link' | 'form';
}

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Remove the places a URL-shaped string can hide without being a link.
 *
 * This is not tidiness, it is Rule 3. A `<script>` containing the literal text
 * `"<a href=/signup>"` would otherwise be swept as a link, fail to fetch, and be
 * published as a BROKEN LINK on somebody's project — a fabricated finding, which
 * is the one thing this codebase must never do. Comments are stripped for the
 * same reason: commented-out markup is not a link the project offers.
 */
function stripNonMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ');
}

/** Reads one attribute out of a tag's attribute string, quoted or not. */
function attrValue(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    "\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>=]+))",
    'i',
  );
  const match = pattern.exec(attrs);
  if (match === null) return null;
  const raw = match[1] ?? match[2] ?? match[3];
  return raw === undefined ? null : raw;
}

/**
 * An absolute http(s) URL, or a reason there is none.
 *
 * The two "no" answers are kept apart because they mean different things to a
 * reader. An in-page fragment is not a link at all — it addresses part of the
 * document we already hold, so fetching it would observe the same bytes twice.
 * A `mailto:` or `javascript:` href IS a link, just not a fetchable one, and a
 * page full of them should not look like a page with nothing on it.
 *
 * The fragment is dropped from what remains: `#pricing` on another page points
 * at the same document as the page without it.
 */
function classifyHref(
  href: string,
  base: string,
): { url: string | null; unsupported: boolean } {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return { url: null, unsupported: false };
  }

  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return { url: null, unsupported: false };
  }

  // Everything that is not a page: mailto:, tel:, javascript:, data:, and any
  // scheme a page invents.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { url: null, unsupported: true };
  }

  url.hash = '';
  return { url: url.toString(), unsupported: false };
}

/**
 * Whether a form action belongs to the same site as the page that declared it.
 *
 * Deliberately STRICT: identical hostnames, or one a subdomain of the other.
 * Sibling subdomains do not match, and neither do two hosts that merely share a
 * public suffix — `a.co.uk` and `b.co.uk` are different sites, and a rule based
 * on "last two labels" would call them the same and then POST to a stranger.
 * The cost of being strict is that a legitimate same-project form on a sibling
 * subdomain is probed with GET; the cost of being loose is a real side effect on
 * a third party's service. Those are not symmetric, so this errs toward GET.
 */
function sameSite(candidate: string, page: string): boolean {
  const a = new URL(candidate).hostname.toLowerCase();
  const b = new URL(page).hostname.toLowerCase();
  if (a === b) return true;
  return a.endsWith('.' + b) || b.endsWith('.' + a);
}

/** Document order, with the unsupported hrefs counted as they are passed over. */
function extractTargets(
  html: string,
  pageUrl: string,
): { targets: LinkTarget[]; unsupported: number } {
  const markup = stripNonMarkup(html);
  const targets: LinkTarget[] = [];
  let unsupported = 0;

  const anchor = /<a\b([^>]*)>/gi;
  for (let match = anchor.exec(markup); match !== null; match = anchor.exec(markup)) {
    const href = attrValue(match[1] ?? '', 'href');
    if (href === null) continue;

    const resolved = classifyHref(href, pageUrl);
    if (resolved.url === null) {
      if (resolved.unsupported) unsupported += 1;
      continue;
    }

    targets.push({
      method: 'GET',
      declared_method: 'GET',
      url: resolved.url,
      href,
      kind: 'link',
    });
  }

  const form = /<form\b([^>]*)>/gi;
  for (let match = form.exec(markup); match !== null; match = form.exec(markup)) {
    const attrs = match[1] ?? '';
    const action = attrValue(attrs, 'action');

    // A form with no action submits to the page it is on. Probing that means
    // POSTing to the landing page itself — a state-changing request against a
    // URL nobody identified as an endpoint. Skipped, and it is not counted as
    // unsupported, because it is not a link.
    if (action === null || action.trim() === '') continue;

    const resolved = classifyHref(action, pageUrl);
    if (resolved.url === null) {
      if (resolved.unsupported) unsupported += 1;
      continue;
    }

    const declared = (attrValue(attrs, 'method') ?? 'GET').toUpperCase();

    // The POST fence, in one line: a declared POST survives only when the
    // operator has allowed it AND the action is on this project's own site.
    // Everything else is probed with GET, and the artifact says so.
    const method: 'GET' | 'POST' =
      SEND_FORM_POST && declared === 'POST' && sameSite(resolved.url, pageUrl)
        ? 'POST'
        : 'GET';

    targets.push({
      method,
      declared_method: declared,
      url: resolved.url,
      href: action,
      kind: 'form',
    });
  }

  return { targets, unsupported };
}

function dedupe(targets: LinkTarget[]): { unique: LinkTarget[]; removed: number } {
  const seen = new Set<string>();
  const unique: LinkTarget[] = [];
  for (const target of targets) {
    const key = `${target.method} ${target.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return { unique, removed: targets.length - unique.length };
}

/** A short, filesystem-safe label for the link, for the raw_ref pointer. */
function slugFor(target: LinkTarget, index: number): string {
  let path: string;
  try {
    path = new URL(target.url).pathname;
  } catch {
    path = '';
  }
  const slug = path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${index}-${slug === '' ? 'root' : slug}`.slice(0, 60);
}

interface LinkOutcome {
  artifact: EvidenceArtifact;
  downgraded: boolean;
}

async function checkLink(args: {
  context: CollectorContext;
  target: LinkTarget;
  index: number;
  pageUrl: string;
  observedAt: string;
  timeoutMs: number;
}): Promise<LinkOutcome> {
  const { context, target, index, pageUrl, observedAt, timeoutMs } = args;

  const downgraded =
    target.declared_method === 'POST' && target.method === 'GET';

  const artifactId = `ev-${context.review_session_id}-link-${index}`;

  const base = {
    artifact_id: artifactId,
    review_session_id: context.review_session_id,
    collector: 'html' as const,
    collector_version: '0.1.0',
    target_url: target.url,
    observed_at: observedAt,
    provider_request_id: null,
  };

  const commonMeta = {
    method: target.method,
    declared_method: target.declared_method,
    // True when a cross-site POST was deliberately weakened to GET. Recorded so
    // the review can say "probed with GET" instead of implying a POST happened.
    method_downgraded: downgraded,
    kind: target.kind,
    href: target.href,
    found_on: pageUrl,
    request_path: (() => {
      try {
        return new URL(target.url).pathname;
      } catch {
        return null;
      }
    })(),
  };

  const startedAt = Date.now();

  try {
    const response = await fetchPinned(target.url, context.resolve, {
      timeoutMs,
      maxBodyBytes: LINK_BODY_CAP,
      maxRedirects: LINK_MAX_REDIRECTS,
      method: target.method,
      ...(target.method === 'POST' ? { body: EMPTY_BODY } : {}),
    });

    return {
      downgraded,
      artifact: {
        ...base,
        resolved_ip: response.resolved_ip,
        // 403 and 429 are REFUSALS, not absences.
        //
        // This is the same trap `repo.ts` documents for GitHub's unauthenticated
        // rate limit, in a second place: a datacenter address is routinely
        // throttled or blocked by large platforms, and CI runs from one. The
        // observed evidence of that is not hypothetical — a YouTube link on the
        // demo target returned `invalid` on one run and `200 valid` on the next,
        // from the same code, minutes apart.
        //
        // `invalid` renders as Detected, and the Review Generator turns Detected
        // into a finding. So getting this wrong publishes "broken link" about a
        // link that works, which is the one class of output this codebase exists
        // to refuse. The tie goes to the weaker claim.
        //
        // The status code is preserved in metadata, so the review can still say
        // "returned HTTP 429" — it just cannot say the link is dead.
        //
        // A wrinkle worth naming rather than hiding: `unknown_network_error` is
        // described in shared-types as "the network, not the target, failed us",
        // and a 403 is the target refusing. The union has no `unknown_refused`,
        // and `repo.ts` already overuses this member for the identical case, so
        // this is consistency rather than a good fit. See MEMORY.md decision 24.
        status:
          response.status_code >= 200 && response.status_code < 300
            ? 'valid'
            : response.status_code === 403 || response.status_code === 429
              ? 'unknown_network_error'
              : 'invalid',
        content_hash: sha256Hex(response.body),
        raw_ref: `inline://link/${slugFor(target, index)}`,
        metadata: {
          ...commonMeta,
          status_code: response.status_code,
          // Its own field, so the review never has to re-derive "was this a
          // refusal or a verdict?" by re-reading the status code.
          refused_by_status: response.status_code === 403 || response.status_code === 429,
          // A POST that redirected was accepted and did something. Worth saying
          // out loud, because it is the one case where a probe had an effect.
          redirect_chain: response.redirect_chain,
          redirect_count: response.redirect_chain.length,
          content_type: response.headers['content-type'] ?? null,
          body_bytes: response.body.byteLength,
          body_truncated: response.body_truncated,
          bytes_sent: target.method === 'POST' ? EMPTY_BODY.byteLength : 0,
          elapsed_ms: Date.now() - startedAt,
        },
      },
    };
  } catch (error) {
    // Same split as the page fetch. A refusal by the guard is a fact about the
    // link the project published — it points at non-public space, or into a
    // redirect loop we will not follow — and that is citable. A resolution
    // failure is our network, and must stay `unknown_*`.
    const isTargetFinding =
      error instanceof TooManyRedirectsError ||
      (error instanceof BlockedTargetError &&
        !(error instanceof ResolutionFailedError));

    const detail = error instanceof Error ? error.message : 'unknown fetch error';

    return {
      downgraded,
      artifact: {
        ...base,
        resolved_ip: null,
        status: isTargetFinding
          ? 'invalid'
          : classifyFailure(error, error instanceof ProbeTimeoutError),
        content_hash: sha256Hex(target.url),
        raw_ref: `inline://link/${slugFor(target, index)}/${isTargetFinding ? 'refused' : 'unavailable'}`,
        metadata: {
          ...commonMeta,
          status_code: null,
          error: detail,
          error_name: error instanceof Error ? error.name : null,
          refusal: isTargetFinding ? detail : null,
          elapsed_ms: Date.now() - startedAt,
        },
      },
    };
  }
}

/**
 * Sweep a fetched page for links and probe each one.
 *
 * Runs sequentially and on purpose: these are requests to somebody else's
 * server, and firing twelve at once turns a review into a small burst. The
 * stats are returned rather than logged, so the PAGE artifact can carry the
 * counts and the reader can see that a cap was applied.
 */
export async function sweepLinks(args: {
  context: CollectorContext;
  pageUrl: string;
  html: string;
  observedAt: string;
}): Promise<{ artifacts: EvidenceArtifact[]; stats: SweepStats }> {
  const { context, pageUrl, html, observedAt } = args;

  const { targets, unsupported } = extractTargets(html, pageUrl);
  const { unique, removed } = dedupe(targets);

  // The page itself is not a link on the page, and we already hold its bytes.
  const withoutSelf = unique.filter((target) => target.url !== pageUrl);
  const selfLinks = unique.length - withoutSelf.length;

  const selected = withoutSelf.slice(0, MAX_LINKS);

  const timeoutMs = Math.min(context.timeout_ms, LINK_TIMEOUT_CAP_MS);
  const artifacts: EvidenceArtifact[] = [];
  let downgraded = 0;

  for (const [index, target] of selected.entries()) {
    const outcome = await checkLink({
      context,
      target,
      index,
      pageUrl,
      observedAt,
      timeoutMs,
    });
    if (outcome.downgraded) downgraded += 1;
    artifacts.push(outcome.artifact);
  }

  return {
    artifacts,
    stats: {
      links_found: targets.length,
      links_checked: artifacts.length,
      // Counted, never silently dropped. A reader looking at a review that
      // checked 12 of 60 links should be able to see that is what happened.
      links_skipped_over_cap: withoutSelf.length - selected.length,
      links_skipped_unsupported: unsupported,
      links_skipped_self: selfLinks,
      links_deduplicated: removed,
      links_method_downgraded: downgraded,
    },
  };
}
