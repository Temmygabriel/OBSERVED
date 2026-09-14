#!/usr/bin/env node
/**
 * Minimal Celo JSON-RPC helper.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two jobs, both of which would otherwise need a package installed — and this
 * machine is not allowed to run heavy npm installs.
 *
 *   1. Ask the chain what a transaction will actually COST before anyone spends
 *      anything. `eth_estimateGas` needs correctly ABI-encoded calldata; with
 *      the verified keccak in `keccak256.mjs` we can build a function selector
 *      and encode a single string argument in about thirty lines, so no ABI
 *      library is required.
 *
 *   2. Read balances, so "did the transfer arrive?" is answered by the chain
 *      rather than by assumption.
 *
 * NO PRIVATE KEY IS USED OR NEEDED HERE. Everything is a read or an estimate:
 * `eth_estimateGas` simulates against current state without signing anything.
 * Estimating has no side effects beyond the RPC call itself.
 *
 * USAGE
 *   node tools/celo-rpc.mjs selftest
 *       Verify selectors against famous published ones.
 *
 *   node tools/celo-rpc.mjs selector "register(string)"
 *
 *   node tools/celo-rpc.mjs balance <address>
 *
 *   node tools/celo-rpc.mjs estimate-register <fromAddress> <agentURI>
 *       Simulate `register(string agentURI)` on the ERC-8004 identity registry
 *       and report gas, gas price, and total cost in CELO.
 */

import process from 'node:process';
import { selector, selftest } from './keccak256.mjs';

const CELO_MAINNET_RPC = 'https://forno.celo.org';
const CHAIN_ID = 42220;

/** The ERC-8004 Identity Registry on Celo mainnet (a proxy; see docs). */
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const WEI_PER_CELO = 10n ** 18n;

async function rpc(method, params) {
  const response = await fetch(CELO_MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

/** Format wei as a CELO decimal string without floating point. */
function formatCelo(wei) {
  const whole = wei / WEI_PER_CELO;
  const fraction = (wei % WEI_PER_CELO).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * ABI-encode a single dynamic `string` argument, as the sole head/tail pair.
 * Layout: offset(32) || length(32) || utf8 bytes right-padded to 32.
 */
function encodeStringArg(value) {
  const bytes = Buffer.from(value, 'utf8');
  const paddedLength = Math.ceil(bytes.length / 32) * 32;
  const head = Buffer.alloc(32);
  head.writeBigUInt64BE(32n, 24); // offset to the tail == 32
  const length = Buffer.alloc(32);
  length.writeBigUInt64BE(BigInt(bytes.length), 24);
  const body = Buffer.alloc(paddedLength);
  bytes.copy(body);
  return Buffer.concat([head, length, body]).toString('hex');
}

// ---------------------------------------------------------------------------

async function balance(address) {
  const hex = await rpc('eth_getBalance', [address, 'latest']);
  const wei = BigInt(hex);
  console.log(`address  ${address}`);
  console.log(`balance  ${formatCelo(wei)} CELO`);
  console.log(`wei      ${wei}`);
  return wei;
}

async function estimateRegister(from, agentURI) {
  const data = selector('register(string)') + encodeStringArg(agentURI);
  const gasHex = await rpc('eth_estimateGas', [
    { from, to: IDENTITY_REGISTRY, data },
  ]);
  const gas = BigInt(gasHex);
  const gasPrice = BigInt(await rpc('eth_gasPrice', []));
  const cost = gas * gasPrice;

  console.log(`registry     ${IDENTITY_REGISTRY}`);
  console.log(`from         ${from}`);
  console.log(`uri          ${agentURI}  (${Buffer.byteLength(agentURI)} bytes)`);
  console.log(`calldata     ${data.length / 2} bytes`);
  console.log(`gas estimate ${gas}`);
  console.log(`gas price    ${gasPrice} wei`);
  console.log(`cost         ${formatCelo(cost)} CELO   (${cost} wei)`);

  try {
    const held = BigInt(await rpc('eth_getBalance', [from, 'latest']));
    console.log(`balance      ${formatCelo(held)} CELO`);
    console.log(`sufficient   ${held >= cost ? 'YES' : 'NO — top up needed'}`);
  } catch {
    // Balance lookup failing should not hide the estimate.
  }
}

function selectorSelftest() {
  // Famous selectors with published values. If these fail, the selector
  // derivation (and therefore every calldata this tool builds) is wrong.
  const known = [
    { signature: 'transfer(address,uint256)', expected: '0xa9059cbb' },
    { signature: 'balanceOf(address)', expected: '0x70a08231' },
    { signature: 'approve(address,uint256)', expected: '0x095ea7b3' },
  ];

  let failures = 0;
  for (const item of known) {
    const actual = selector(item.signature);
    const ok = actual === item.expected;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  selector(${item.signature}) = ${actual}`);
    if (!ok) console.log(`        expected ${item.expected}`);
  }

  console.log('');
  console.log(`selector(register(string)) = ${selector('register(string)')}`);
  console.log(`selector(register())       = ${selector('register()')}`);
  console.log(`selector(setAgentURI(uint256,string)) = ${selector('setAgentURI(uint256,string)')}`);
  console.log('');

  if (failures > 0) {
    console.log(`${failures} selector vector(s) FAILED.`);
    process.exit(1);
  }
  console.log('All selector vectors passed.');
}

// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === 'selftest') {
    selftest();
    console.log('');
    selectorSelftest();
  } else if (command === 'selector') {
    if (!rest[0]) throw new Error('selector requires a signature');
    console.log(selector(rest[0]));
  } else if (command === 'balance') {
    if (!rest[0]) throw new Error('balance requires an address');
    await balance(rest[0]);
  } else if (command === 'estimate-register') {
    if (!rest[0] || !rest[1]) {
      throw new Error('estimate-register requires <fromAddress> <agentURI>');
    }
    await estimateRegister(rest[0], rest[1]);
  } else {
    console.log('usage:');
    console.log('  node tools/celo-rpc.mjs selftest');
    console.log('  node tools/celo-rpc.mjs selector "<signature>"');
    console.log('  node tools/celo-rpc.mjs balance <address>');
    console.log('  node tools/celo-rpc.mjs estimate-register <fromAddress> <agentURI>');
    process.exit(1);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
