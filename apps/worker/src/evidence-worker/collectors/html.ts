/**
 * HTML collector — the "Live page" check.
 *
 * Answers one question: what did the submitted URL actually serve? It records
 * the status code, the content type, the redirect chain, the address that
 * served it, and a few deterministic extractions from the body (title, meta
 * description, language, viewport). It interprets nothing — Rule 2 keeps
 * observation and inference apart, and every field below is a raw fact with an
 * exact locator the Review Generator can cite.
 *
 * Three things here are load-bearing:
 *
 *   THE FETCH IS PINNED. `fetchPinned` validates Rule 4 on every redirect hop
 *   and connects to the address it validated, so a `302` to `169.254.169.254`
 *   is refused at the hop rather than followed. See `pinned-request.ts`.
 *
 *   THE STATUS IS ABOUT THE OBSERVATION, NOT THE PRODUCT. A 2xx is `valid`, a
 *   non-2xx is `invalid`, and anything we could not reach is `unknown_*`. Note
 *   what is deliberately NOT here: "the URL answered 200 but served JSON, not a
 *   page" is a real finding, and it lives in `metadata.is_html` +
 *   `metadata.content_type` rather than being folded into the status. Deciding
 *   that a JSON response at a landing-page URL is a problem is an inference,
 *   and inferences belong to the Review Generator.
 *
 *   ONLY THE HASH AND METADATA LEAVE THIS FILE. The raw body goes to the
 *   evidence store and the model never sees it — the one input an attacker
 *   fully controls is the one input the prompt never receives.
 *
 * The link sweep is a separate pass and is not part of this artifact. Folding
 * per-link results into this one status would destroy the tri-state: a page can
 * be perfectly live while three of its links are unreachable, and "3 links
 * unverified" is not a property of the page.
 */

import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { TextDecoder } from 'node:util';
import type { EvidenceArtifact } from '@observed/shared-types';
import { BlockedTargetError, ResolutionFailedError } from '../ssrf-guard';
import { ProbeTimeoutError } from '../probe-timeout';
import {
  TooManyRedirectsError,
  fetchPinned,
  type PinnedResponse,
} from '../pinned-request';
import { classifyFailure, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

/** Shared, because constructing one per call is wasteful and it is stateless. */
const DECODER = new TextDecoder('utf-8', { fatal: false });

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Response headers safe to hand to the model — an ALLOWLIST, not a denylist.
 *
 * Rule 11. A denylist of credential-shaped names fails open the first time a
 * server invents a header nobody thought of; an allowlist fails closed. Nothing
 * here is echoed from the request, so `set-cookie` and `www-authenticate` — the
 * two that routinely carry live secrets — cannot appear even by accident.
 */
const HEADER_ALLOWLIST = [
  'content-type',
  'content-length',
  'server',
  'location',
  'strict-transport-security',
  'x-content-type-options',
] as const;

function pickHeaders(headers: IncomingHttpHeaders): Record<string, string[]> {
  const picked: Record<string, string[]> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers[name];
    if (value === undefined) continue;
    picked[name] = Array.isArray(value) ? value : [value];
  }
  return picked;
}

/**
 * Decode the five named entities and numeric escapes.
 *
 * `&amp;` is decoded LAST on purpose: doing it first would turn `&amp;lt;` into
 * `<`, which is a different string than the page meant.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (match: string, code: string) => {
      const point = Number(code);
      // Range-guarded: `fromCodePoint` throws above U+10FFFF, and a malformed
      // entity in somebody else's HTML must not fail our collector.
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    })
    .replace(/&amp;|&#38;/gi, '&');
}

function collapse(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/**
 * Text of the first `<tag>…</tag>`, or null.
 *
 * Not a parser, and deliberately so: a real HTML parser is a dependency and a
 * much larger attack surface, and the only two extractions here are a title and
 * a meta tag. The cost is that a nested `<title>` would confuse it, which is
 * malformed HTML and a finding in its own right.
 */
function firstTagText(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
  const inner = match?.[1];
  if (inner === undefined) return null;
  const text = collapse(inner);
  return text === '' ? null : text;
}

/** `content` of a `<meta name="…">`, or null. Tolerates either attribute order. */
function metaContent(html: string, name: string): string | null {
  const tag = new RegExp(
    `<meta\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*>`,
    'i',
  ).exec(html);
  if (tag === null) return null;

  const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  const raw = content?.[1];
  if (raw === undefined) return null;

  const text = collapse(raw);
  return text === '' ? null : text;
}

function htmlLang(html: string): string | null {
  const match = /<html\b[^>]*\blang\s*=\s*["']([^"']*)["']/i.exec(html);
  const value = match?.[1];
  if (value === undefined) return null;
  const text = value.trim();
  return text === '' ? null : text;
}

type ArtifactBase = Pick<
  EvidenceArtifact,
  | 'artifact_id'
  | 'review_session_id'
  | 'collector'
  | 'collector_version'
  | 'target_url'
  | 'observed_at'
  | 'provider_request_id'
