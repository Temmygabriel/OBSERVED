/**
 * Repo collector — implemented, not a stub.
 *
 * The optional check. Optional is doing real work in that sentence: a project
 * with no public repository is not a failing project, so a missing repo produces
 * NO artifact at all rather than an `invalid` one. "You did not give us a repo"
 * is not a finding.
 *
 * THE HOST IS A CONSTANT. Every request goes to `api.github.com`, which is
 * written here as a literal. The only thing the declared URL contributes is the
 * `owner` and `repo` path segments, and those are validated against a strict
 * character set before they are interpolated. That is the whole reason this
 * collector has no SSRF question to answer: there is no user-controlled host,
 * port, or scheme anywhere on the request path. See the Rule 3 note below for
 * what happens when the declared URL is not a GitHub URL at all.
 *
 * Rule 3 traps that this collector exists to get right:
 *
 *   - GitHub's unauthenticated rate limit answers **403, not 404**. Reporting a
 *     rate limit as "the repository does not exist" would be a fabricated
 *     finding about someone's project, so 403 and 429 are `unknown_*`. This is
 *     the single most important line in the file.
 *   - A 404 from the unauthenticated API means "not publicly readable", NOT
 *     "does not exist". GitHub returns 404 for a private repository too, and
 *     without a token we cannot tell the two apart. The artifact therefore
 *     records `distinguishable_from_private: false`, and the claim it supports
 *     must say "not publicly readable" rather than "does not exist".
 */

import { createHash } from 'node:crypto';
import type { EvidenceArtifact } from '@observed/shared-types';
import { BlockedTargetError, ResolutionFailedError } from '../ssrf-guard';
import { ProbeTimeoutError } from '../probe-timeout';
import { fetchPinned } from '../pinned-request';
import { classifyFailure, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

/** Where the API lives. Literals, so no part of them can come from input. */
const GITHUB_API_HOST = 'api.github.com';
const GITHUB_API_ORIGIN = `https://${GITHUB_API_HOST}`;

/** Hosts a declared repository URL is allowed to name. */
const GITHUB_WEB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Strict on purpose: this is what keeps a crafted URL out of the path. */
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface RepoRef {
  owner: string;
  repo: string;
  declared_url: string;
}

type ParseOutcome =
  | { ok: true; ref: RepoRef }
  | { ok: false; reason: 'malformed' | 'unsupported_host' | 'not_a_repo'; detail: string };

/**
 * Turn a declared repository URL into an `owner`/`repo` pair.
 *
 * Only `owner` and `repo` survive this function. A URL like
 * `https://github.com/owner/repo/tree/main/apps/web` resolves to the repository,
 * which is what a person pasting a deep link means — but note that the reverse
 * is the dangerous direction: `https://evil.example/github.com/owner/repo` must
 * never yield `owner/repo`, and it does not, because the host is checked first
 * and the path is read from the parsed URL rather than by string splitting.
 */
function parseRepoUrl(raw: string): ParseOutcome {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'not a valid absolute URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'malformed',
      detail: `unsupported scheme ${url.protocol}`,
    };
  }

  const host = url.hostname.toLowerCase();
  if (!GITHUB_WEB_HOSTS.has(host)) {
    // A GitLab or Codeberg repository is not a broken repository. We simply have
    // no way to check it, and Rule 3 says that is "unable to verify" — never a
    // finding, and never a pass.
    return {
      ok: false,
      reason: 'unsupported_host',
      detail: `the API probe only covers github.com (declared host: ${host})`,
    };
  }

  // The dot-segment check has to run on the RAW path, not on `url.pathname`.
  // WHATWG URL normalisation resolves `.` and `..` during parsing, so
  // `github.com/../etc/passwd` arrives at `pathname` as `/etc/passwd` and any
  // guard written against the parsed value is unreachable. A declared
  // repository URL containing a dot segment is either a mistake or an attempt,
  // and silently normalising it into a query we then publish a finding about is
  // the wrong half of that choice.
  const afterScheme = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const firstSlash = afterScheme.indexOf('/');
  const pathOnly = firstSlash === -1 ? '' : afterScheme.slice(firstSlash);
  const rawSegments = (pathOnly.split(/[?#]/)[0] ?? '').split('/');
  if (rawSegments.some((part) => part === '.' || part === '..')) {
    return { ok: false, reason: 'malformed', detail: 'path traversal in the declared URL' };
  }

  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments.length < 2) {
    // `github.com/owner` is a profile, not a repository. There is no repository
    // here to observe, so this is a statement about the declared URL itself.
    return {
      ok: false,
      reason: 'not_a_repo',
      detail: 'the URL names a GitHub account, not a repository',
    };
  }

  const owner = segments[0] ?? '';
  const repo = (segments[1] ?? '').replace(/\.git$/, '');

  if (!SEGMENT_PATTERN.test(owner) || !SEGMENT_PATTERN.test(repo)) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'the owner or repository name contains characters we do not query with',
    };
  }

  return { ok: true, ref: { owner, repo, declared_url: raw } };
}

