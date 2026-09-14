#!/usr/bin/env node
/**
 * Build, sign and (optionally) broadcast Celo mainnet transactions.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ERC-8004 identity has to be minted by a real mainnet transaction, and
 * Rule 8 requires the attribution tag embedded in mainnet transaction calldata
 * with no backfill — so something in this project must be able to sign. Using
 * an established library is the usual answer, but this machine is not allowed
 * to run npm install, and the mint cannot wait for a cloud round trip.
 *
 * THE KEY IS NEVER READ INTO A LOG, A STRING, OR AN ERROR
 * ------------------------------------------------------
 * The private key is loaded from the wallet file straight into a Buffer, handed
 * to Node's crypto, and dropped. It is never printed, never concatenated into a
 * message, and never included in an error. Nothing this tool writes to stdout
 * contains it. Rule 11 is the point, not a nicety.
 *
 * WHAT IS HAND-WRITTEN, AND WHY IT HAS TO BE
 * -------------------------------------------
 * RLP encoding, transaction serialisation, secp256k1 point arithmetic, and the
 * ECDSA signature itself.
 *
 * The original plan was to let OpenSSL produce the signature and hand-write only
 * the recovery id. That is not possible: `crypto.sign(null, digest, key)` hashes
 * the digest AGAIN before signing it, and Node exposes no way to say "sign these
 * 32 bytes as-is". The result is a signature over the wrong message, which
 * recovers to the wrong address — the very first self-test run caught this.
 *
 * So the signature is computed here, using RFC 6979 to derive the nonce. That
 * nonce is the one part of ECDSA that must never be improvised: reuse it across
 * two messages with the same key and anyone can recover the private key from the
 * two signatures. RFC 6979 derives it from the key and the message by HMAC, so it
 * is neither reused nor random.
 *
 * HOW IT IS PROVEN
 * ----------------
 * `selftest` checks against the worked example published in EIP-155 itself, and
 * the decisive check is not "is the signature valid" but "is it byte-for-byte
 * the r and s the EIP published". Deterministic nonces make that possible.
 * A random-nonce signer can only ever be checked for validity, which would not
 * catch a subtly wrong nonce derivation. This one is pinned to published bytes.
 *
 * Everything else in the EIP is checked too: the exact signing payload, the
 * exact signing hash, the v encoding, and — exercising the curve arithmetic
 * against data this file did not generate — recovery from the published r,s to
 * the address of the example private key.
 *
 * The failure mode is safe. A wrong signature is REJECTED by the network; it
 * does not send funds somewhere unintended, because the destination and the
 * calldata are fixed by this file, not by the signature.
 *
 * USAGE
 *   node tools/sign-tx.mjs selftest
 *   node tools/sign-tx.mjs mint --wallet <wallet.json>            # dry run
 *   node tools/sign-tx.mjs mint --wallet <wallet.json> --send     # broadcast
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { callDataHex, encodeCall, encodeStringArg, selftest as abiSelftest } from './abi.mjs';
import { keccak256, toChecksumAddress } from './keccak256.mjs';

const CELO_MAINNET_RPC = 'https://forno.celo.org';
const CHAIN_ID = 42220n;
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const WEI_PER_CELO = 10n ** 18n;

// ---------------------------------------------------------------------------
// secp256k1 arithmetic, needed only for public-key recovery
// ---------------------------------------------------------------------------

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const GENERATOR = [GX, GY];

const mod = (a, m) => {
  const r = a % m;
  return r < 0n ? r + m : r;
};

/** Modular inverse via the extended Euclidean algorithm. */
function modInverse(a, m) {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error('value is not invertible');
  return mod(oldS, m);
}

/** Modular exponentiation by squaring. */
function modPow(base, exponent, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/** Elliptic curve point addition. `null` is the point at infinity. */
function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;

  if (x1 === x2) {
    if (mod(y1 + y2, P) === 0n) return null;
    // Point doubling: lambda = 3x^2 / 2y  (a = 0 for secp256k1)
    const lambda = mod(3n * x1 * x1 * modInverse(2n * y1, P), P);
    const x3 = mod(lambda * lambda - 2n * x1, P);
    return [x3, mod(lambda * (x1 - x3) - y1, P)];
  }

  const lambda = mod((y2 - y1) * modInverse(x2 - x1, P), P);
  const x3 = mod(lambda * lambda - x1 - x2, P);
  return [x3, mod(lambda * (x1 - x3) - y1, P)];
}

