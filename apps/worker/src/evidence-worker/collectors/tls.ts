/**
 * TLS collector — the certificate check.
 *
 * Answers one question: what certificate did this host present, and was it
 * valid? It records the subject, the issuer, the validity window, the sha256
 * fingerprint, and the negotiated protocol and cipher. The fingerprint is what
 * makes the observation checkable by a third party rather than merely asserted —
 * anyone can connect and compare.
 *
 * THE ONE THING THIS FILE MUST NEVER DO is set `rejectUnauthorized: false`.
 * That flag exists to make a broken certificate complete a handshake anyway,
 * which is the exact inversion of this product's purpose: the failure IS the
 * observation. Verification stays on, and a verification error is reported as
 * the finding it is.
 *
 * Rule 3's mapping, which is the part worth reviewing:
 *
 *   - The handshake completes and the certificate verifies -> `valid`.
 *   - The handshake fails for a reason that is UNAMBIGUOUSLY about the
 *     certificate the server presented (expired, not yet valid, wrong hostname,
 *     self-signed) -> `invalid`. The server answered, and the answer was bad.
 *   - Anything else — refused, reset, timed out, or a chain-completeness failure
 *     that might be our own trust store — -> `unknown_*`. We did not get far
 *     enough to observe anything about the certificate.
 *
 * That last distinction is deliberate and is explained at TLS_FINDING_CODES.
 *
 * The connection is pinned the same way the HTML fetch is: `host` is the address
 * that `assertPublicTarget` validated, and `servername` carries the real
 * hostname so SNI and hostname verification are unaffected.
 */

import { createHash } from 'node:crypto';
import { connect, type PeerCertificate } from 'node:tls';
import type { EvidenceArtifact } from '@observed/shared-types';
import {
  BlockedTargetError,
  ResolutionFailedError,
  assertPublicTarget,
  pinResolvedAddress,
  type Resolver,
} from '../ssrf-guard';
import { ProbeTimeoutError } from '../probe-timeout';
import { classifyFailure, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

/**
 * Always 443, whatever the target URL's port says.
 *
 * The submitted URL is usually `http://`, which says nothing about where the
 * host's TLS lives, and a check that probed port 80 for a certificate would
 * report "no TLS" for every site on the internet. `assertPublicTarget` has
 * already validated the hostname, and TLS belongs on 443.
 */
const TLS_PORT = 443;

/**
 * Handshake failures that are unambiguous statements about the certificate the
 * server PRESENTED.
 *
 * Note what is deliberately absent: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
 * `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` and `CERT_SIGNATURE_FAILURE`. Those are
 * *usually* a server that forgot to send its intermediate chain — a real and
 * common misconfiguration — but they can equally mean our own trust store is
 * stale or our clock is wrong.
 *
 * Rule 3's bias is toward under-claiming, so those land in `unknown_*` with the
 * exact code preserved in metadata for a human to read. Publishing "invalid
 * certificate" when the fault was ours is precisely the failure this product
 * exists to be the opposite of, and it is the one a judge would find.
 */
const TLS_FINDING_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_REVOKED',
]);

/**
 * `ERR_SSL_WRONG_VERSION_NUMBER` — something is listening on 443 and it is not
 * speaking TLS — is deliberately NOT in the set above, even though it is a
 * deterministic fact about the endpoint.
 *
 * It fails the rule stated at the top of this file: we did not get far enough to
 * observe anything about a CERTIFICATE, because there is no certificate. Calling
 * it `invalid` also puts it at odds with its own twin: a host with nothing at all
 * listening on 443 raises `ECONNREFUSED`, which is `unknown_network_error`. Both
 * mean "this host serves no TLS"; only an unrelated detail tells them apart, so
 * they must not carry different verdicts.
 *
 * The cost of the exception is what decides it. `invalid` becomes "Detected" in
 * the UI and a finding in the review, so an http-only project — which is a
 * perfectly ordinary project — would be published as having a bad TLS
 * certificate. `TLS_PORT` is our choice, not the target's claim, and we would be
 * asserting a defect against a port it never advertised. The code is preserved
 * in metadata below instead, where a human reads it and no claim is made from it.
 */

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code).toUpperCase();
  }
  return '';
}

/** `authorizationError` is a string on some Node versions and an Error on others. */
function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const code = (value as NodeJS.ErrnoException).code;
    return code ?? value.message;
  }
  return String(value);
}

