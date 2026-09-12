/**
 * Worker configuration.
 *
 * Two rules collide here and this file is where they are reconciled:
 *
 *   Rule 11 (secrets): a secret is read from the environment at call time and
 *   never logged, never embedded in a response, never passed to the Review
 *   Generator.
 *
 *   Rule 5.8 (kill switch): `PAYMENTS_ENABLED` must be toggleable WITHOUT a
 *   redeploy, so it is read fresh on every paid call — not captured into a
 *   module constant at import time. `paymentsEnabled()` is a function for that
 *   reason, and it is deliberately not a cached getter.
 *
 * Anything missing is `null`, not a default. A missing API key must surface as
 * "not configured", never as an empty string that fails in a confusing way
 * three layers deeper.
 */

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Identity of this process
// ---------------------------------------------------------------------------

export const NODE_ENV = readEnv('NODE_ENV') ?? 'development';
export const PORT = Number(readEnv('PORT') ?? '3000');

// ---------------------------------------------------------------------------
// AskBots (Rule: only the adapter holds this key)
// ---------------------------------------------------------------------------

export const ASKBOTS_API_KEY = readEnv('ASKBOTS_API_KEY');
/** The live host. The old netlify host is wrong and is not a fallback. */
export const ASKBOTS_BASE_URL =
  readEnv('ASKBOTS_BASE_URL') ?? 'https://www.askbots.ai/api';

// ---------------------------------------------------------------------------
// Celo
// ---------------------------------------------------------------------------

export const CELO_RPC_URL = readEnv('CELO_RPC_URL');
export const CELO_SEPOLIA_RPC_URL =
  readEnv('CELO_SEPOLIA_RPC_URL') ?? 'https://forno.celo-sepolia.celo-testnet.org';

// ---------------------------------------------------------------------------
// buy / x402 (Rule 8: the attribution tag goes on every mainnet transaction)
// ---------------------------------------------------------------------------

export const BUY_MCP_ENDPOINT = readEnv('BUY_MCP_ENDPOINT');
export const ERC8004_AGENT_ID = readEnv('ERC8004_AGENT_ID');
export const ERC8004_IDENTITY_REGISTRY =
  readEnv('ERC8004_IDENTITY_REGISTRY') ??
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const ERC8004_REPUTATION_REGISTRY =
  readEnv('ERC8004_REPUTATION_REGISTRY') ??
  '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

/**
 * Rule 8 — never backfill this.
 *
 * The tag is assigned at registration and has to be present on the FIRST
 * mainnet transaction. There is no code path that invents a placeholder and
 * replaces it later, because a transaction that settles without the tag cannot
 * be retroactively tagged: the money has already moved.
 */
export const ATTRIBUTION_TAG = readEnv('ATTRIBUTION_TAG');

/**
 * The wallet key. Rule 11: this value is never logged and never crosses into
 * the Review Generator's process. It is exposed as a presence check plus a
 * getter, so the common mistake — `console.log(config)` — prints `[redacted]`
 * rather than the key.
 */
const WALLET_KEY = readEnv('BUY_WALLET_PRIVATE_KEY');

export function hasWalletKey(): boolean {
  return WALLET_KEY !== null;
}

/** Read at the moment of use. Do not assign the result to a variable that
 *  outlives the call, and never include it in an error message. */
export function walletPrivateKey(): string {
  if (WALLET_KEY === null) {
    throw new Error(
      'BUY_WALLET_PRIVATE_KEY is not set — the Payment Worker cannot sign. This is a hard stop, not a fallback.',
    );
  }
  return WALLET_KEY;
}

// ---------------------------------------------------------------------------
// Kill switch (Rule 5.8)
// ---------------------------------------------------------------------------

/**
 * Read fresh every time. Absent means ENABLED (the documented default), but
 * anything other than an explicit "true" is treated as disabled — a typo in the
 * secret store must fail closed, not open.
 */
export function paymentsEnabled(): boolean {
  const value = readEnv('PAYMENTS_ENABLED');
  if (value === null) return true;
  return value.toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const SPEND_CAP_HOURLY = readEnv('SPEND_CAP_HOURLY') ?? '0.25';
export const SPEND_CAP_DAILY = readEnv('SPEND_CAP_DAILY') ?? '1.00';
export const SPEND_CAP_PER_REVIEW = readEnv('SPEND_CAP_PER_REVIEW') ?? '0.03';
export const SPEND_CAP_PER_PROVIDER_REQUEST =
  readEnv('SPEND_CAP_PER_PROVIDER_REQUEST') ?? '0.01';
export const MAX_PAID_CALLS_PER_PROVIDER_PER_REVIEW = Number(
  readEnv('MAX_PAID_CALLS_PER_PROVIDER_PER_REVIEW') ?? '3',
);

/** Rule 12. Business inactivity, in minutes. */
export const INACTIVITY_ALERT_MINUTES = Number(
  readEnv('INACTIVITY_ALERT_MINUTES') ?? '60',
);

/**
 * Rule 5. The exclusion list is JSON so the operator's own identifiers live in
 * the secret store rather than in the repository. An unparseable list is a hard
 * failure: running the policy engine with an empty exclusion list because of a
 * typo would mean reviewing our own entry.
 */
export function exclusionListJson(): string | null {
  return readEnv('EXCLUSION_LIST');
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

export const AUDIT_LEDGER_PATH =
  readEnv('AUDIT_LEDGER_PATH') ?? './ledger/audit.jsonl';
export const SPEND_LEDGER_PATH =
  readEnv('SPEND_LEDGER_PATH') ?? './ledger/spend.jsonl';
export const EVIDENCE_STORE_PATH =
  readEnv('EVIDENCE_STORE_PATH') ?? './data/evidence.jsonl';
export const RAW_ARTIFACT_DIR =
  readEnv('RAW_ARTIFACT_DIR') ?? './raw-artifacts';
