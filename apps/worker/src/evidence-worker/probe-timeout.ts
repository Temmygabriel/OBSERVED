/**
 * Raised when a probe runs out of its deadline.
 *
 * Shared by the HTTP fetcher and the TLS prober because both need the same Rule
 * 3 answer: a timeout is `unknown_timeout`, never `invalid`. We did not observe
 * the target failing; we observed our own deadline passing.
 *
 * It lives in its own module so that the TLS collector does not have to import
 * an HTTP client to name the error it throws.
 */
export class ProbeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeTimeoutError';
  }
}
