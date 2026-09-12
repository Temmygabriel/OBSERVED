/**
 * @observed/shared-types
 *
 * The type contracts every Observed module agrees on.
 *
 * Types and pure helpers only — no I/O, no network, no dependencies. That
 * constraint is deliberate: this package is imported by the frontend, the
 * worker, and (later) the test suite, and it must never become a place where
 * side effects hide.
 */

export * from './evidence';
export * from './policy';
export * from './payment';
export * from './review';
export * from './api';
