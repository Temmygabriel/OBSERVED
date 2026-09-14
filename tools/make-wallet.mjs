#!/usr/bin/env node
/**
 * Generate a Celo (EVM) wallet, writing the private key to a file and printing
 * ONLY the public address.
 *
 * WHY THIS EXISTS
 * ---------------
 * The operator needs one Celo mainnet wallet: its address is demanded at
 * registration (`agentWalletAddress` is `requiredAt: registration`), and it is
 * where the robot's funds live. Foundry's `cast wallet new` would do this, but
 * installing Foundry is a heavy download on a machine we have been told not to
 * load, and this repo already requires Node.
 *
 * WHY THE KEY IS NEVER PRINTED
 * ----------------------------
 * Rule 11: secrets do not touch logs or prompt context. This script's stdout is
 * an address and a file path — nothing else. The key is written directly to disk
 * and is never formatted into a string, never logged, and never included in an
 * error. Running it with the wrong arguments cannot leak it, because with the
 * wrong arguments it does not generate one.
 *
 * WHY KECCAK-256 IS HAND-ROLLED HERE
 * ----------------------------------
 * Node ships secp256k1 (via OpenSSL) so key generation and public-key derivation
 * are native and well-tested. It does NOT ship keccak-256 — `sha3-256` is a
 * different algorithm with different padding, and using it would silently
 * produce addresses belonging to nobody. So keccak-256 is implemented below in
 * about eighty lines, and `selftest` proves it against published vectors before
 * any key is generated. Trust the test, not the comment.
 *
 * USAGE
 *   node tools/make-wallet.mjs selftest
 *       Verify keccak-256 and the address pipeline. Generates nothing.
 *
 *   node tools/make-wallet.mjs create <outfile.json>
 *       Generate a wallet, write it to <outfile.json>, print the address.
 *       Refuses to overwrite an existing file unless --force is passed.
 *
 * The output file must live OUTSIDE this git repository. That is not a
 * preference: a file outside the repo cannot be committed by a careless
 * `git add .`, and Rule 11 has no undo either.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// keccak-256
// ---------------------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;

/** Round constants for the iota step, one per round of Keccak-f[1600]. */
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/**
 * Rho rotation offsets, indexed ROT[x][y] for the lane at state[x + 5y].
 * Transcribed from the Keccak reference; the test vectors below are what
 * actually confirm the transcription.
 */
const ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

/** Rotate a 64-bit lane left by `n` bits, staying inside 64 bits. */
function rotateLeft(lane, n) {
  const shift = BigInt(n % 64);
  if (shift === 0n) return lane & MASK64;
  return ((lane << shift) | (lane >> (64n - shift))) & MASK64;
}

/** One application of Keccak-f[1600] to the 25-lane state, in place. */
function keccakF(state) {
  for (let round = 0; round < 24; round += 1) {
    // theta
    const column = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      column[x] =
        state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    const delta = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      delta[x] = column[(x + 4) % 5] ^ rotateLeft(column[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ delta[x]) & MASK64;
      }
    }

    // rho and pi, fused: B[y][2x+3y] = rotl(A[x][y], r[x][y])
    const moved = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft(
          state[x + 5 * y],
          ROTATION_OFFSETS[x][y],
        );
      }
    }

    // chi
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const notNext = ~moved[((x + 1) % 5) + 5 * y] & MASK64;
        state[x + 5 * y] =
          (moved[x + 5 * y] ^ (notNext & moved[((x + 2) % 5) + 5 * y])) & MASK64;
      }
    }

    // iota
    state[0] = (state[0] ^ ROUND_CONSTANTS[round]) & MASK64;
  }
  return state;
}

/**
 * keccak-256 of a byte string.
 *
 * Rate is 1088 bits (136 bytes) and the padding is Keccak's 0x01 domain byte,
 * NOT SHA3-256's 0x06. That single byte is the entire difference between this
 * and `crypto.createHash('sha3-256')`.
 */
function keccak256(input) {
  const RATE = 136;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');

  // Pad: 0x01, then zeros, then 0x80 in the final byte of the final block.
  const blocks = Math.ceil((bytes.length + 1) / RATE) || 1;
  const padded = Buffer.alloc(blocks * RATE);
  bytes.copy(padded);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let lane = 0; lane < RATE / 8; lane += 1) {
      state[lane] ^= padded.readBigUInt64LE(offset + lane * 8);
    }
    keccakF(state);
  }

  const digest = Buffer.alloc(32);
  for (let lane = 0; lane < 4; lane += 1) {
    digest.writeBigUInt64LE(state[lane], lane * 8);
  }
  return digest;
}

// ---------------------------------------------------------------------------
// Address derivation
// ---------------------------------------------------------------------------

/**
 * EIP-55 mixed-case checksum. Not required for correctness — addresses are
 * case-insensitive — but a checksummed address is what explorers and wallets
 * show, and reproducing it exactly is a free extra check on keccak.
 */