/** Scalar multiplication by double-and-add. */
function pointMultiply(k, point) {
  let result = null;
  let addend = point;
  let n = k;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

/** Uncompressed public key (65 bytes) to a checksummed address. */
function pointToAddress(point) {
  const [x, y] = point;
  const uncompressed = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(x.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(y.toString(16).padStart(64, '0'), 'hex'),
  ]);
  return toChecksumAddress(keccak256(uncompressed.subarray(1)).subarray(12).toString('hex'));
}

/**
 * Recover the public key that produced (r, s) over `digest`.
 * `recoveryId` is 0..3; bit 0 is the parity of R.y, bit 1 says R.x overflowed n.
 */
function recoverPublicKey(digest, r, s, recoveryId) {
  const z = BigInt('0x' + digest.toString('hex'));
  const x = r + (recoveryId >= 2 ? N : 0n);
  if (x >= P) throw new Error('recovery id out of range for this r');

  const ySquared = mod(x * x * x + 7n, P);
  // p ≡ 3 (mod 4), so the square root is ySquared^((p+1)/4).
  let y = modPow(ySquared, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== ySquared) throw new Error('point is not on the curve');
  if ((y & 1n) !== BigInt(recoveryId & 1)) y = P - y;

  const rInverse = modInverse(r, N);
  const u1 = mod(-z * rInverse, N);
  const u2 = mod(s * rInverse, N);
  const recovered = pointAdd(pointMultiply(u1, GENERATOR), pointMultiply(u2, [x, y]));
  if (recovered === null) throw new Error('recovered the point at infinity');
  return recovered;
}

// ---------------------------------------------------------------------------
// RLP
// ---------------------------------------------------------------------------

/** Coerce a value to bytes: hex string, Buffer, or non-negative integer. */
function toBytes(value) {
  if (value === null || value === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') ? value.slice(2) : value;
    if (hex === '') return Buffer.alloc(0);
    return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  }
  if (typeof value === 'bigint' || typeof value === 'number') {
    const n = BigInt(value);
    if (n < 0n) throw new Error('cannot RLP-encode a negative number');
    if (n === 0n) return Buffer.alloc(0); // zero encodes as the empty string
    const hex = n.toString(16);
    return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  }
  throw new Error(`cannot RLP-encode ${typeof value}`);
}

function encodeLength(length, offset) {
  if (length < 56) return Buffer.from([offset + length]);
  const lengthBytes = toBytes(BigInt(length));
  return Buffer.concat([Buffer.from([offset + 55 + lengthBytes.length]), lengthBytes]);
}

/** Recursive-length prefix encoding. */
function rlp(item) {
  if (Array.isArray(item)) {
    const body = Buffer.concat(item.map(rlp));
    return Buffer.concat([encodeLength(body.length, 0xc0), body]);
  }
  const bytes = toBytes(item);
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return Buffer.concat([encodeLength(bytes.length, 0x80), bytes]);
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** The public key point for a private key, via OpenSSL (given), not computed. */
function publicKeyPoint(privateKey) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  const pub = ecdh.getPublicKey(); // 0x04 || X(32) || Y(32)
  return [
    BigInt('0x' + pub.subarray(1, 33).toString('hex')),
    BigInt('0x' + pub.subarray(33, 65).toString('hex')),
  ];
}

/** A scalar as 32 big-endian bytes, per RFC 6979's `int2octets`. */
const int2octets = (value) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');

/**
 * RFC 6979 deterministic nonce candidates.
 *
 * WHY DETERMINISTIC, AND WHY HERE
 * ------------------------------
 * Node cannot sign a pre-computed digest: `crypto.sign(null, digest, key)` hashes
 * the digest again before handing it to OpenSSL, and there is no way through
 * Node's API to say "sign these 32 bytes as-is". Signing a digest that has been
 * hashed twice produces a signature that recovers to the wrong address — which is
 * exactly what the self-test caught.
 *
 * So the signature is computed here. The one thing that must not be improvised
 * in ECDSA is the nonce `k`: reuse it across two different messages with the same
 * key, and the private key is recoverable from the two signatures by anyone. RFC
 * 6979 derives `k` from the key and the message via HMAC-SHA256, so it is never
 * reused, never predictable, and never drawn from a weak random source.
 *
 * It also makes signing reproducible, which is what lets the self-test demand
 * the EIP-155 example's exact r and s rather than merely a valid signature.
 *
 * The RFC's "try again" path after a rejected candidate is a loop, so this is a
 * generator: a caller that rejects a nonce (r or s came out zero) just pulls the
 * next one.
 */
