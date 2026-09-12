/**
 * The tri-state icon set.
 *
 * Three states only, matching Rule 3 and the copy guidelines:
 *   Observed          -> check, in the single accent colour
 *   Detected          -> cross, in detected-amber
 *   Unable to verify  -> a neutral dot, deliberately colourless
 *
 * "Unable to verify" gets no accent colour on purpose. Giving it one would
 * imply a verdict the evidence does not support.
 *
 * Colours are applied via the `style` attribute rather than presentation
 * attributes, because SVG presentation attributes do not accept `var()`.
 */

type IconProps = { size?: number };

export function IconObserved({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.25 8.4 6.4 11.6 12.75 4.6"
        fill="none"
        style={{ stroke: 'var(--evidence-blue)' }}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDetected({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5"
        fill="none"
        style={{ stroke: 'var(--detected-amber)' }}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconUnknown({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="2.25" style={{ fill: 'var(--ink-muted)' }} />
    </svg>
  );
}

/** Filled dot — the "active" state of an inspection checklist item. */
export function IconActiveDot({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="3.25" style={{ fill: 'var(--evidence-blue)' }} />
    </svg>
  );
}

/** Empty circle — the "pending" state. */
export function IconPendingCircle({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="3.25"
        fill="none"
        style={{ stroke: 'var(--rule-strong)' }}
        strokeWidth="1.25"
      />
    </svg>
  );
}