function toChecksumAddress(lowercaseHex) {
  const bare = lowercaseHex.replace(/^0x/, '').toLowerCase();
  const hash = keccak256(Buffer.from(bare, 'ascii')).toString('hex');
  let out = '0x';
  for (let i = 0; i < bare.length; i += 1) {
    out += parseInt(hash[i], 16) >= 8 ? bare[i].toUpperCase() : bare[i];
  }
  return out;
}

/** Turn a 32-byte private key into a checksummed Celo/EVM address. */
function addressFromPrivateKey(privateKey) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  // Uncompressed: 0x04 || X(32) || Y(32). The address is the last 20 bytes of
  // keccak256 over X||Y — the 0x04 prefix is dropped.
  const publicKey = ecdh.getPublicKey();
  const hashed = keccak256(publicKey.subarray(1));
  return toChecksumAddress(hashed.subarray(12).toString('hex'));
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * Published vectors. If any of these fail the implementation is wrong and NO
 * key should be generated from it.
 *
 * The first two are the canonical Ethereum keccak-256 vectors (they differ from
 * SHA3-256 of the same input, which is exactly the trap this guards against).
 * The third exercises the whole pipeline — private key to public key to keccak
 * to truncated address — against a long-standing known pair.
 */
const KECCAK_VECTORS = [
  { input: '', expected: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' },
  { input: 'abc', expected: '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45' },
];

const ADDRESS_VECTOR = {
  privateKey:
    '0000000000000000000000000000000000000000000000000000000000000001',
  expected: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
};

function selftest() {
  let failures = 0;

  for (const vector of KECCAK_VECTORS) {
    const actual = keccak256(Buffer.from(vector.input, 'utf8')).toString('hex');
    const ok = actual === vector.expected;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  keccak256(${JSON.stringify(vector.input)})`,
    );
    if (!ok) {
      console.log(`        expected ${vector.expected}`);
      console.log(`        actual   ${actual}`);
    }
  }

  const derived = addressFromPrivateKey(
    Buffer.from(ADDRESS_VECTOR.privateKey, 'hex'),
  );
  const ok = derived === ADDRESS_VECTOR.expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  address for private key 0x...01`);
  if (!ok) {
    console.log(`        expected ${ADDRESS_VECTOR.expected}`);
    console.log(`        actual   ${derived}`);
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} vector(s) FAILED — do not generate a wallet.`);
    process.exit(1);
  }
  console.log('All vectors passed. keccak-256 and address derivation are correct.');
  return true;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function create(outfile, force) {
  if (typeof outfile !== 'string' || outfile.trim() === '') {
    console.error('create requires an output file path.');
    process.exit(1);
  }

  const resolved = path.resolve(outfile);

  if (fs.existsSync(resolved) && !force) {
    // Overwriting is how a key gets destroyed. Make it explicit, never implicit.
    console.error(`Refusing to overwrite existing file: ${resolved}`);
    console.error('Pass --force only if you are certain that key is worthless.');
    process.exit(1);
  }

  // Verify the maths before trusting it with a key.
  selftest();
  console.log('');

  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();

  // A private key with leading zero bytes is valid, and Node may return it
  // short. Left-pad so the stored value is always the full 32 bytes.
  const raw = ecdh.getPrivateKey();
  const privateKey = raw.length < 32
    ? Buffer.concat([Buffer.alloc(32 - raw.length), raw])
    : raw;

  if (privateKey.length !== 32) {
    console.error(`Unexpected private key length ${privateKey.length}; aborting.`);
    process.exit(1);
  }

  const address = addressFromPrivateKey(privateKey);

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(
    resolved,
    `${JSON.stringify(
      {
        address,
        privateKey: privateKey.toString('hex'),
        curve: 'secp256k1',
        network: 'celo-mainnet',
        chainId: 42220,
        createdAt: new Date().toISOString(),
        warning:
          'This is a live private key. Anyone holding it owns the wallet. ' +
          'It belongs in a deployment secret store, never in git, never in a ' +
          'log, never in a chat message.',
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  try {
    fs.chmodSync(resolved, 0o600);
  } catch {
    // Windows does not implement POSIX modes meaningfully. Not fatal.
  }

  // ONLY the address and the path leave this process.
  console.log(`address     ${address}`);
  console.log(`written to  ${resolved}`);
  console.log('');
  console.log('The private key was written to that file and was not printed.');
}

// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);

if (command === 'selftest') {
  selftest();
} else if (command === 'create') {
  const force = rest.includes('--force');
  const outfile = rest.find((arg) => !arg.startsWith('--'));
  create(outfile, force);
} else {
  console.log('usage:');
  console.log('  node tools/make-wallet.mjs selftest');
  console.log('  node tools/make-wallet.mjs create <outfile.json> [--force]');
  process.exit(1);
}