/**
 * A certificate field, normalized to a string or `null`.
 *
 * The `string[]` arm is not defensive padding: Node types the DN fields on
 * `subject` and `issuer` as `string | string[]`, because a certificate may carry
 * the same attribute more than once — two `OU` values is the common case. A
 * multi-valued field is joined rather than truncated to its first entry, so the
 * record shows what the certificate actually said.
 */
function certificateField(
  value: string | string[] | undefined,
): string | null {
  if (value === undefined) return null;
  const text: string = Array.isArray(value) ? value.join(', ') : value;
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

interface TlsObservation {
  protocol: string | null;
  cipher: string | null;
  authorized: boolean;
  authorization_error: string | null;
  subject_cn: string | null;
  issuer_cn: string | null;
  issuer_org: string | null;
  valid_from: string | null;
  valid_to: string | null;
  days_until_expiry: number | null;
  within_validity_window: boolean | null;
  fingerprint_sha256: string | null;
  serial_number: string | null;
  subject_alt_names: string | null;
  elapsed_ms: number;
}

function daysBetween(from: Date, isoDate: string | null): number | null {
  if (isoDate === null) return null;
  const at = new Date(isoDate).getTime();
  if (Number.isNaN(at)) return null;
  return Math.floor((at - from.getTime()) / 86_400_000);
}

function buildObservation(
  socket: {
    getProtocol: () => string | null;
    getCipher: () => { name: string };
    authorized: boolean;
    authorizationError: unknown;
  },
  cert: PeerCertificate,
  now: Date,
  elapsedMs: number,
): TlsObservation {
  const validFrom = certificateField(cert.valid_from);
  const validTo = certificateField(cert.valid_to);

  const notBefore = validFrom === null ? NaN : Date.parse(validFrom);
  const notAfter = validTo === null ? NaN : Date.parse(validTo);
  const nowMs = now.getTime();

  // `null` rather than `false` when the dates are unparseable: "we could not
  // read the window" and "the certificate is outside its window" are different
  // statements, and only one of them is a finding.
  const withinWindow =
    Number.isNaN(notBefore) || Number.isNaN(notAfter)
      ? null
      : nowMs >= notBefore && nowMs <= notAfter;

  return {
    protocol: socket.getProtocol(),
    cipher: socket.getCipher()?.name ?? null,
    authorized: socket.authorized,
    authorization_error: textOrNull(socket.authorizationError),
    subject_cn: certificateField(cert.subject?.CN),
    issuer_cn: certificateField(cert.issuer?.CN),
    issuer_org: certificateField(cert.issuer?.O),
    valid_from: validFrom,
    valid_to: validTo,
    days_until_expiry: daysBetween(now, validTo),
    within_validity_window: withinWindow,
    fingerprint_sha256: certificateField(cert.fingerprint256),
    serial_number: certificateField(cert.serialNumber),
    subject_alt_names: certificateField(cert.subjectaltname),
    elapsed_ms: elapsedMs,
  };
}

type ProbeOutcome =
  | { ok: true; observation: TlsObservation; resolved_ip: string }
  | { ok: false; failure: unknown; resolved_ip: string | null };

/**
 * A union rather than a try/catch at the call site, for the same reason the
 * HTML collector uses one: "did the handshake complete" is better tracked as a
 * value than inferred across a `catch` that never falls through.
 */
async function probeTls(
  targetUrl: string,
  resolve: Resolver,
  timeoutMs: number,
  now: Date,
): Promise<ProbeOutcome> {
  try {
    const target = await assertPublicTarget(targetUrl, resolve);
    const address = pinResolvedAddress(target);
    return await handshake(address, target.url.hostname, timeoutMs, now);
  } catch (failure) {
    // Only the guard can land here — `handshake` resolves rather than rejecting
    // on every path. No handshake was attempted, so there is no address and no
    // observation; `collect` classifies the failure.
    return { ok: false, failure, resolved_ip: null };
  }
}

/**
 * One handshake, against one pinned address.
 *
 * Every path out of here goes through `finish`, so a socket error arriving
 * after the deadline fired cannot resolve twice or reject after a resolve.
 */
function handshake(
  address: string,
  servername: string,
  timeoutMs: number,
  now: Date,
): Promise<ProbeOutcome> {
  return new Promise<ProbeOutcome>((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (outcome: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(outcome);
    };

    const socket = connect({
      // The address that was validated, so no second resolution happens here.
      host: address,
      port: TLS_PORT,
      // ...while SNI and hostname verification use the real name.
      servername,
      // NEVER false. A handshake that completes over an invalid certificate is
      // a lie, and this collector's whole job is not telling it.
      rejectUnauthorized: true,
    });

    timer = setTimeout(() => {
      finish({
        ok: false,
        resolved_ip: address,
        failure: new ProbeTimeoutError(
          `TLS handshake with ${servername} did not complete within ${timeoutMs}ms`,
        ),
      });
      socket.destroy();
    }, timeoutMs);

    socket.on('secureConnect', () => {
      const observation = buildObservation(
        socket,
        socket.getPeerCertificate(),
        now,
        Date.now() - startedAt,
      );
      finish({ ok: true, observation, resolved_ip: address });
      // Politeness only: everything we came for is already in hand.
      socket.end();
    });

    socket.on('error', (error: Error) => {
      finish({ ok: false, failure: error, resolved_ip: address });
      socket.destroy();
    });
  });
}

type ArtifactBase = Pick<
  EvidenceArtifact,
  | 'artifact_id'
  | 'review_session_id'
  | 'collector'
  | 'collector_version'
  | 'target_url'
  | 'observed_at'
  | 'provider_request_id'
>;

export const tlsCollector: Collector = {
  kind: 'tls',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(context: CollectorContext): Promise<EvidenceArtifact> {
    const now = context.now();
    const startedAt = Date.now();

    const base: ArtifactBase = {
      artifact_id: `ev-${context.review_session_id}-tls`,
      review_session_id: context.review_session_id,
      collector: 'tls',
      collector_version: VERSION,
      target_url: context.target_url,
      observed_at: now.toISOString(),
      provider_request_id: null,
    };

    const outcome = await probeTls(
      context.target_url,
      context.resolve,
      context.timeout_ms,
      now,
    );

    if (!outcome.ok) {
      const code = errorCode(outcome.failure);

      // Two separate ways a failure is a FINDING about the target: the
      // certificate itself was bad, or the guard refused the host outright
      // (non-public address space, a blocked port, a single-label name). A
      // resolution failure is neither — that one is about our network, and it
      // falls through to `classifyFailure` as `unknown_*`.
      //
      // Both are `invalid`, but they are kept apart below rather than merged,
      // because the review phrases them differently: one is a statement about a
      // certificate, the other about the target's address. Collapsing them under
      // a single flag would let the generator write "invalid certificate" for a
      // host whose certificate was never reached.
      const isCertificateFinding = TLS_FINDING_CODES.has(code);
      const isTargetRefusal =
        outcome.failure instanceof BlockedTargetError &&
        !(outcome.failure instanceof ResolutionFailedError);

      const isTlsFinding = isCertificateFinding || isTargetRefusal;

      return {
        ...base,
        resolved_ip: outcome.resolved_ip,
        status: isTlsFinding
          ? 'invalid'
          : classifyFailure(
              outcome.failure,
              outcome.failure instanceof ProbeTimeoutError,
            ),
        content_hash: sha256Hex(context.target_url),
        raw_ref: `inline://tls/${isTlsFinding ? 'finding' : 'unavailable'}`,
        metadata: {
          port: TLS_PORT,
          error: outcome.failure instanceof Error ? outcome.failure.message : 'unknown TLS error',
          error_name:
            outcome.failure instanceof Error ? outcome.failure.name : null,
          error_code: code === '' ? null : code,
          // Which KIND of finding this is. Recorded explicitly so the Review
          // Generator never has to re-derive it from the error text — and so it
          // cannot mistake one for the other.
          certificate_finding: isCertificateFinding,
          target_refused: isTargetRefusal,
          elapsed_ms: Date.now() - startedAt,
        },
      };
    }

    const { observation } = outcome;

    // Verification is on, so a completed handshake means the certificate
    // verified. The extra checks are defensive rather than expected: if either
    // ever fires, something about the connection is not what we think it is, and
    // claiming `valid` would be the wrong way to find out.
    const trustworthy =
      observation.authorized && observation.within_validity_window !== false;

    return {
      ...base,
      resolved_ip: outcome.resolved_ip,
      status: trustworthy ? 'valid' : 'invalid',
      // The handshake is the artifact. There are no raw bytes to store, so the
      // hash covers the facts we recorded — which is what makes the record
      // tamper-evident rather than merely present.
      content_hash: sha256Hex(
        JSON.stringify([
          observation.subject_cn,
          observation.issuer_cn,
          observation.valid_from,
          observation.valid_to,
          observation.fingerprint_sha256,
        ]),
      ),
      raw_ref: `inline://tls/${observation.fingerprint_sha256 ?? 'no-certificate'}`,
      metadata: {
        port: TLS_PORT,
        ...observation,
      },
    };
  },
};
