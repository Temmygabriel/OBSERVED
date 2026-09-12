'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { IS_CONNECTED, OBSERVED_API_URL } from '@/lib/config';

/** What a run would check, in the order it checks it. Repo is optional. */
const LANDING_CHECKS: Array<{ label: string; willRun: boolean }> = [
  { label: 'Live page', willRun: true },
  { label: 'TLS', willRun: true },
  { label: 'Broken links', willRun: true },
  { label: 'Repo', willRun: false },
];

/**
 * The target form.
 *
 * The scheme check in here is UX, NOT security. Rule 4's SSRF guard lives
 * server-side and re-checks the hostname after every redirect hop — a browser
 * check can be bypassed by simply not using the browser. Do not let this
 * function become load-bearing for anything.
 */
export function TargetForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (trimmed.length === 0) {
      setError('Enter the address of the product to inspect.');
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError('That is not a full web address. Include https://');
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('Only http and https addresses can be inspected.');
      return;
    }

    if (!IS_CONNECTED || !OBSERVED_API_URL) return;

    setBusy(true);
    try {
      const response = await fetch(`${OBSERVED_API_URL}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: parsed.toString() }),
      });

      if (!response.ok) {
        setError(`The worker refused the request (${response.status}).`);
        return;
      }

      const body = (await response.json()) as { review_id?: string };
      if (!body.review_id) {
        setError('The worker accepted the request but returned no review id.');
        return;
      }

      router.push(`/review/${encodeURIComponent(body.review_id)}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reach the worker.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <label className="visually-hidden" htmlFor="target-url">
        Address of the product to inspect
      </label>
      <input
        id="target-url"
        className="input"
        type="url"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="https://example-project.xyz"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        disabled={!IS_CONNECTED || busy}
      />

      <div className="row">
        <span className="section-label">Checks:</span>
        {LANDING_CHECKS.map((check) => (
          <span key={check.label} className="livepill">
            <span
              className={
                check.willRun
                  ? 'livepill__dot'
                  : 'livepill__dot livepill__dot--stopped'
              }
            />
            {check.label}
          </span>
        ))}
      </div>

      {IS_CONNECTED ? (
        <div className="row">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
          >
            {busy ? 'Starting…' : 'Start review'}
          </button>
        </div>
      ) : (
        // No worker yet. Say so plainly, and offer the labelled sample rather
        // than quietly starting something that looks real and is not.
        <div className="panel stack stack--tight">
          <p className="meta" style={{ margin: 0 }}>
            No review worker is connected to this deployment, so a real review
            cannot be started yet. The interface below is complete and is
            previewed with a clearly labelled sample record.
          </p>
          <div className="row">
            <Link className="btn" href="/review/sample">
              View a sample review
            </Link>
          </div>
        </div>
      )}

      {error ? (
        <p className="meta" style={{ color: 'var(--detected-amber)', margin: 0 }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
