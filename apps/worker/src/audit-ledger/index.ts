/**
 * Audit Ledger — hash-chained, append-only.
 *
 * Every entry's hash is a function of its predecessor's hash plus its own
 * canonical payload. That gives the property the whole pitch rests on: a judge
 * (or a customer) can re-walk the chain and prove that no claim was edited
 * after the fact, and that no evidence record was swapped underneath a claim
 * that cites it.
 *
 * Rules that make the chain actually hold, rather than merely look like one:
 *
 *   - The payload is CANONICALISED (keys sorted, undefined dropped) before
 *     hashing. Without that, re-serialising the same object with a different
 *     key order produces a different hash and the chain "breaks" for a reason
 *     that has nothing to do with tampering.
 *
 *   - The previous hash is part of the hashed input. Hashing the payload alone
 *     would let someone rewrite entry 7 and recompute entry 7's hash, and
 *     nothing downstream would notice.
 *
 *   - Verification recomputes every hash from entry 0. A chain checked only at
 *     the tip proves nothing about the middle.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The three things a review is made of, in the order they must have happened.
 * Evidence is collected before a claim is written; the payment that bought the
 * evidence is recorded against the same review session.
 */
export type LedgerEntryKind =
  | 'payment_authorized'
  | 'payment_recorded'
  | 'evidence_collected'
  | 'claim_written'
  | 'review_held'
  | 'review_submitted'
  | 'policy_refusal'
  | 'rewrite_requested'
  | 'watchdog_state';

export interface LedgerEntry {
  seq: number;
  kind: LedgerEntryKind;
  review_session_id: string;
  recorded_at: string;
  /** The typed record this entry attests to. Never contains secrets. */
  payload: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
}

/** The chain's anchor. Not a hash of anything — a fixed, recognisable start. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic JSON.
 *
 * `JSON.stringify` preserves insertion order, so two objects with the same
 * fields built in a different order stringify differently. Sorting keys removes
 * that whole class of false break.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(',')}}`;
  }

  // A value that is not JSON-representable (a function, a symbol) hashes as an
  // explicit marker rather than as `undefined`, so it can never silently
  // collapse two different records into the same hash.
  if (typeof value === 'function' || typeof value === 'symbol') {
    return JSON.stringify(`<unrepresentable:${typeof value}>`);
  }

  return JSON.stringify(value) ?? 'null';
}

export function hashEntry(
  prevHash: string,
  entry: Omit<LedgerEntry, 'entry_hash'>,
): string {
  const material = canonicalize({
    seq: entry.seq,
    kind: entry.kind,
    review_session_id: entry.review_session_id,
    recorded_at: entry.recorded_at,
    payload: entry.payload,
    prev_hash: prevHash,
  });

  return createHash('sha256').update(material).digest('hex');
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append one entry, chaining it to the current tip.
 *
 * `tip` is passed in rather than re-read so that a caller writing several
 * entries for one review does not re-read the file between each — and so that
 * the chain a caller builds is the chain it believes it built.
 */
export async function appendEntry(
  path: string,
  tip: { seq: number; hash: string },
  kind: LedgerEntryKind,
  reviewSessionId: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<LedgerEntry> {
  const withoutHash: Omit<LedgerEntry, 'entry_hash'> = {
    seq: tip.seq + 1,
    kind,
    review_session_id: reviewSessionId,
    recorded_at: now.toISOString(),
    payload,
    prev_hash: tip.hash,
  };

  const entry: LedgerEntry = {
    ...withoutHash,
    entry_hash: hashEntry(tip.hash, withoutHash),
  };

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');

  return entry;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface ChainVerification {
  valid: boolean;
  /** Entries checked, so a "valid" result cannot come from an empty file. */
  length: number;
  /** The first `seq` that failed, or null when the chain is intact. */
  broken_at: number | null;
  reason: string | null;
}

export async function readChain(path: string): Promise<LedgerEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const entries: LedgerEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    entries.push(JSON.parse(trimmed) as LedgerEntry);
  }
  return entries;
}

/**
 * Re-walk the whole chain from genesis.
 *
 * Three separate things are checked, because each catches a different edit:
 * sequence continuity (an entry was deleted), the prev_hash link (an entry was
 * replaced or reordered), and the entry's own hash (a payload was edited in
 * place). Checking only the last of those would miss a deletion.
 */
export function verifyChain(entries: readonly LedgerEntry[]): ChainVerification {
  let prevHash = GENESIS_HASH;

  for (const [index, entry] of entries.entries()) {
    if (entry.seq !== index + 1) {
      return {
        valid: false,
        length: entries.length,
        broken_at: entry.seq,
        reason: `expected seq ${index + 1}, found ${entry.seq} — an entry is missing or out of order`,
      };
    }

    if (entry.prev_hash !== prevHash) {
      return {
        valid: false,
        length: entries.length,
        broken_at: entry.seq,
        reason: `entry ${entry.seq} does not link to its predecessor — the chain was edited`,
      };
    }

    const { entry_hash: claimed, ...withoutHash } = entry;
    const recomputed = hashEntry(prevHash, withoutHash);
    if (recomputed !== claimed) {
      return {
        valid: false,
        length: entries.length,
        broken_at: entry.seq,
        reason: `entry ${entry.seq} does not match its own hash — its payload was modified after it was written`,
      };
    }

    prevHash = claimed;
  }

  return { valid: true, length: entries.length, broken_at: null, reason: null };
}

/** The anchor a caller starts from when the ledger file is empty or new. */
export function genesisTip(): { seq: number; hash: string } {
  return { seq: 0, hash: GENESIS_HASH };
}

/** The tip a caller continues from, given entries already read from disk. */
export function tipOf(entries: readonly LedgerEntry[]): { seq: number; hash: string } {
  let hash = GENESIS_HASH;
  let seq = 0;
  for (const entry of entries) {
    hash = entry.entry_hash;
    seq = entry.seq;
  }
  return { seq, hash };
}