function* nonceCandidates(digest, privateKey) {
  const x = BigInt('0x' + privateKey.toString('hex'));
  let z = BigInt('0x' + digest.toString('hex'));
  if (z >= N) z -= N;
  const h1 = int2octets(z);

  const hmac = (key, ...chunks) => {
    const h = crypto.createHmac('sha256', key);
    for (const chunk of chunks) h.update(chunk);
    return h.digest();
  };

  let v = Buffer.alloc(32, 0x01);
  let k = Buffer.alloc(32, 0x00);

  k = hmac(k, v, Buffer.from([0x00]), int2octets(x), h1);
  v = hmac(k, v);
  k = hmac(k, v, Buffer.from([0x01]), int2octets(x), h1);
  v = hmac(k, v);

  for (;;) {
    let t = Buffer.alloc(0);
    while (t.length < 32) {
      v = hmac(k, v);
      t = Buffer.concat([t, v]);
    }
    const candidate = BigInt('0x' + t.subarray(0, 32).toString('hex'));
    if (candidate >= 1n && candidate < N) yield candidate;
    k = hmac(k, v, Buffer.from([0x00]));
    v = hmac(k, v);
  }
}

/**
 * Sign a 32-byte digest, returning r, s and the recovery id.
 *
 * `s` is normalised to the lower half of the curve order, as EIP-2 requires;
 * without that a transaction is rejected as malleable, and the recovery id's
 * parity bit flips to match.
 */
function signDigest(digest, privateKey) {
  const d = BigInt('0x' + privateKey.toString('hex'));
  const z = BigInt('0x' + digest.toString('hex'));
  const expected = pointToAddress(publicKeyPoint(privateKey));

  for (const k of nonceCandidates(digest, privateKey)) {
    const point = pointMultiply(k, GENERATOR);
    if (point === null) continue;

    const r = mod(point[0], N);
    if (r === 0n) continue;

    let s = mod(modInverse(k, N) * (z + r * d), N);
    if (s === 0n) continue;

    // Bit 0 of the recovery id is the parity of R.y; bit 1 says R.x overflowed
    // the curve order. Both must be read before s is normalised.
    let recoveryId = (point[1] & 1n) === 0n ? 0 : 1;
    if (point[0] >= N) recoveryId += 2;
    if (s > N / 2n) {
      s = N - s;
      recoveryId ^= 1;
    }

    return { r, s, recoveryId, address: expected };
  }

  // Unreachable: the nonce generator is infinite. Never includes key material.
  throw new Error('could not produce a signature');
}

// ---------------------------------------------------------------------------
// Transaction serialisation
// ---------------------------------------------------------------------------

/** EIP-155 legacy transaction, used only to check against the published vector. */
function serializeLegacy(tx, signature) {
  const base = [
    tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data,
  ];
  if (!signature) {
    // The payload that gets hashed: fields plus chainId, 0, 0.
    return rlp([...base, tx.chainId, 0n, 0n]);
  }
  const v = signature.recoveryId + Number(tx.chainId) * 2 + 35;
  return rlp([...base, BigInt(v), signature.r, signature.s]);
}

