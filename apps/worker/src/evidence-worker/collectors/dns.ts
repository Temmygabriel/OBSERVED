/**
 * DNS collector — implemented, not a stub.
 *
 * This is the one collector that needs no HTTP client and no paid call, so
 * there is no reason for it to be a placeholder. It answers two questions the
 * review can cite directly:
 *
 *   - does the hostname resolve at all, and to what;
 *   - does the resolved set stay inside public address space (Rule 4).
 *
 * The second question is why a private-space answer is a real `invalid` rather
 * than a refusal. For a SUBMITTED project, "this domain points at 10.x.x.x" is
 * a genuine, citable finding about the submission. The SSRF guard separately
 * refuses to FETCH such a target; it does not pretend the observation was never
 * made. Collapsing those two decisions would hide the finding.
 *
 * Resolution goes through `context.resolve` rather than a locally constructed
 * resolver, so every branch here is reachable in a test without a DNS server.
 */

import { createHash } from 'node:crypto';
import type { EvidenceArtifact } from '@observed/shared-types';
import { isPublicAddress } from '../ssrf-guard';
import { classifyFailure, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code).toUpperCase();
  }
  return '';
}

export const dnsCollector: Collector = {
  kind: 'dns',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(context: CollectorContext): Promise<EvidenceArtifact> {
    const observedAt = context.now().toISOString();
    const startedAt = Date.now();

    const base = {
      artifact_id: `ev-${context.review_session_id}-dns`,
      review_session_id: context.review_session_id,
      collector: 'dns' as const,
      collector_version: VERSION,
      target_url: context.target_url,
      observed_at: observedAt,
      provider_request_id: null,
    };

    let hostname: string;
    try {
      hostname = new URL(context.target_url).hostname;
    } catch {
      // The target URL itself is malformed. That is a fact we can state plainly.
      return {
        ...base,
        resolved_ip: null,
        status: 'invalid',
        content_hash: sha256Hex(context.target_url),
        raw_ref: 'inline://dns/malformed-target',
        metadata: {
          error: 'target_url is not a valid absolute URL',
          elapsed_ms: Date.now() - startedAt,
        },
      };
    }

    let addresses: string[];
    try {
      addresses = await context.resolve(hostname);
    } catch (error) {
      const code = errorCode(error);
      const timedOut = code === 'ETIMEDOUT' || code === 'EAI_AGAIN';

      // "No such name" is a finding about the submission. "The resolver did
      // not answer" is a finding about our network. Rule 3 keeps them apart.
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return {
          ...base,
          resolved_ip: null,
          status: 'invalid',
          content_hash: sha256Hex(hostname),
          raw_ref: `inline://dns/nxdomain/${hostname}`,
          metadata: { hostname, error: 'the hostname did not resolve' },
        };
      }

      return {
        ...base,
        resolved_ip: null,
        status: classifyFailure(error, timedOut),
        content_hash: sha256Hex(hostname),
        raw_ref: `inline://dns/unavailable/${hostname}`,
        metadata: {
          hostname,
          error: error instanceof Error ? error.message : 'unknown resolver error',
          elapsed_ms: Date.now() - startedAt,
        },
      };
    }

    const unique = [...new Set(addresses)].sort();

    if (unique.length === 0) {
      return {
        ...base,
        resolved_ip: null,
        status: 'invalid',
        content_hash: sha256Hex(hostname),
        raw_ref: `inline://dns/empty/${hostname}`,
        metadata: { hostname, error: 'the hostname resolved to no addresses' },
      };
    }

    const nonPublic = unique.filter((address) => !isPublicAddress(address));

    return {
      ...base,
      resolved_ip: unique[0] ?? null,
      status: nonPublic.length > 0 ? 'invalid' : 'valid',
      content_hash: sha256Hex(`${hostname}\n${unique.join('\n')}`),
      raw_ref: `inline://dns/${hostname}`,
      metadata: {
        hostname,
        addresses: unique,
        address_count: unique.length,
        non_public_addresses: nonPublic,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  },
};
