/**
 * Repo collector — NOT IMPLEMENTED YET.
 *
 * The optional check. Optional is doing real work in that sentence: a project
 * with no public repository is not a failing project, so a missing repo must
 * produce NO artifact at all rather than an `invalid` one. An `invalid` artifact
 * would be a finding, and "you did not give us a repo" is not a finding.
 *
 * What it must check, given a repository URL:
 *
 *   - the repository exists and is reachable (a 404 is `invalid` — a real
 *     finding about a link the project published),
 *   - whether it is public or private,
 *   - the default branch and the timestamp of the most recent commit on it,
 *   - whether a license file is present.
 *
 * Two Rule 3 traps specific to this collector:
 *
 *   - GitHub's unauthenticated rate limit returns 403, not 404. Reporting a
 *     rate limit as "the repository does not exist" would be a fabricated
 *     finding about someone's project, so 403/429 must map to `unknown_*`. This
 *     is why the sample record's repo check is `unknown_timeout` rather than a
 *     pass or a fail — it is the shape this collector has to get right.
 *   - The API host is `api.github.com`, not the URL the user pasted. Deriving
 *     one from the other is where a wrong-owner claim comes from.
 */

import { CollectorNotImplementedError, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

export const repoCollector: Collector = {
  kind: 'repo',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(_context: CollectorContext) {
    throw new CollectorNotImplementedError(
      'repo',
      'needs a GitHub API probe that maps 403/429 rate limits to unknown_*, not to invalid',
    );
  },
};