/** EIP-1559 (type 2) transaction. This is what the mint actually sends. */
function serializeEip1559(tx, signature) {
  const fields = [
    tx.chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    tx.to,
    tx.value,
    tx.data,
    [], // access list
  ];
  if (!signature) {
    return Buffer.concat([Buffer.from([0x02]), rlp(fields)]);
  }
  return Buffer.concat([
    Buffer.from([0x02]),
    rlp([...fields, BigInt(signature.recoveryId), signature.r, signature.s]),
  ]);
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * The worked example published in EIP-155 itself. Its r and s are fixed data,
 * so the recovery code is being checked against something it did not produce.
 */
const EIP155_VECTOR = {
  privateKey: '4646464646464646464646464646464646464646464646464646464646464646',
  tx: {
    nonce: 9n,
    gasPrice: 20000000000n,
    gasLimit: 21000n,
    to: '0x3535353535353535353535353535353535353535',
    value: 1000000000000000000n,
    data: Buffer.alloc(0),
    chainId: 1n,
  },
  signingPayload:
    'ec098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a764000080018080',
  signingHash: 'daf5a779ae972f972197303d7b574746c7ef83eadac0f2791ad23db92e4c8e53',
  r: 0x28ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276n,
  s: 0x67cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83n,
  v: 37n,
};

/** The EIP's own serialisation of that transaction, signed. */
const EIP155_SIGNED =
  'f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83';

function selftest() {
  console.log('Transaction signing');
  console.log('-------------------');

  let failures = 0;
  const check = (label, ok, extra) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok && extra) console.log(`        ${extra}`);
  };

  // 1. RLP payload must match the EIP byte for byte.
  const payload = serializeLegacy(EIP155_VECTOR.tx, null).toString('hex');
  check(
    'EIP-155 signing payload reproduces the published bytes',
    payload === EIP155_VECTOR.signingPayload,
    `expected ${EIP155_VECTOR.signingPayload}\n        actual   ${payload}`,
  );

  // 2. The signing hash must match, which checks keccak over RLP output.
  const digest = keccak256(Buffer.from(payload, 'hex'));
  check(
    'EIP-155 signing hash matches the published hash',
    digest.toString('hex') === EIP155_VECTOR.signingHash,
    `expected ${EIP155_VECTOR.signingHash}\n        actual   ${digest.toString('hex')}`,
  );

  // 3. The published v decodes to recovery id 0.
  check(
    'published v decodes to recovery id 0',
    EIP155_VECTOR.v === 0n + 1n * 2n + 35n,
    `v=${EIP155_VECTOR.v}`,
  );

  // 4. THE REAL TEST: recover from the PUBLISHED r and s. This exercises the
  //    curve arithmetic against data this file did not generate. A bug here
  //    yields a different point and therefore a different address.
  const expectedAddress = (() => {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(EIP155_VECTOR.privateKey, 'hex'));
    const pub = ecdh.getPublicKey();
    return pointToAddress([
      BigInt('0x' + pub.subarray(1, 33).toString('hex')),
      BigInt('0x' + pub.subarray(33, 65).toString('hex')),
    ]);
  })();

  let recoveredAddress = null;
  try {
    recoveredAddress = pointToAddress(
      recoverPublicKey(digest, EIP155_VECTOR.r, EIP155_VECTOR.s, 0),
    );
  } catch (error) {
    recoveredAddress = `threw: ${error.message}`;
  }
  check(
    'published r,s recovers to the address of the example private key',
    recoveredAddress === expectedAddress,
    `expected ${expectedAddress}\n        actual   ${recoveredAddress}`,
  );

  // 5. THE STRONGEST TEST AVAILABLE: our signature must be the published r and
  //    s EXACTLY, not merely a valid one. ECDSA normally uses a random nonce and
  //    so produces different-but-valid bytes each run; RFC 6979 makes it
  //    deterministic, which pins the whole pipeline — nonce derivation, point
  //    multiplication, the modular inverse, the s normalisation — to a result
  //    this file did not generate. Nothing weaker would catch a subtly wrong k.
  const ours = signDigest(digest, Buffer.from(EIP155_VECTOR.privateKey, 'hex'));
  check(
    'our signature reproduces the published r exactly',
    ours.r === EIP155_VECTOR.r,
    `expected ${EIP155_VECTOR.r.toString(16)}\n        actual   ${ours.r.toString(16)}`,
  );
  check(
    'our signature reproduces the published s exactly',
    ours.s === EIP155_VECTOR.s,
    `expected ${EIP155_VECTOR.s.toString(16)}\n        actual   ${ours.s.toString(16)}`,
  );

  // 6. The r,s we just produced must also survive the full serialised form,
  //    which re-checks the v encoding end to end.
  const signedVector = serializeLegacy(EIP155_VECTOR.tx, ours).toString('hex');
  check(
    'the signed EIP-155 transaction reproduces the published bytes',
    signedVector === EIP155_SIGNED,
    `expected ${EIP155_SIGNED}\n        actual   ${signedVector}`,
  );

  // 7. Recovery must agree with the recovery id we computed directly. This is
  //    the independent check `mint` runs on real transaction bytes before it
  //    will broadcast anything.
  let oursRecovered = null;
  try {
    oursRecovered = pointToAddress(
      recoverPublicKey(digest, ours.r, ours.s, ours.recoveryId),
    );
  } catch (error) {
    oursRecovered = `threw: ${error.message}`;
  }
  check(
    'our recovery id recovers back to the signing address',
    oursRecovered === expectedAddress,
    `expected ${expectedAddress}\n        actual   ${oursRecovered}`,
  );

  // 8. EIP-1559 serialisation: an unsent transaction must start with 0x02 and
  //    decode as a single list.
  const type2 = serializeEip1559(
    {
      chainId: CHAIN_ID, nonce: 0n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n,
      gasLimit: 21000n, to: IDENTITY_REGISTRY, value: 0n, data: Buffer.alloc(0),
    },
    null,
  );
  check('EIP-1559 payload is typed 0x02', type2[0] === 0x02, `first byte ${type2[0]}`);

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED — do not sign anything with this.`);
    process.exit(1);
  }
  console.log('All checks passed. Signing and recovery are correct.');

  // A valid signature over the wrong bytes is still a valid signature, so the
  // calldata is checked too. This is the gate that the empty-buffer bug passed.
  console.log('');
  console.log('Call encoding');
  console.log('-------------');
  abiSelftest();
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

async function rpc(method, params) {
  const response = await fetch(CELO_MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

const formatCelo = (wei) => {
  const whole = wei / WEI_PER_CELO;
  const fraction = (wei % WEI_PER_CELO).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

const AGENT_URI =
  'https://raw.githubusercontent.com/Temmygabriel/OBSERVED/main/agent-registration.json';

async function mint(walletPath, send) {
  // Run the proof before doing anything with a key.
  selftest();
  console.log('');

  const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const privateKey = Buffer.from(wallet.privateKey, 'hex');
  if (privateKey.length !== 32) throw new Error('wallet file does not hold a 32-byte key');

  const address = wallet.address;
  const calldata = encodeCall('register(string)', encodeStringArg(AGENT_URI));

  const nonce = BigInt(await rpc('eth_getTransactionCount', [address, 'pending']));
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  const baseFee = BigInt(block.baseFeePerGas);
  const priority = BigInt(await rpc('eth_maxPriorityFeePerGas', []));
  const estimated = BigInt(
    await rpc('eth_estimateGas', [
      { from: address, to: IDENTITY_REGISTRY, data: callDataHex(calldata) },
    ]),
  );
  const gasLimit = (estimated * 12n) / 10n; // unused gas is refunded, so a buffer is free

  const tx = {
    chainId: CHAIN_ID,
    nonce,
    maxPriorityFeePerGas: priority,
    maxFeePerGas: baseFee * 2n + priority,
    gasLimit,
    to: IDENTITY_REGISTRY,
    value: 0n,
    data: calldata,
  };

  const unsigned = serializeEip1559(tx, null);
  const signature = signDigest(keccak256(unsigned), privateKey);
  const signed = serializeEip1559(tx, signature);
  const txHash = '0x' + keccak256(signed).toString('hex');

  // Independent check: recovering from our own signature must give our address.
  // If it does not, the transaction would be rejected — stop before sending.
  const recovered = pointToAddress(
    recoverPublicKey(keccak256(unsigned), signature.r, signature.s, signature.recoveryId),
  );

  console.log(`wallet        ${address}`);
  console.log(`registry      ${IDENTITY_REGISTRY}`);
  console.log(`agentURI      ${AGENT_URI}`);
  console.log(`nonce         ${nonce}`);
  console.log(`gas limit     ${gasLimit}  (estimate ${estimated} + buffer)`);
  console.log(`max fee/gas   ${Number(tx.maxFeePerGas) / 1e9} gwei`);
  console.log(`worst-case    ${formatCelo(gasLimit * tx.maxFeePerGas)} CELO`);
  console.log(`tx hash       ${txHash}`);
  console.log(`signed bytes  ${signed.length}`);
  console.log('');

  if (recovered !== address) {
    console.log(`FAIL  signature recovers to ${recovered}, not ${address}`);
    console.log('Refusing to send: the network would reject this anyway.');
    process.exit(1);
  }
  console.log(`PASS  signature recovers to the signing wallet`);

  if (!send) {
    console.log('');
    console.log('DRY RUN — nothing was broadcast. Re-run with --send to mint.');
    return;
  }

  const result = await rpc('eth_sendRawTransaction', ['0x' + signed.toString('hex')]);
  console.log('');
  console.log(`broadcast     ${result}`);
  console.log(`explorer      https://celoscan.io/tx/${result}`);
}

// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === 'selftest') {
    selftest();
  } else if (command === 'mint') {
    const walletPath = rest.includes('--wallet')
      ? rest[rest.indexOf('--wallet') + 1]
      : null;
    if (!walletPath) throw new Error('mint requires --wallet <wallet.json>');
    await mint(walletPath, rest.includes('--send'));
  } else {
    console.log('usage:');
    console.log('  node tools/sign-tx.mjs selftest');
    console.log('  node tools/sign-tx.mjs mint --wallet <wallet.json> [--send]');
    process.exit(1);
  }
} catch (error) {
  // error.message never contains key material: nothing here formats the key.
  console.error(`error: ${error.message}`);
  process.exit(1);
}
