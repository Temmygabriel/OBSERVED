'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  CopyState,
  EvidenceArtifact,
  ReviewClaim,
} from '@observed/shared-types';
import { buildCitation, renderClaimSentence } from '@/lib/claims';
import { compactUrl, formatClockUtc } from '@/lib/format';
import {
  EvidenceChipButton,
  EvidencePanel,
  evidencePanelId,
} from './EvidenceArtifactPanel';
import {
  InspectionChecklistItem,
  type ChecklistState,
} from './InspectionChecklistItem';

/**
 * The hero moment: Claim -> Proof.
 *
 * Not a stamp, not a badge, not a checkmark animation. It is the product's
 * literal mechanism given a full screen and real time to unfold, in the one
 * order that matters: the evidence is on screen BEFORE the sentence that
 * depends on it.
 *
 * The animation is declarative rather than imperative on purpose. Revealed
 * text is always in the DOM and gated by an attribute, so:
 *   - `prefers-reduced-motion` can force every stage resolved with a CSS rule,
 *     at first paint, with no flash and no JS timing involved;
 *   - the sentence exists for screen readers and for copy-paste from the very
 *     first frame, which is the honest state — we know the sentence already,
 *     we are just pacing its appearance.
 */

const STAGES = ['FETCH', 'OBSERVE', 'COMPARE', 'WRITE'] as const;

/** The beat where the viewer registers "that's real" before the prose appears.
 *  Deliberate. Do not shorten it. */
const FACT_HOLD_MS = 150;

/** Milliseconds spent on each step of the sequence, per the design spec's
 *  400-700ms per stage, plus the fact hold. */
const STEP_DELAYS_MS: readonly number[] = [500, 600, FACT_HOLD_MS, 500, 400];

const WORD_INTERVAL_MS = 90;
const SENTENCE_SETTLE_MS = 140;

/**
 * Step 0 arrived, 1 FETCH done, 2 OBSERVE done (fact visible), 3 fact hold
 * ended, 4 COMPARE done, 5 WRITE running, 6 finished.
 */
const FINAL_STEP = 6;
const WRITE_STEP = 5;

/**
 * One state function for both the stage strip and the checklist, because they
 * advance together — a stage is never "done" while the check that produced it
 * is still pending. If those two ever disagree on screen, the screen is lying.
 */
function revealState(index: number, step: number): ChecklistState {
  switch (index) {
    case 0:
      return step >= 1 ? 'done' : 'active';
    case 1:
      return step >= 2 ? 'done' : step === 1 ? 'active' : 'pending';
    case 2:
      return step >= 4 ? 'done' : step >= 2 ? 'active' : 'pending';
    case 3:
      return step >= FINAL_STEP ? 'done' : step === WRITE_STEP ? 'active' : 'pending';
    default:
      return 'pending';
  }
}

export interface HeroFact {
  /** e.g. "POST /signup" */
  request: string;
  /** e.g. "404" */
  result: string;
  /** ISO 8601 UTC. */
  observedAt: string;
}

export interface HeroCheck {
  label: string;
  /**
   * A real measured duration, or null when the run did not record one.
   * Null is rendered as nothing at all — inventing a plausible-looking "412ms"
   * to make the checklist look busier would be exactly the kind of decoration
   * this product is built to avoid.
   */
  elapsedMs: number | null;
}

export interface HeroSequenceProps {
  projectName: string | null;
  targetUrl: string;
  fact: HeroFact;
  copyState: CopyState;
  checks: HeroCheck[];
  claim: ReviewClaim;
  artifact: EvidenceArtifact | null;
}

