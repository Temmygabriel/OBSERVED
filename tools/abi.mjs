/**
 * Minimal ABI encoding for the calls this project makes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every call here is a function selector followed by arguments, and the only
 * argument type used is `string`. That is about twenty lines of encoding, so no
 * ABI library is needed — which matters, because this machine is not allowed to
 * run npm installs.
 *
 * WHY IT IS ONE MODULE AND NOT TWO COPIES
 * ---------------------------------------
 * `celo-rpc.mjs` and `sign-tx.mjs` both need to build `register(string)` calldata.
 * They had separate copies, and the copies differed in a way nothing could see:
 * one kept the calldata as a hex string, the other converted it to bytes.
 *
 * `Buffer.from('0x...', 'hex')` does not throw on the `0x` prefix — it stops at
 * the first character it cannot decode as a hex PAIR and returns an EMPTY buffer.
 * So the signed transaction called `register(string)` with no argument, and the
 * chain rejected it. Correct bytes, wrong conversion, silently.
 *
 * `encodeCall` therefore returns a Buffer and is the only place in this repo that
 * turns calldata into bytes. The prefix is stripped exactly once, here.
 */

import { selector } from './keccak256.mjs';

/**
 * ABI-encode a single dynamic `string` argument as the sole head/tail pair.
 * Layout: offset(32) || length(32) || utf8 bytes right-padded to 32.
 * Returns hex WITHOUT a 0x prefix, so it can be concatenated onto a selector.
 */
export function encodeStringArg(value) {
  const bytes = Buffer.from(value, 'utf8');
  const head = Buffer.alloc(32);
  head.writeBigUInt64BE(32n, 24); // offset to the tail, in bytes
  const length = Buffer.alloc(32);
  length.writeBigUInt64BE(BigInt(bytes.length), 24);
  const body = Buffer.alloc(Math.ceil(bytes.length / 32) * 32);
  bytes.copy(body);
  return Buffer.concat([head, length, body]).toString('hex');
}

/**
 * Build call data: the selector for `signature`, then the given hex arguments.
 * Arguments are hex strings without a 0x prefix, as `encodeStringArg` returns.
 *
 * Returns a Buffer, never a hex string — see the note at the top of this file
 * about why that distinction silently cost a reverted transaction.
 */
export function encodeCall(signature, ...hexArgs) {
  const body = hexArgs.join('');
  if (body.length % 2 !== 0) {
    throw new Error('argument hex must have an even number of characters');
  }
  if (/[^0-9a-fA-F]/.test(body)) {
    throw new Error('argument hex contains a character that is not hex');
  }
  // selector() returns '0x' + 8 hex chars. Slice the prefix off HERE, once.
  return Buffer.from(selector(signature).slice(2) + body, 'hex');
}

/** Hex string (with 0x) for JSON-RPC, which wants calldata as text. */
export const callDataHex = (data) => '0x' + data.toString('hex');

/**
 * Structural check on `register(string)`. This does not prove the encoding is
 * right in the abstract — it proves the calldata is shaped the way the contract
 * will read it, which is precisely what the empty-buffer bug violated.
 */
export function selftest() {
  const uri = 'https://example.com/agent.json';
  const data = encodeCall('register(string)', encodeStringArg(uri));

  let failures = 0;
  const check = (label, ok, extra) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok && extra) console.log(`        ${extra}`);
  };

  const expectedLength = 4 + 32 + 32 + Math.ceil(Buffer.byteLength(uri) / 32) * 32;

  check(
    'calldata is not empty',
    data.length > 4,
    `got ${data.length} bytes — an empty buffer here means a reverted call`,
  );
  check(
    'calldata length is selector + offset + length + padded data',
    data.length === expectedLength,
    `expected ${expectedLength}, got ${data.length}`,
  );
  check(
    'starts with the register(string) selector',
    data.subarray(0, 4).toString('hex') === selector('register(string)').slice(2),
    data.subarray(0, 4).toString('hex'),
  );
  check(
    'head points the tail at offset 32',
    BigInt('0x' + data.subarray(4, 36).toString('hex')) === 32n,
  );
  check(
    'tail declares the utf8 byte length',
    BigInt('0x' + data.subarray(36, 68).toString('hex')) === BigInt(Buffer.byteLength(uri)),
  );
  check(
    'tail carries the uri',
    data.subarray(68, 68 + Buffer.byteLength(uri)).toString('utf8') === uri,
  );

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED — calldata built here cannot be trusted.`);
    process.exit(1);
  }
  console.log('All call-encoding checks passed.');
  return true;
}