>;

type FetchOutcome =
  | { ok: true; response: PinnedResponse }
  | { ok: false; failure: unknown };

/**
 * A union rather than a try/catch around the call site, so that "did we get a
 * response" is a value the compiler tracks rather than a control-flow fact it
 * has to infer across a `catch` that never falls through.
 */
async function fetchPage(context: CollectorContext): Promise<FetchOutcome> {
  try {
    const response = await fetchPinned(context.target_url, context.resolve, {
      timeoutMs: context.timeout_ms,
    });
    return { ok: true, response };
  } catch (failure) {
    return { ok: false, failure };
  }
}

/**
 * The artifact for a fetch that did not produce a response.
 *
 * The branch that matters is the first one. A refusal by the SSRF guard is a
 * FINDING — the submitted URL points at non-public space, or redirects to it,
 * or enters a chain longer than we follow. We looked, and that is what we saw,
 * so it is `invalid` and it is citable. A resolution failure is the opposite:
 * our resolver did not answer, we observed nothing about the target, and
 * reporting that as a defect would be Rule 3's cardinal error.
 */
function failureArtifact(
  context: CollectorContext,
  base: ArtifactBase,
  error: unknown,
  startedAt: number,
): EvidenceArtifact {
  const isTargetFinding =
    error instanceof TooManyRedirectsError ||
    (error instanceof BlockedTargetError &&
      !(error instanceof ResolutionFailedError));

  const detail = error instanceof Error ? error.message : 'unknown fetch error';

  return {
    ...base,
    resolved_ip: null,
    status: isTargetFinding
      ? 'invalid'
      : classifyFailure(error, error instanceof ProbeTimeoutError),
    // No body was read, so the hash covers what we actually acted on. It is
    // still a real hash of a real input, which is what makes the record
    // verifiable even when the fetch failed.
    content_hash: sha256Hex(context.target_url),
    raw_ref: `inline://html/${isTargetFinding ? 'refused' : 'unavailable'}`,
    metadata: {
      method: 'GET',
      error: detail,
      error_name: error instanceof Error ? error.name : null,
      // Recorded as its own field rather than left inside the error string: the
      // Review Generator should never have to parse prose to find a finding.
      refusal: isTargetFinding ? detail : null,
      redirect_count: error instanceof TooManyRedirectsError ? error.hops : 0,
      elapsed_ms: Date.now() - startedAt,
    },
  };
}

export const htmlCollector: Collector = {
  kind: 'html',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(context: CollectorContext): Promise<EvidenceArtifact> {
    const observedAt = context.now().toISOString();
    const startedAt = Date.now();

    const base: ArtifactBase = {
      artifact_id: `ev-${context.review_session_id}-html`,
      review_session_id: context.review_session_id,
      collector: 'html',
      collector_version: VERSION,
      target_url: context.target_url,
      observed_at: observedAt,
      provider_request_id: null,
    };

    const outcome = await fetchPage(context);
    if (!outcome.ok) {
      return failureArtifact(context, base, outcome.failure, startedAt);
    }

    const { response } = outcome;

    const contentType = firstHeaderValue(response.headers['content-type']);
    const isHtml =
      contentType !== null &&
      /text\/html|application\/xhtml\+xml/i.test(contentType);

    // Only decode a document we can actually read. Decoding 512 KiB of a PNG as
    // UTF-8 produces mojibake that looks like content and would be extracted as
    // a "title".
    const html = isHtml ? DECODER.decode(response.body) : '';

    const title = isHtml ? firstTagText(html, 'title') : null;
    const description = isHtml ? metaContent(html, 'description') : null;
    const viewport = isHtml ? metaContent(html, 'viewport') : null;
    const lang = isHtml ? htmlLang(html) : null;

    return {
      ...base,
      // Rule 4 evidence: the exact address the socket connected to.
      resolved_ip: response.resolved_ip,
      status:
        response.status_code >= 200 && response.status_code < 300
          ? 'valid'
          : 'invalid',
      content_hash: sha256Hex(response.body),
      raw_ref: await context.storeRaw(
        'page.html',
        response.body,
        contentType ?? 'application/octet-stream',
      ),
      metadata: {
        method: 'GET',
        // `fetchPinned` already parsed this successfully, so it cannot throw.
        request_path: new URL(context.target_url).pathname,
        final_url: response.final_url,
        status_code: response.status_code,
        content_type: contentType,
        is_html: isHtml,
        resolved_ip: response.resolved_ip,
        redirect_chain: response.redirect_chain,
        redirect_count: response.redirect_chain.length,
        body_bytes: response.body.byteLength,
        body_truncated: response.body_truncated,
        title,
        title_length: title === null ? null : title.length,
        meta_description: description,
        html_lang: lang,
        has_viewport_meta: viewport !== null,
        hsts: firstHeaderValue(response.headers['strict-transport-security']),
        headers: pickHeaders(response.headers),
        elapsed_ms: Date.now() - startedAt,
      },
    };
  },
};
