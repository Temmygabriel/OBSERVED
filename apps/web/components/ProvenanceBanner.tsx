import type { RecordProvenance } from '@observed/shared-types';

/**
 * ProvenanceBanner — shown whenever a displayed record is not live.
 *
 * The design spec is explicit that a replay must carry the label "Replay of a
 * real review, recorded <date/time>", and must never be presented as if it
 * were happening live. This component is the only place that label is
 * rendered, so there is exactly one thing to get right.
 *
 * It renders nothing for live records — those need no disclaimer.
 */
export function ProvenanceBanner({
  provenance,
  label,
}: {
  provenance: RecordProvenance;
  label: string | null;
}) {
  if (provenance === 'live' || !label) return null;

  const tag = provenance === 'sample' ? 'Sample' : 'Replay';

  return (
    <div className="provenance" role="note">
      <span className="provenance__label">{tag}</span>
      <span className="provenance__text">{label}</span>
    </div>
  );
}
