/**
 * keccak-256 and EVM address helpers.
 *
 * WHY THIS IS HAND-WRITTEN
 * ------------------------
 * Node ships secp256k1 through OpenSSL, but it does NOT ship keccak-256.
 * It ships `sha3-256`, which is a different algorithm: the two differ by a
 * single padding byte (0x01 for Keccak, 0x06 for SHA-3). Substituting one for
 * the other produces hashes and addresses that look entirely valid and belong
 * to nobody. That failure mode is silent and expensive, so the algorithm is
 * implemented here explicitly and `selftest()` proves it against published
 * vectors.
 *
 * Keccak is not only for addresses — it also produces EVM function selectors
 * (the first four bytes of keccak256 over a signature like `register(string)`),
 * which is how `tools/celo-rpc.mjs` builds calldata without an ABI library.
 *
 * Verified against:
 *   keccak256("")    = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
 *   keccak256("abc") = 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
 *   address(privkey 0x...01) = 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
 */

import crypto from 'node:crypto';

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
 * Rho rotation offsets, indexed ROTATION_OFFSETS[x][y] for the lane held at
 * state[x + 5y]. Transcribed from the Keccak reference; the test vectors are
 * what actually confirm the transcription, not this comment.
 */
const ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

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

/** keccak-256 of a byte string, as a 32-byte Buffer. */
export function keccak256(input) {
  const RATE = 136; // 1088-bit rate for a 256-bit output
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');

  const blocks = Math.ceil((bytes.length + 1) / RATE) || 1;
  const padded = Buffer.alloc(blocks * RATE);
  bytes.copy(padded);
  padded[bytes.length] ^= 0x01; // Keccak domain byte, NOT SHA-3's 0x06
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

/** keccak-256 as a 0x-free lowercase hex string. */
export function keccak256Hex(input) {
  return keccak256(input).toString('hex');
}

/**
 * EVM function selector: the first four bytes of keccak256 over the canonical
 * signature, e.g. selector('register(string)') === '0x' + first 8 hex chars.
 * This is what lets us build calldata with no ABI library installed.
 */
export function selector(signature) {
  return '0x' + keccak256(Buffer.from(signature, 'ascii')).toString('hex').slice(0, 8);
}

/**
 * EIP-55 mixed-case checksum. Addresses are case-insensitive on-chain, so this
 * is presentation — but it is also a free extra check on keccak, because the
 * published test address must reproduce exactly.
 */
export function toChecksumAddress(lowercaseHex) {
  const bare = lowercaseHex.replace(/^0x/, '').toLowerCase();
  const hash = keccak256(Buffer.from(bare, 'ascii')).toString('hex');
  let out = '0x';
  for (let i = 0; i < bare.length; i += 1) {
    out += parseInt(hash[i], 16) >= 8 ? bare[i].toUpperCase() : bare[i];
  }
  return out;
}

/** Turn a 32-byte private key into a checksummed Celo/EVM address. */
export function addressFromPrivateKey(privateKey) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  // Uncompressed public key is 0x04 || X(32) || Y(32); the address is the last
  // 20 bytes of keccak256 over X||Y, so the 0x04 prefix is dropped.
  const publicKey = ecdh.getPublicKey();
  return toChecksumAddress(keccak256(publicKey.subarray(1)).subarray(12).toString('hex'));
}

/**
 * Published vectors. If any fail, the implementation is wrong and nothing
 * should be derived from it.
 */
const VECTORS = [
  { input: '', expected: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' },
  { input: 'abc', expected: '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45' },
];

const ADDRESS_VECTOR = {
  privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
  expected: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
};

/** Verify the implementation. Returns true and prints results; exits on failure. */
export function selftest() {
  let failures = 0;

  for (const vector of VECTORS) {
    const actual = keccak256Hex(Buffer.from(vector.input, 'utf8'));
    const ok = actual === vector.expected;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  keccak256(${JSON.stringify(vector.input)})`);
    if (!ok) {
      console.log(`        expected ${vector.expected}`);
      console.log(`        actual   ${actual}`);
    }
  }

  const derived = addressFromPrivateKey(Buffer.from(ADDRESS_VECTOR.privateKey, 'hex'));
  const ok = derived === ADDRESS_VECTOR.expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  address for private key 0x...01`);
  if (!ok) {
    console.log(`        expected ${ADDRESS_VECTOR.expected}`);
    console.log(`        actual   ${derived}`);
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} vector(s) FAILED — do not derive anything from this.`);
    process.exit(1);
  }
  console.log('All vectors passed. keccak-256 and address derivation are correct.');
  return true;
}
