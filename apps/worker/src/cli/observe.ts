/**
 * Run one real observation, from the command line.
 *
 * This exists because of the single most uncomfortable line in PROGRESS.md:
 * every collector was described as "complete", and not one of them had ever
 * been executed. `fetchPinned` had a bug that made it send nothing at all — the
 * HTML collector could never have observed anything — and it survived three
 * sessions because nothing on this machine runs the worker. It was found by
 * reading, not by running.
 *
 * So this is the thing that runs. It performs a genuine observation against a
 * genuine target, using the same `collectEvidence` the worker uses, and prints
 * what came back. Nothing here is mocked, and nothing is filtered: if a
 * collector is broken, this prints the breakage rather than a tidy summary.
 *
 * It deliberately uses only the free collectors. The paid path needs a wallet,
 * and a tool whose whole purpose is "does this actually work" must be runnable
 * by anyone at any time.
 *
 * Usage:
 *   tsx src/cli/observe.ts <targetUrl> [--repo <repoUrl>] [--out <file>]
 *
 * Exit code is 1 when a collector threw for OUR reasons — a
 * `CollectorNotImplementedError` or an unexpected crash. A target that simply
 * could not be reached is a successful run that produced an `unknown_*`
 * artifact, which is the whole point of the tri-state, and exits 0.
 */

import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { EvidenceArtifact } from '@observed/shared-types';
import { collectEvidence, type CollectResult } from '../evidence-worker';
import { storeRawArtifact } from '../evidence-store';
import { CollectorNotImplementedError, type CollectorContext } from '../evidence-worker/collectors/types';

const RAW_DIR = process.env.RAW_ARTIFACT_DIR ?? './raw-artifacts';

/**
 * The real resolver. `verbatim: true` keeps the OS's own address ordering, and
 * `all: true` returns every address rather than one, because the SSRF guard's
 * job is to judge the whole set — a host that resolves to one public and one
 * private address must be refused, and asking for a single address would hide
 * the second one.
 */
const resolver = async (hostname: string): Promise<string[]> => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** What a human needs to see to believe the artifact is real. */
function summarise(artifact: EvidenceArtifact): string[] {
  const lines: string[] = [];
  lines.push(`  status        ${artifact.status}`);
  lines.push(`  observed_at   ${artifact.observed_at}`);
  lines.push(`  resolved_ip   ${artifact.resolved_ip ?? '(none)'}`);
  lines.push(`  content_hash  ${artifact.content_hash}`);
  lines.push(`  raw_ref       ${artifact.raw_ref}`);

  const interesting = [
    'status_code',
    'final_url',
    'title',
    'protocol',
    'subject_cn',
    'issuer_cn',
    'days_until_expiry',
    'authorization_error',
    'addresses',
    'full_name',
    'default_branch',
    'head_commit_at',
    'has_license',
    'links_found',
    'links_checked',
    'error',
    'note',
    'reason',
    'detail',
  ];

  for (const key of interesting) {
    if (key in artifact.metadata) {
      const value = artifact.metadata[key];
      lines.push(`  ${key.padEnd(13)} ${Array.isArray(value) ? value.join(', ') : String(value)}`);
    }
  }

  return lines;
}

function printResult(result: CollectResult): void {
  console.log('');
  console.log('='.repeat(72));
  console.log(`ARTIFACTS (${result.artifacts.length})`);
  console.log('='.repeat(72));

  for (const artifact of result.artifacts) {
    console.log('');
    console.log(`[${artifact.collector}]  ${artifact.artifact_id}`);
    console.log(`  target        ${artifact.target_url}`);
    for (const line of summarise(artifact)) console.log(line);
  }

  if (result.skipped.length > 0) {
    console.log('');
    console.log('='.repeat(72));
    console.log(`SKIPPED (${result.skipped.length})`);
    console.log('='.repeat(72));
    for (const skip of result.skipped) {
      console.log(`  ${skip.collector.padEnd(12)} ${skip.reason}`);
    }
  }
}

async function main(): Promise<number> {
  const target = process.argv[2];
  if (!target || target.startsWith('--')) {
    console.error('usage: tsx src/cli/observe.ts <targetUrl> [--repo <repoUrl>] [--out <file>]');
    return 2;
  }

  const repoUrl = flag('--repo');
  const outFile = flag('--out');

  // Unique per run, so two runs never share raw-artifact paths or artifact ids.
  const sessionId = `obs-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;

  console.log(`session       ${sessionId}`);
  console.log(`target        ${target}`);
  console.log(`repo          ${repoUrl ?? '(none declared)'}`);

  const storeRaw: CollectorContext['storeRaw'] = async (_name, bytes) =>
    storeRawArtifact(RAW_DIR, sessionId, bytes);

  const startedAt = Date.now();

  const result = await collectEvidence({
    review_session_id: sessionId,
    target_url: target,
    ...(repoUrl ? { repo_url: repoUrl } : {}),
    resolve: resolver,
    storeRaw,
    collectors: ['dns', 'html', 'tls', 'repo'],
  });

  printResult(result);
  console.log('');
  console.log(`elapsed       ${Date.now() - startedAt} ms`);

  if (outFile) {
    // The directory is created, not assumed.
    //
    // `--out observed/run.json` is relative to the process's cwd, and under
    // `npm run --workspace` that is the workspace directory, not the repo root.
    // The first CI run of this tool did an hour of real observation, printed it,
    // and then died with ENOENT writing its own receipt — a failure of the
    // harness reported as a failure of the observation, which is exactly the
    // confusion this project exists to prevent. Creating the parent here costs
    // nothing and removes the whole class.
    const outPath = resolve(outFile);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(
      outPath,
      `${JSON.stringify({ session_id: sessionId, target, repo_url: repoUrl ?? null, ...result }, null, 2)}\n`,
      'utf8',
    );
    console.log(`written       ${outPath}`);
  }

  // A conclusive artifact is the goal, but an `unknown_*` is a legitimate
  // outcome and not a failure of this tool. Only our own unimplemented or
  // crashed collectors are an error.
  if (result.artifacts.length === 0) {
    fail('no artifact was produced at all — that is a problem with our code, not the target');
    return 1;
  }

  return 0;
}

/**
 * Report a failure of OUR code, loudly enough to survive the trip through CI.
 *
 * GitHub will not hand out job logs to an unauthenticated caller, and a step
 * that redirects a process's stderr into a file reports nothing but
 * `Process completed with exit code 1.` — so a crash here is invisible to anyone
 * without admin rights on the repo, which is everyone reading CI from outside.
 * A workflow command on stdout *is* readable: it comes back as an annotation on
 * the commit. The message is escaped because a command's parameters run to the
 * end of the line and a stray newline would swallow the rest.
 */
function fail(message: string): void {
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error::observe: ${escaped}`);
  console.error(`\n${message}`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    if (error instanceof CollectorNotImplementedError) {
      fail(`${error.message} — a collector this run asked for is not written yet.`);
    } else {
      fail(`observing ${process.argv[2] ?? '(no target)'} threw: ${detail}`);
    }
    process.exitCode = 1;
  });
