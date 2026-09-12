import type { PolicyRefusal } from '@observed/shared-types';

/**
 * Screen 7 — Excluded (conflict-of-interest refusal).
 *
 * This screen makes Rule 5 visible and provable in the product itself, rather
 * than only claimed in a README. Two things it deliberately does NOT do:
 *
 *   - it is not hidden behind a generic "not available" — the reason is stated
 *     in plain language;
 *   - it does not apologise. Refusing to review your own entry is the correct
 *     behaviour, and presenting it as a shortcoming would be dishonest in the
 *     other direction.
 */
export function ExcludedScreen({ refusal }: { refusal: PolicyRefusal }) {
  return (
    <section className="state">
      <h2 className="state__title">This project can&rsquo;t be reviewed</h2>

      <p className="state__body">{refusal.explanation}</p>

      <details>
        <summary className="chip" style={{ display: 'inline-block' }}>
          Why this rule exists
        </summary>

        <div className="stack stack--tight" style={{ marginTop: 'var(--s4)' }}>
          <p className="meta" style={{ margin: 0 }}>
            Observed&rsquo;s operator is also an entrant in this hackathon. A
            reviewer that scores its own entry is not a reviewer, so the
            exclusion check runs <em>before</em> any evidence is gathered and
            before any money is spent.
          </p>
          <p className="meta" style={{ margin: 0 }}>
            The check compares the project&rsquo;s domain, repository owner,
            Telegram handle, wallet addresses and ERC-8004 identity against the
            operator&rsquo;s own identifiers. A match refuses the project
            outright.
          </p>
          <p className="meta" style={{ margin: 0 }}>
            This refusal is recorded. No evidence artifact exists for this
            project, because none was collected.
          </p>
        </div>
      </details>
    </section>
  );
}
