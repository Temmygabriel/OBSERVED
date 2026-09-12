import type { CopyState } from '@observed/shared-types';
import { IconDetected, IconObserved, IconUnknown } from './icons';

/**
 * EvidenceRow — tri-state icon, label, and an optional right-aligned mono
 * value (a status code, a timestamp).
 *
 * The mono value is only ever machine-observed data. Never prose.
 */

function IconFor({ state }: { state: CopyState }) {
  switch (state) {
    case 'Observed':
      return <IconObserved />;
    case 'Detected':
      return <IconDetected />;
    case 'Unable to verify':
      return <IconUnknown />;
  }
}

function valueClass(state: CopyState): string {
  switch (state) {
    case 'Observed':
      return 'evrow__value evrow__value--observed';
    case 'Detected':
      return 'evrow__value evrow__value--detected';
    case 'Unable to verify':
      return 'evrow__value';
  }
}

export function EvidenceRow({
  label,
  copyState,
  value,
}: {
  label: string;
  copyState: CopyState;
  value?: string | null;
}) {
  return (
    <div className="evrow">
      <span className="evrow__icon">
        <IconFor state={copyState} />
      </span>
      <span className="evrow__label">{label}</span>
      {value ? (
        <span className={valueClass(copyState)}>{value}</span>
      ) : (
        // Screen readers still get the state even when there is no numeric
        // value to show.
        <span className="visually-hidden">{copyState}</span>
      )}
    </div>
  );
}
