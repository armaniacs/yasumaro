/**
 * build-crx3.test.ts
 * Pins the CRX3 signature layout produced by scripts/build-crx3.mjs.
 * The Web Store verifies the signature with Chromium's crx_verifier, so the signed
 * payload must be byte-exact: "CRX3 SignedData\0" + LE32(len) + signed_header_data + zip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../build-crx3.mjs');
const ZIP_BODY = Buffer.from('PK\u0003\u0004 not a real zip, signature does not care');

interface ParsedCrx {
  signedHeaderData: Buffer;
  proofPublicKey: Buffer;
  proofSignature: Buffer;
  zip: Buffer;
}

function readVarint(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    const byte = buf[i++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: i };
    shift += 7;
  }
}

function readFields(buf: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  let i = 0;
  while (i < buf.length) {
    const tag = readVarint(buf, i);
    const len = readVarint(buf, tag.next);
    out.set(tag.value >> 3, buf.subarray(len.next, len.next + len.value));
    i = len.next + len.value;
  }
  return out;
}

function parseCrx(crx: Buffer): ParsedCrx {
  const headerLen = crx.readUInt32LE(8);
  const header = readFields(crx.subarray(12, 12 + headerLen));
  const proof = readFields(header.get(2) as Buffer);
  return {
    signedHeaderData: header.get(10000) as Buffer,
    proofPublicKey: proof.get(1) as Buffer,
    proofSignature: proof.get(2) as Buffer,
    zip: crx.subarray(12 + headerLen),
  };
}

function verify(parsed: ParsedCrx, context: Buffer): boolean {
  const lenLE = Buffer.alloc(4);
  lenLE.writeUInt32LE(parsed.signedHeaderData.length, 0);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(context);
  verifier.update(lenLE);
  verifier.update(parsed.signedHeaderData);
  verifier.update(parsed.zip);
  const publicKey = createPublicKey({ key: parsed.proofPublicKey, format: 'der', type: 'spki' });
  return verifier.verify(publicKey, parsed.proofSignature);
}

describe('build-crx3', () => {
  let dir: string;
  let parsed: ParsedCrx;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-crx3-'));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(join(dir, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    writeFileSync(join(dir, 'in.zip'), ZIP_BODY);
    execFileSync('node', [SCRIPT, join(dir, 'in.zip'), join(dir, 'key.pem'), join(dir, 'out.crx')], {
      stdio: 'pipe',
    });
    parsed = parseCrx(readFileSync(join(dir, 'out.crx')));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('signature', () => {
    it('verifies against the context string that includes the NUL terminator', () => {
      expect(verify(parsed, Buffer.from('CRX3 SignedData\0', 'utf8'))).toBe(true);
    });

    it('does not verify against the context string without the NUL terminator', () => {
      expect(verify(parsed, Buffer.from('CRX3 SignedData', 'utf8'))).toBe(false);
    });
  });

  describe('header', () => {
    it('keeps the zip payload byte-identical after the header', () => {
      expect(parsed.zip.equals(ZIP_BODY)).toBe(true);
    });

    it('sets crx_id to the first 16 bytes of the SHA-256 of the signing public key', () => {
      const crxId = readFields(parsed.signedHeaderData).get(1) as Buffer;
      const expected = createHash('sha256').update(parsed.proofPublicKey).digest().subarray(0, 16);
      expect(crxId.equals(expected)).toBe(true);
    });
  });
});
