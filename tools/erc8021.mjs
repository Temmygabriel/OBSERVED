/**
 * ERC-8021 transaction attribution suffixes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Rule 8 requires an attribution tag in the calldata of every mainnet
 * transaction, and the live hackathon doc is blunt about the consequence of
 * getting it wrong: *"There is no way to tag a transaction after the fact and no
 * way to backfill."* A wiring mistake costs one transaction if it is caught
 * early and the whole event if it is caught late.
 *
 * The official SDK is `@celo/attribution-tags`, and this machine is not allowed
 * to run npm installs. The format is small enough to implement directly, and
 * implementing it directly means it can be checked against the ERC's own
 * published test vector rather than trusted.
 *
 * THE FORMAT (ERC-8021, schema 0)
 * -------------------------------
 * Appended to the end of calldata, and parsed BACKWARDS from the end:
 *
 *     [codes:N][codesLength:1][schemaId:1][marker:16]
 *
 *   - `codes`       the ASCII codes, comma-delimited when there is more than one
 *   - `codesLength` the byte length of `codes`, delimiters INCLUDED
 *   - `schemaId`    0x00 for schema 0, the chain's canonical code registry
 *   - `marker`      the 16 bytes 0x8021 repeated, which is how a suffix is found
 *
 * Parsing backwards is what makes detection possible without knowing how long
 * the original calldata was — and it is also why a suffix never changes what a
 * contract does: the ABI decoder stops at the end of the arguments it expects
 * and ignores whatever follows.
 *
 * Published vector, from the ERC itself:
 *   0xdddddddd62617365617070070080218021802180218021802180218021
 *   txData 0xdddddddd + codes ["baseapp"] + schemaId 0
 *
 * CELO'S ONE ADDITIONAL RULE
 * --------------------------
 * Celo's `toDataSuffix` accepts only `[a-z0-9_]`, 1 to 32 bytes. That is
 * stricter than the ERC, which only reserves the comma. Matching Celo's rule
 * means a code this module accepts is one Celo's decoder will also accept.
 */

const MARKER = Buffer.from('80218021802180218021802180218021', 'hex');
const SCHEMA_ID = 0x00;
const CODE_PATTERN = /^[a-z0-9_]{1,32}$/;

/** Parse a 0x-prefixed or bare hex string into a Buffer. */
function hexToBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error('hex string has an odd number of characters');
  if (/[^0-9a-fA-F]/.test(hex)) throw new Error('string contains a character that is not hex');
  return Buffer.from(hex, 'hex');
}

/**
 * Encode codes into a suffix. Accepts one code or an array; each is validated
 * against Celo's rule so a suffix this produces is one Celo's decoder accepts.
 */
export function toDataSuffix(codes) {
  const list = typeof codes === 'string' ? [codes] : codes;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('toDataSuffix needs at least one code');
  }
  for (const code of list) {
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      // The code is a public identifier, not a secret, so naming it is safe and
      // makes a typo obvious. Nothing else about it is sensitive.
      throw new Error(
        `invalid attribution code ${JSON.stringify(code)}: ` +
          'expected 1-32 characters from [a-z0-9_]',
      );
    }
  }

  const codesBytes = Buffer.from(list.join(','), 'ascii');
  if (codesBytes.length > 255) {
    throw new Error('codes exceed the single-byte length field');
  }

  return Buffer.concat([
    codesBytes,
    Buffer.from([codesBytes.length, SCHEMA_ID]),
    MARKER,
  ]);
}

/**
 * Decode a suffix from the end of calldata.
 *
 * Returns `{ codes, schemaId, txData }` or `null`. Returning null rather than
 * throwing is deliberate: most transactions have no suffix, and that is not an
 * error. A tag that is ABSENT and a tag that is MALFORMED are different facts,
 * and only the caller knows which one matters — so `codes` is only populated
 * when the marker is genuinely present.
 *
 * An unrecognised schemaId terminates parsing, as the ERC requires, rather than
 * guessing at a layout this code does not know.
 */
export function fromDataSuffix(data) {
  const bytes = hexToBuffer(data);
  if (bytes.length < MARKER.length + 2) return null;

  const markerAt = bytes.length - MARKER.length;
  if (!bytes.subarray(markerAt).equals(MARKER)) return null;

  const schemaId = bytes[markerAt - 1];
  if (schemaId !== SCHEMA_ID) return null;

  const codesLength = bytes[markerAt - 2];
  const codesStart = markerAt - 2 - codesLength;
  if (codesStart < 0) return null;

  const codesText = bytes.subarray(codesStart, markerAt - 2).toString('ascii');
  return {
    codes: codesText.split(','),
    schemaId,
    txData: '0x' + bytes.subarray(0, codesStart).toString('hex'),
  };
}