export function HeroSequence({
  projectName,
  targetUrl,
  fact,
  copyState,
  checks,
  claim,
  artifact,
}: HeroSequenceProps) {
  const [step, setStep] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const sentence = renderClaimSentence(claim);
  const words = useMemo(() => sentence.split(' '), [sentence]);
  const panelId = evidencePanelId(claim.claim_id);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  // Advance the sequence. Hand-off to the word effect happens at WRITE_STEP.
  useEffect(() => {
    if (reducedMotion) {
      setStep(FINAL_STEP);
      setWordCount(words.length);
      return;
    }
    if (step >= WRITE_STEP) return;

    const delay = STEP_DELAYS_MS[step];
    if (delay === undefined) return;

    const timer = window.setTimeout(() => setStep((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [step, reducedMotion, words.length]);

  // Render the sentence one word at a time, then settle.
  useEffect(() => {
    if (reducedMotion) return;
    if (step !== WRITE_STEP) return;

    if (wordCount >= words.length) {
      const timer = window.setTimeout(
        () => setStep(FINAL_STEP),
        SENTENCE_SETTLE_MS,
      );
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(
      () => setWordCount((value) => value + 1),
      WORD_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [step, wordCount, words.length, reducedMotion]);

  const revealedWords = reducedMotion ? words.length : wordCount;
  const factRevealed = step >= 2;
  const finished = step >= FINAL_STEP;

  const replay = () => {
    setEvidenceOpen(false);
    setWordCount(0);
    setStep(0);
  };

  return (
    <div className="stack">
      {/* 1. The target, shown plainly. */}
      <div className="hero__target">
        <span className="mono mono--strong">{compactUrl(targetUrl)}</span>
        {projectName ? <span className="h2">{projectName}</span> : null}
      </div>

      {/* 2. The inspection sequence, in order. */}
      <div className="hero__stages" role="list" aria-label="Inspection stages">
        {STAGES.map((stage, index) => {
          const state = revealState(index, step);
          return (
            <span
              key={stage}
              role="listitem"
              className={`stage stage--${state}`}
              data-revealed={state !== 'pending'}
            >
              <span className="stage__dot" aria-hidden="true" />
              {stage}
            </span>
          );
        })}
      </div>

      {/* 3. The checks, advancing in the same order as the stages. */}
      <div className="panel">
        <p className="section-label" style={{ marginBottom: 'var(--s2)' }}>
          Checks
        </p>
        {checks.map((check, index) => {
          const state = revealState(index, step);
          return (
            <InspectionChecklistItem
              key={check.label}
              label={check.label}
              state={state}
              elapsed={
                state === 'done' && check.elapsedMs !== null
                  ? `${check.elapsedMs} ms`
                  : null
              }
            />
          );
        })}
      </div>

      {/* 4. The raw observed fact, before any interpretation. */}
      <div className="exhibit">
        <span className="exhibit__tag">{copyState}</span>
        <div className="fact" data-revealed={factRevealed}>
          <span>{fact.request}</span>
          <span aria-hidden="true">&rarr;</span>
          <span
            className={
              copyState === 'Detected'
                ? 'fact__result fact__result--detected'
                : 'fact__result'
            }
          >
            {fact.result}
          </span>
          <span className="fact__time">{formatClockUtc(fact.observedAt)}</span>
        </div>
      </div>

      {/* 5. Only now does the sentence render, word by word, visibly built
             from the fact directly above it. */}
      <article className="claim">
        <div className="claim__body">
          <p className="sentence">
            {words.map((word, index) => (
              <Fragment key={`${word}-${index}`}>
                <span
                  className="sentence__word"
                  data-revealed={index < revealedWords}
                >
                  {word}
                </span>
                {index < words.length - 1 ? ' ' : null}
              </Fragment>
            ))}
          </p>
        </div>

        {/* 6. The sentence points back at an exhibit the viewer can open. */}
        {finished ? (
          <div className="claim__footer">
            <span className="citation">{buildCitation(claim, artifact)}</span>

            {artifact ? (
              <EvidenceChipButton
                open={evidenceOpen}
                onToggle={() => setEvidenceOpen((value) => !value)}
                label="Evidence 01"
                panelId={panelId}
              />
            ) : (
              <span
                className="citation"
                style={{ color: 'var(--detected-amber)' }}
              >
                No evidence artifact linked
              </span>
            )}
          </div>
        ) : null}

        {evidenceOpen && artifact ? (
          <EvidencePanel artifact={artifact} panelId={panelId} />
        ) : null}
      </article>

      {/* Replaying is a demo affordance, not a product feature. It is hidden
          for reduced-motion users because the sequence is already instant for
          them, which would make the button appear to do nothing. */}
      {finished && !reducedMotion ? (
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={replay}>
            Replay sequence
          </button>
        </div>
      ) : null}
    </div>
  );
}
