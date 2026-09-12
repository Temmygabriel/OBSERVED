'use client';

import { useState } from 'react';
import type { EvidenceArtifact, ReviewClaim } from '@observed/shared-types';
import {
  buildCitation,
  claimConfidenceLabel,
  renderClaimAction,
  renderClaimSentence,
} from '@/lib/claims';
import {
  EvidenceChipButton,
  EvidencePanel,
  evidencePanelId,
} from './EvidenceArtifactPanel';

/**
 * ClaimCard — one claim, its inline citation, and its evidence reference.
 *
 * The evidence panel opens IN FLOW, pushing content down. The design spec
 * rules out modals that need `position: fixed`, and the reason is not only
 * stylistic: a panel that floats over the claim is a panel you can dismiss
 * without reading, and this product is about not being able to skip the
 * receipt.
 */

export function ClaimCard({
  claim,
  artifact,
  index,
}: {
  claim: ReviewClaim;
  artifact: EvidenceArtifact | null;
  index: number;
}) {
  const [open, setOpen] = useState(false);

  const evidenceLabel = `Evidence ${String(index).padStart(2, '0')}`;
  const panelId = evidencePanelId(claim.claim_id);
  const action = renderClaimAction(claim);

  return (
    <article className="claim">
      <div className="claim__body stack stack--tight">
        <p className="claim__sentence">{renderClaimSentence(claim)}</p>

        <dl className="claim__detail">
          <div className="claim__detail-row">
            <dt className="claim__detail-key">Observation</dt>
            <dd className="claim__detail-val mono mono--strong">
              {claim.observation}
            </dd>
          </div>

          <div className="claim__detail-row">
            <dt className="claim__detail-key">Locator</dt>
            <dd className="claim__detail-val mono">{claim.exact_locator}</dd>
          </div>

          {action ? (
            <div className="claim__detail-row">
              <dt className="claim__detail-key">Suggested fix</dt>
              <dd className="claim__detail-val">{action}</dd>
            </div>
          ) : null}

          <div className="claim__detail-row">
            <dt className="claim__detail-key">Confidence</dt>
            <dd className="claim__detail-val">{claimConfidenceLabel(claim)}</dd>
          </div>
        </dl>
      </div>

      <div className="claim__footer">
        <span className="citation">{buildCitation(claim, artifact)}</span>

        {artifact ? (
          <EvidenceChipButton
            open={open}
            onToggle={() => setOpen((value) => !value)}
            label={evidenceLabel}
            panelId={panelId}
          />
        ) : (
          // A claim with no artifact behind it should be impossible to render.
          // If it ever happens, say so loudly rather than hiding the gap.
          <span className="citation" style={{ color: 'var(--detected-amber)' }}>
            No evidence artifact linked
          </span>
        )}
      </div>

      {open && artifact ? (
        <EvidencePanel artifact={artifact} panelId={panelId} />
      ) : null}
    </article>
  );
}