/** The bytes a tagged transaction should carry, given its original calldata. */
export function appendSuffix(calldata, codes) {
  return Buffer.concat([hexToBuffer(calldata ?? '0x'), toDataSuffix(codes)]);
}

// ---------------------------------------------------------------------------

/** The vector published in ERC-8021. */
const VECTOR_CALLDATA =
  '0xdddddddd62617365617070070080218021802180218021802180218021';

export function selftest() {
  let failures = 0;
  const check = (label, ok, extra) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok && extra) console.log(`        ${extra}`);
  };

  // 1. The published vector, encoded. This is the check that matters: the ERC
  //    states these exact bytes, so agreement is not a matter of opinion.
  //    The vector includes the calldata the suffix was appended to, so the
  //    comparison is end-to-end rather than on the suffix in isolation.
  const tagged = appendSuffix('0xdddddddd', ['baseapp']);
  check(
    'encodes the ERC-8021 published vector',
    '0x' + tagged.toString('hex') === VECTOR_CALLDATA,
    `expected ${VECTOR_CALLDATA}\n        actual   0x${tagged.toString('hex')}`,
  );

  // 2. And decodes back to the txData the ERC names.
  const decoded = fromDataSuffix(VECTOR_CALLDATA);
  check(
    'decodes the published vector to codes ["baseapp"] and txData 0xdddddddd',
    decoded !== null &&
      decoded.txData === '0xdddddddd' &&
      decoded.schemaId === 0 &&
      decoded.codes.join(',') === 'baseapp',
    `got ${JSON.stringify(decoded)}`,
  );

  // 3. Multiple codes, comma-delimited, with the comma counted in the length.
  //    "baseapp,morpho" is 14 bytes, so the length byte must be 0x0e.
  const multi = toDataSuffix(['baseapp', 'morpho']).toString('hex');
  check(
    'counts the delimiter in the length byte for multiple codes',
    multi.startsWith('626173656170702c6d6f7270686f0e00'),
    `got ${multi.slice(0, 32)}`,
  );

  // 4. Celo's code format survives a round trip, since that is what will be used.
  const celoCode = 'celo_b7k3p9da1234';
  check(
    'round-trips a Celo-format code',
    fromDataSuffix(appendSuffix('0xdeadbeef', [celoCode]))?.codes.join(',') === celoCode,
  );

  // 5. A suffix must never damage the calldata it is appended to.
  const original = '0x095ea7b3000000000000000000000000deadbeef';
  check(
    'preserves the original calldata byte for byte',
    fromDataSuffix(appendSuffix(original, ['celo_abc']))?.txData === original,
  );

  // 6. Untagged calldata is null, not an exception. An absent tag is normal.
  check('returns null for untagged calldata', fromDataSuffix(original) === null);
  check('returns null for empty calldata', fromDataSuffix('0x') === null);

  // 7. A corrupted marker must not be read as a tag. Return null rather than
  //    reporting codes recovered from bytes that are not a suffix at all.
  const corrupted = VECTOR_CALLDATA.slice(0, -2) + 'ff';
  check('returns null when the marker is corrupted', fromDataSuffix(corrupted) === null);

  // 8. Codes Celo would reject must be rejected here too, so a suffix this
  //    module produces is one Celo's own decoder accepts.
  const bad = ['UPPER', '', 'has space', 'has-comma', 'a'.repeat(33)];
  let rejected = 0;
  for (const code of bad) {
    try {
      toDataSuffix([code]);
    } catch {
      rejected += 1;
    }
  }
  check(
    'rejects codes outside Celo\'s [a-z0-9_]{1,32} rule',
    rejected === bad.length,
    `only ${rejected} of ${bad.length} were rejected`,
  );

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED — do not tag a transaction with this.`);
    process.exit(1);
  }
  console.log('All ERC-8021 checks passed.');
  return true;
}

// Allow running this file directly for the self-test alone.
if (process.argv[1] && process.argv[1].endsWith('erc8021.mjs')) {
  selftest();
}
