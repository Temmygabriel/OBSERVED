/**
 * Evidence Store — append-only.
 *
 * Same discipline as the spend ledger, for the same reason: an evidence record
 * that can be edited after a claim cites it makes the claim unverifiable, and
 * verifiability is the entire product.
 *
 * The one structural decision here is the split between the RECORD and the RAW
 * ARTIFACT. The record holds a hash, a timestamp, a collector version and a
 * small metadata object — that is what the Review Generator is allowed to see.
 * The raw bytes (an HTML dump, a screenshot) live behind `raw_ref` on disk and
 * are never loaded into a prompt. The model can cite the screenshot; it cannot
 * read it. That keeps prompt-injection surface at zero for the one input that
 * would otherwise be attacker-controlled free text.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { EvidenceArtifact } from '@observed/shared-types';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Write raw bytes and return the pointer to them.
 *
 * The filename is derived from the content hash rather than from the target
 * URL, so two fetches of the same bytes share one file and nothing
 * attacker-controlled ends up in a path.
 */
export async function storeRawArtifact(
  rawDir: string,
  reviewSessionId: string,
  bytes: Uint8Array,
): Promise<string> {
  const hash = await sha256Hex(bytes);
  const safeSession = reviewSessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const directory = join(rawDir, safeSession);
  const path = join(directory, hash);

  await mkdir(directory, { recursive: true });
  await writeFile(path, bytes);

  return path;
}

/** Append one artifact record. Never rewrites, never truncates. */
export async function recordArtifact(
  path: string,
  artifact: EvidenceArtifact,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(artifact)}\n`, 'utf8');
}

/**
 * Read every artifact for one review session.
 *
 * A malformed line is a hard failure. Skipping it would mean the Review
 * Generator forms an opinion from a silently incomplete evidence set — it would
 * not know a check had been run and discarded, so it could not report the gap
 * even in principle.
 */
export async function readArtifacts(
  path: string,
  reviewSessionId: string,
): Promise<EvidenceArtifact[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const artifacts: EvidenceArtifact[] = [];

  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let artifact: EvidenceArtifact;
    try {
      artifact = JSON.parse(trimmed) as EvidenceArtifact;
    } catch {
      throw new Error(
        `evidence store ${path} line ${index + 1} is not valid JSON — refusing to form a review from an incomplete evidence set`,
      );
    }

    if (artifact.review_session_id === reviewSessionId) artifacts.push(artifact);
  }

  return artifacts;
}
