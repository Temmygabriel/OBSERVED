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
 * an address and a file path — nothing else. The key is written directly to
 * disk and is never formatted into a string, never logged, and never included
 * in an error. Running it with the wrong arguments cannot leak it, because with
 * the wrong arguments it does not generate one.
 *
 * The hashing and address derivation live in `keccak256.mjs` so that the same
 * verified implementation is shared with `celo-rpc.mjs` rather than copied.
 * `selftest` proves that implementation against published vectors before any
 * key is generated. Trust the test, not the comment.
 *
 * USAGE
 *   node tools/make-wallet.mjs selftest
 *       Verify keccak-256 and the address pipeline. Generates nothing.
 *
 *   node tools/make-wallet.mjs create <outfile.json> [--force]
 *       Generate a wallet, write it to <outfile.json>, print the address.
 *
 * The output file must live OUTSIDE this git repository. That is not a
 * preference: a file outside the repo cannot be committed by a careless
 * `git add .`, and a committed key cannot be un-committed in any way that
 * matters.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { addressFromPrivateKey, selftest } from './keccak256.mjs';

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

const [command, ...rest] = process.argv.slice(2);

if (command === 'selftest') {
  selftest();
} else if (command === 'create') {
  create(rest.find((arg) => !arg.startsWith('--')), rest.includes('--force'));
} else {
  console.log('usage:');
  console.log('  node tools/make-wallet.mjs selftest');
  console.log('  node tools/make-wallet.mjs create <outfile.json> [--force]');
  process.exit(1);
}