function readHeader(headers: Record<string, unknown>, name: string): string | null {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/** The subset of the GitHub repository payload that we are willing to cite. */
interface RepoPayload {
  full_name?: unknown;
  private?: unknown;
  visibility?: unknown;
  default_branch?: unknown;
  pushed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  archived?: unknown;
  disabled?: unknown;
  fork?: unknown;
  stargazers_count?: unknown;
  open_issues_count?: unknown;
  html_url?: unknown;
  size?: unknown;
  license?: unknown;
}

function licensingOf(payload: RepoPayload): { spdx: string | null; name: string | null } {
  const license = payload.license;
  if (typeof license !== 'object' || license === null) return { spdx: null, name: null };
  const record = license as { spdx_id?: unknown; name?: unknown };
  return {
    spdx: typeof record.spdx_id === 'string' ? record.spdx_id : null,
    name: typeof record.name === 'string' ? record.name : null,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export const repoCollector: Collector = {
  kind: 'repo',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(context: CollectorContext): Promise<EvidenceArtifact | EvidenceArtifact[]> {
    const declared = context.repo_url?.trim() ?? '';
    // No repository declared is not a finding, and it is not an artifact. The
    // orchestrator reports it as a skip instead (see evidence-worker/index.ts),
    // so the gap is visible in the run log without being published as a fact
    // about someone's project.
    if (declared === '') return [];

    const observedAt = context.now().toISOString();
    const startedAt = Date.now();
    const base = {
      artifact_id: `ev-${context.review_session_id}-repo`,
      review_session_id: context.review_session_id,
      collector: 'repo' as const,
      collector_version: VERSION,
      // The artifact is about the repository, so the repository is its target —
      // not the project's website. The two are different subjects and folding
      // them together would make the citation ambiguous.
      target_url: declared,
      resolved_ip: null,
      observed_at: observedAt,
      provider_request_id: null,
    };

    const parsed = parseRepoUrl(declared);

    if (!parsed.ok) {
      // `unsupported_host` is the one case here that is not a fact about the
      // submission: we genuinely cannot check a non-GitHub forge, so it is
      // `unknown_*`. The other two are statements about the URL the project
      // published, and both are conclusive.
      const status = parsed.reason === 'unsupported_host' ? 'unknown_network_error' : 'invalid';
      return {
        ...base,
        status,
        content_hash: sha256Hex(declared),
        raw_ref: `inline://repo/declared/${sha256Hex(declared).slice(0, 16)}`,
        metadata: {
          declared_url: declared,
          unparseable: true,
          reason: parsed.reason,
          detail: parsed.detail,
          elapsed_ms: Date.now() - startedAt,
        },
      };
    }

    const { owner, repo } = parsed.ref;
    const attemptedUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    let response: Awaited<ReturnType<typeof fetchPinned>>;
    try {
      response = await fetchPinned(attemptedUrl, context.resolve, {
        timeoutMs: context.timeout_ms,
      });
    } catch (error) {
      // A timeout is `unknown_timeout`; a resolver failure is `unknown_*`; and
      // anything else from the transport is also unknown, because none of it is
      // a statement about whether the repository exists.
      const timedOut =
        error instanceof ProbeTimeoutError ||
        (error instanceof Error && error.name === 'ProbeTimeoutError');

      const refused = error instanceof BlockedTargetError;
      const resolverFailed = error instanceof ResolutionFailedError;

      return {
        ...base,
        status: classifyFailure(error, timedOut),
        content_hash: sha256Hex(attemptedUrl),
        raw_ref: `inline://repo/unreachable/${owner}/${repo}`,
        metadata: {
          declared_url: declared,
          owner,
          repo,
          attempted_url: attemptedUrl,
          timeout_ms: context.timeout_ms,
          error: error instanceof Error ? error.message : 'unknown transport error',
          // Recorded so the review does not have to guess why the probe stopped.
          refused_by_guard: refused,
          resolver_failed: resolverFailed,
          elapsed_ms: Date.now() - startedAt,
        },
      };
    }

    const bodyText = new TextDecoder().decode(response.body);
    const shared = {
      declared_url: declared,
      owner,
      repo,
      attempted_url: attemptedUrl,
      api_host: GITHUB_API_HOST,
      http_status: response.status_code,
      resolved_ip: response.resolved_ip,
      redirect_chain: response.redirect_chain,
      body_bytes: response.body.byteLength,
      elapsed_ms: response.elapsed_ms,
    };

    // Rule 3, the line this collector is really about. A 403 here is almost
    // always the unauthenticated rate limit (60 requests/hour/IP) — GitHub uses
    // 404 for a missing repository and reserves 403 for "we will not answer".
    // Reading it as a missing repository would put a fabricated finding into
    // someone's published review.
    if (response.status_code === 403 || response.status_code === 429) {
      const remaining = readHeader(response.headers, 'x-ratelimit-remaining');
      const reset = readHeader(response.headers, 'x-ratelimit-reset');
      return {
        ...base,
        resolved_ip: response.resolved_ip,
        status: 'unknown_network_error',
        content_hash: sha256Hex(bodyText),
        raw_ref: `inline://repo/rate-limited/${owner}/${repo}`,
        metadata: {
          ...shared,
          rate_limited: true,
          rate_limit_remaining: remaining,
          rate_limit_reset_epoch: reset,
          note:
            'GitHub answered 403/429. This is a limit on OUR probing, not a fact about the repository, so the result is unable to verify rather than a finding.',
        },
      };
    }

    if (response.status_code >= 500) {
      return {
        ...base,
        resolved_ip: response.resolved_ip,
        status: 'unknown_network_error',
        content_hash: sha256Hex(bodyText),
        raw_ref: `inline://repo/upstream-error/${owner}/${repo}`,
        metadata: {
          ...shared,
          note: 'GitHub itself returned a server error, which says nothing about the repository.',
        },
      };
    }

    if (response.status_code === 404) {
      return {
        ...base,
        resolved_ip: response.resolved_ip,
        status: 'invalid',
        content_hash: sha256Hex(bodyText),
        raw_ref: await storeQuietly(context, `${owner}-${repo}-404.json`, response.body, 'application/json'),
        metadata: {
          ...shared,
          // Without a token, GitHub answers 404 for a private repository as well
          // as a missing one. The claim this supports must be phrased
          // "not publicly readable", never "does not exist".
          distinguishable_from_private: false,
          note: 'unauthenticated GitHub returns 404 for a private repository as well as a missing one',
        },
      };
    }

    if (response.status_code !== 200) {
      // Anything else (301 that we did not follow, 451 takedown, 401) is not
      // something we are prepared to characterise, so it stays unknown.
      return {
        ...base,
        resolved_ip: response.resolved_ip,
        status: 'unknown_network_error',
        content_hash: sha256Hex(bodyText),
        raw_ref: `inline://repo/unexpected-status/${owner}/${repo}`,
        metadata: { ...shared, note: 'unrecognised status from the GitHub API' },
      };
    }

    let payload: RepoPayload;
    try {
      const parsedBody: unknown = JSON.parse(bodyText);
      if (typeof parsedBody !== 'object' || parsedBody === null) throw new Error('not an object');
      payload = parsedBody as RepoPayload;
    } catch {
      // A 200 whose body is not JSON is our problem, not the repository's.
      return {
        ...base,
        resolved_ip: response.resolved_ip,
        status: 'unknown_network_error',
        content_hash: sha256Hex(bodyText),
        raw_ref: `inline://repo/unparseable/${owner}/${repo}`,
        metadata: { ...shared, note: 'the API returned 200 with a body we could not parse' },
      };
    }

    const license = licensingOf(payload);
    const defaultBranch = asString(payload.default_branch);

    // Enrichment, and explicitly not load-bearing. The repository's existence is
    // already established by the 200 above; the head commit is a second question
    // that may fail on its own (a rate limit arriving between the two calls, or
    // an empty repository answering 409). A failure here must not overwrite a
    // status we already earned, so it is recorded as null with its reason.
    let headCommitAt: string | null = null;
    let headCommitSha: string | null = null;
    let headCommitOutcome = 'not attempted';

    if (defaultBranch !== null) {
      const commitsUrl =
        `${attemptedUrl}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=1`;
      try {
        const commitsResponse = await fetchPinned(commitsUrl, context.resolve, {
          timeoutMs: context.timeout_ms,
        });

        if (commitsResponse.status_code === 200) {
          const parsedCommits: unknown = JSON.parse(
            new TextDecoder().decode(commitsResponse.body),
          );
          if (Array.isArray(parsedCommits) && parsedCommits.length > 0) {
            const newest = parsedCommits[0] as {
              sha?: unknown;
              commit?: { committer?: { date?: unknown } };
            };
            headCommitSha = asString(newest.sha);
            headCommitAt = asString(newest.commit?.committer?.date);
            headCommitOutcome = headCommitAt === null ? 'no commit date in the payload' : 'ok';
          } else {
            headCommitOutcome = 'the default branch has no commits';
          }
        } else if (commitsResponse.status_code === 409) {
          headCommitOutcome = 'the repository is empty';
        } else {
          headCommitOutcome = `the commits API answered ${commitsResponse.status_code}`;
        }
      } catch (error) {
        headCommitOutcome =
          error instanceof Error ? `the commits probe failed: ${error.message}` : 'the commits probe failed';
      }
    }

    return {
      ...base,
      resolved_ip: response.resolved_ip,
      status: 'valid',
      content_hash: sha256Hex(bodyText),
      raw_ref: await storeQuietly(
        context,
        `${owner}-${repo}.json`,
        response.body,
        'application/json',
      ),
      metadata: {
        ...shared,
        full_name: asString(payload.full_name),
        visibility: asString(payload.visibility),
        is_private: asBoolean(payload.private),
        default_branch: defaultBranch,
        // Named `pushed_at`, not "last commit": a push to any branch or a tag
        // moves it, so it is not the same claim and must not be labelled as one.
        pushed_at: asString(payload.pushed_at),
        created_at: asString(payload.created_at),
        updated_at: asString(payload.updated_at),
        archived: asBoolean(payload.archived),
        disabled: asBoolean(payload.disabled),
        is_fork: asBoolean(payload.fork),
        stargazers_count: asNumber(payload.stargazers_count),
        open_issues_count: asNumber(payload.open_issues_count),
        size_kb: asNumber(payload.size),
        html_url: asString(payload.html_url),
        license_spdx_id: license.spdx,
        license_name: license.name,
        // `null` when the repository publishes no licence. Absence is recorded
        // as absence — it does not make the artifact `invalid`, because a
        // repository without a licence still exists.
        has_license: license.spdx !== null && license.spdx !== 'NOASSERTION',
        head_commit_at: headCommitAt,
        head_commit_sha: headCommitSha,
        head_commit_outcome: headCommitOutcome,
      },
    };
  },
};

/**
 * Store the raw JSON, but never let a storage fault change the observation.
 *
 * The bytes were already read and hashed by this point, so the evidence exists
 * whether or not the store accepts it. Throwing here would turn a working probe
 * into a failed review for a reason that has nothing to do with the repository.
 */
async function storeQuietly(
  context: CollectorContext,
  name: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  try {
    return await context.storeRaw(name, bytes, contentType);
  } catch {
    return `unavailable://repo/${name}`;
  }
}
