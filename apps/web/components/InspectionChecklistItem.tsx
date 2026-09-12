import {
  IconActiveDot,
  IconObserved,
  IconPendingCircle,
} from './icons';

export type ChecklistState = 'done' | 'active' | 'pending';

/**
 * InspectionChecklistItem — exactly three visual states.
 *
 *   done    -> evidence-blue check
 *   active  -> filled evidence-blue dot, NO spinner animation
 *   pending -> muted empty circle
 *
 * The absence of a spinner is deliberate: a spinner is a "working on it"
 * idiom from app UI, and this screen is meant to read as an instrument
 * reporting, not an app loading.
 */
export function InspectionChecklistItem({
  label,
  state,
  elapsed,
}: {
  label: string;
  state: ChecklistState;
  elapsed?: string | null;
}) {
  return (
    <div className={`checkitem checkitem--${state}`}>
      <span className="evrow__icon">
        {state === 'done' ? (
          <IconObserved />
        ) : state === 'active' ? (
          <IconActiveDot />
        ) : (
          <IconPendingCircle />
        )}
      </span>
      <span className="checkitem__label">{label}</span>
      {elapsed ? <span className="checkitem__elapsed">{elapsed}</span> : null}
      {state === 'active' ? (
        <span className="visually-hidden">in progress</span>
      ) : null}
    </div>
  );
}
