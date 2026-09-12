/**
 * Exact decimal arithmetic on the amount strings used throughout Observed.
 *
 * Every monetary value in this project is a decimal STRING, never a number.
 * That is not stylistic. `0.1 + 0.2 !== 0.3` in IEEE-754, and a spend ledger
 * that can drift by a fraction of a cent per operation is a ledger that can
 * eventually authorise a call it should have refused. Rule 9 says fail closed,
 * so the arithmetic underneath it has to be exact.
 *
 * Amounts are converted to integer micro-units (1e-6) held in a BigInt, added,
 * and converted back to a string. No float ever touches a cap comparison.
 */

/** Six decimal places is well past the precision of any cap or price here. */
const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;
const UNITS_PATTERN = /^-?\d+$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

/**
 * "0.004" -> 4000n. Throws on anything that is not a plain non-negative decimal
 * with at most six decimal places — silently coercing a malformed amount is how
 * a cap check ends up comparing against `NaN` and passing.
 */
export function toUnits(amount: string): bigint {
  const trimmed = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new AmountError(`not a decimal amount: ${JSON.stringify(amount)}`);
  }

  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > SCALE) {
    throw new AmountError(
      `amount ${trimmed} has more than ${SCALE} decimal places`,
    );
  }

  const padded = fraction.padEnd(SCALE, '0');
  return BigInt(whole) * SCALE_FACTOR + BigInt(padded);
}

/** 4000n -> "0.004". Trailing zeros are trimmed; "0.00" becomes "0". */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;

  const whole = magnitude / SCALE_FACTOR;
  const fraction = (magnitude % SCALE_FACTOR)
    .toString()
    .padStart(SCALE, '0')
    .replace(/0+$/, '');

  const body = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/** Parse a value that is already known to be integer units (from a JSON file). */
export function unitsFromJson(value: unknown): bigint {
  if (typeof value === 'string' && UNITS_PATTERN.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new AmountError(`not integer units: ${JSON.stringify(value)}`);
}

export function addAmounts(a: string, b: string): string {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function subtractAmounts(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

/** -1 | 0 | 1. Named so a call site reads as a comparison, not a subtraction. */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const left = toUnits(a);
  const right = toUnits(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sumAmounts(amounts: readonly string[]): string {
  let total = 0n;
  for (const amount of amounts) total += toUnits(amount);
  return fromUnits(total);
}

/** `(spent + next) > cap`. Written once so the `>` is never accidentally `>=`. */
export function wouldExceedCap(
  spent: string,
  next: string,
  cap: string,
): boolean {
  return toUnits(spent) + toUnits(next) > toUnits(cap);
}
