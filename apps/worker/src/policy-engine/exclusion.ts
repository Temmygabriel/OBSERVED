/**
 * Rule 5 — conflict of interest, checked BEFORE any money is spent.
 *
 * Observed's operator is also an entrant in this hackathon. A reviewer that
 * scores its own entry is not a reviewer. So the exclusion check runs first,
 * and a match refuses the project outright — no evidence collected, no paid
 * call made, nothing to "reconsider later".
 *
 * Two design decisions worth stating, because both are fail-closed:
 *
 *   - Matching happens on NORMALIZED values (`WWW.Example.COM.` and
 *     `example.com` are the same domain), but a value we cannot normalize is
 *     compared raw rather than skipped. A check that silently skips inputs it
 *     does not understand is a check that can be defeated by formatting.
 *
 *   - A subdomain of an excluded domain is also excluded. `app.operator.example`
 *     is the operator's project wearing a different hostname; treating the
 *     parent match as insufficient would leave the obvious hole open.
 */

import type {
  ExclusionListEntry,
  ExclusionType,
  PolicyRefusal,
} from '@observed/shared-types';

/**
 * Everything about a submitted project that could collide with the operator's
 * own identity. Every field is optional — a project that only supplies a URL
 * is still checked on the fields it does supply.
 */
export interface ProjectIdentity {
  target_url: string;
  github_owner?: string | null;
  telegram_handle?: string | null;
  wallet_addresses?: readonly string[] | null;
  erc8004_agent_id?: string | null;
}

function normalizeDomain(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (raw === '') return null;

  // Accept a bare hostname or a full URL; both appear in the exclusion list.
  let host: string;
  try {
    host = raw.includes('://') ? new URL(raw).hostname : raw;
  } catch {
    return null;
  }

  return (
    host
      .replace(/\.$/, '') // fully-qualified trailing dot
      .replace(/^www\./, '')
      .split(':')[0] ?? null
  );
}

function normalizeGithubOwner(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (raw === '') return null;

  // A full repo URL means the owner is the first path segment, not the whole
  // string. Accepting both shapes is what stops "paste the repo URL" from
  // quietly never matching.
  try {
    if (raw.includes('://')) {
      const url = new URL(raw);
      if (url.hostname === 'github.com') {
        return url.pathname.split('/').filter(Boolean)[0] ?? null;
      }
    }
  } catch {
    // Fall through to the plain-owner interpretation below.
  }

  return raw.replace(/^@/, '');
}

function normalizeTelegramHandle(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/^@/, '');
  if (raw === '') return null;

  try {
    if (raw.includes('://')) {
      const url = new URL(raw);
      return url.pathname.split('/').filter(Boolean)[0] ?? null;
    }
  } catch {
    // Not a URL; treat it as a bare handle.
  }

  return raw;
}

function normalizeWallet(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;
  // EVM addresses are case-insensitive; the checksum casing is decoration.
  return raw.toLowerCase();
}

function normalizeAgentId(value: string): string | null {
  const raw = value.trim();
  return raw === '' ? null : raw;
}

function normalize(type: ExclusionType, value: string): string | null {
  switch (type) {
    case 'domain':
      return normalizeDomain(value);
    case 'github_owner':
      return normalizeGithubOwner(value);
    case 'telegram_handle':
      return normalizeTelegramHandle(value);
    case 'wallet_address':
      return normalizeWallet(value);
    case 'erc8004_agent_id':
      return normalizeAgentId(value);
  }
}

/** The project's own values for a given identifier type. */
function projectValues(
  project: ProjectIdentity,
  type: ExclusionType,
): string[] {
  switch (type) {
    case 'domain':
      return [project.target_url];
    case 'github_owner':
      return project.github_owner ? [project.github_owner] : [];
    case 'telegram_handle':
      return project.telegram_handle ? [project.telegram_handle] : [];
    case 'wallet_address':
      return [...(project.wallet_addresses ?? [])];
    case 'erc8004_agent_id':
      return project.erc8004_agent_id ? [project.erc8004_agent_id] : [];
  }
}

/**
 * Domains match on equality OR on being a subdomain of the excluded domain.
 * Direction matters: `evil.com` is not excluded because `evil.com.operator.example`
 * exists — only the project being UNDER the excluded domain counts.
 */
function domainMatches(projectDomain: string, excludedDomain: string): boolean {
  return (
    projectDomain === excludedDomain ||
    projectDomain.endsWith(`.${excludedDomain}`)
  );
}

export interface ExclusionMatch {
  entry: ExclusionListEntry;
  matched_value: string;
  matched_type: ExclusionType;
}

/** The matching half, split out so it can be tested without building a refusal. */
export function findExclusion(
  project: ProjectIdentity,
  exclusionList: readonly ExclusionListEntry[],
): ExclusionMatch | null {
  for (const entry of exclusionList) {
    const excludedValue = normalize(entry.type, entry.value);
    if (excludedValue === null) continue;

    for (const raw of projectValues(project, entry.type)) {
      const projectValue = normalize(entry.type, raw);
      if (projectValue === null) continue;

      const isMatch =
        entry.type === 'domain'
          ? domainMatches(projectValue, excludedValue)
          : projectValue === excludedValue;

      if (isMatch) {
        return {
          entry,
          matched_value: projectValue,
          matched_type: entry.type,
        };
      }
    }
  }

  return null;
}

/** The refusal shape the UI renders. `reconsidered_at` is always null: an
 *  exclusion is permanent, and offering a retry time would be a lie. */
export function buildExclusionRefusal(match: ExclusionMatch): PolicyRefusal {
  return {
    rule: 'exclusion_list',
    explanation: `This project is connected to Observed's own operator (${
      match.entry.reason
    }). Observed checks this automatically before any evidence is gathered, and refuses rather than reviewing its own entry.`,
    reconsidered_at: null,
  };
}

/**
 * The public entry point. Returns a refusal, or `null` when the project is
 * clear to proceed.
 *
 * A caller that gets `null` may go on to spend money. That is why this runs
 * before the Evidence Worker is even constructed, and why the return type is a
 * refusal rather than an exception: it is an expected outcome, not a crash.
 */
export function checkExclusion(
  project: ProjectIdentity,
  exclusionList: readonly ExclusionListEntry[],
): PolicyRefusal | null {
  const match = findExclusion(project, exclusionList);
  return match ? buildExclusionRefusal(match) : null;
}
