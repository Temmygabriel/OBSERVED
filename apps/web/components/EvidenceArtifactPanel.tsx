import { Fragment } from 'react';
import type { EvidenceArtifact } from '@observed/shared-types';
import { formatClockUtc } from '@/lib/format';

/**
 * The evidence reference: a small outline button, and the artifact detail it
 * opens.
 *
 * Both pieces are presentational and stateless so that a parent can decide
 * WHERE the panel appears in the flow. That matters — the panel must open
 * below the claim, not inside the claim's footer row, or it would be squeezed
 * into a flex item instead of pushing the page down.
 *
 * Deliberately not a modal. See ClaimCard for why.
 */

export function evidencePanelId(artifactId: string): string {
  return `evidence-panel-${artifactId}`;
}

/**
 * Rule 11 — nothing that looks like a credential reaches the screen, even if a
 * collector one day puts one into `metadata` by mistake. The failure mode we
 * want is "a field went missing", never "a credential was published".
 */
const SENSITIVE_METADATA_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;

export function publicMetadata(
  artifact: EvidenceArtifact,
): Array<[string, string]> {
  return Object.entries(artifact.metadata)
    .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
    .map(([key, value]) => [key, String(value)] as [string, string]);
}

export function EvidenceChipButton({
  open,
  onToggle,
  label,
  panelId,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  panelId: string;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

export function EvidencePanel({
  artifact,
  panelId,
}: {
  artifact: EvidenceArtifact;
  panelId: string;
}) {
  return (
    <div className="evidence-panel" id={panelId}>
      <dl className="kv">
        <dt className="kv__key">Artifact</dt>
        <dd className="kv__val">{artifact.artifact_id}</dd>

        <dt className="kv__key">Collector</dt>
        <dd className="kv__val">
          {artifact.collector} v{artifact.collector_version}
        </dd>

        <dt className="kv__key">Target</dt>
        <dd className="kv__val">{artifact.target_url}</dd>

        <dt className="kv__key">Resolved IP</dt>
        <dd className="kv__val">{artifact.resolved_ip ?? 'not recorded'}</dd>

        <dt className="kv__key">Observed at</dt>
        <dd className="kv__val">{formatClockUtc(artifact.observed_at)}</dd>

        <dt className="kv__key">Status</dt>
        <dd className="kv__val">{artifact.status}</dd>

        <dt className="kv__key">sha256</dt>
        <dd className="kv__val">{artifact.content_hash}</dd>

        {artifact.provider_request_id ? (
          <>
            <dt className="kv__key">Paid request</dt>
            <dd className="kv__val">{artifact.provider_request_id}</dd>
          </>
        ) : null}

        {publicMetadata(artifact).map(([key, value]) => (
          <Fragment key={key}>
            <dt className="kv__key">{key}</dt>
            <dd className="kv__val">{value}</dd>
          </Fragment>
        ))}
      </dl>

      <p className="meta" style={{ marginTop: 'var(--s4)', marginBottom: 0 }}>
        The raw artifact is retained privately and is not reproduced here. The
        sha256 above is what makes it checkable — if the raw artifact were ever
        altered, it would no longer hash to this value.
      </p>
    </div>
  );
}
