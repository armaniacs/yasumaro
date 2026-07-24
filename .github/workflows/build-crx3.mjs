import fs from 'fs';
import crypto from 'crypto';

function encodeCbor(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) {
      if (value <= 23) return Buffer.from([value]);
      if (value <= 0xff) return Buffer.from([0x18, value]);
      if (value <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0x19; b.writeUInt16BE(value, 1); return b; }
      { const b = Buffer.alloc(5); b[0] = 0x1a; b.writeUInt32BE(value, 1); return b; }
    }
  }
  if (Buffer.isBuffer(value)) {
    const len = value.length;
    let buf;
    if (len <= 23) { buf = Buffer.alloc(1); buf[0] = 0x40 | len; }
    else if (len <= 0xff) { buf = Buffer.alloc(2); buf[0] = 0x58; buf[1] = len; }
    else if (len <= 0xffff) { buf = Buffer.alloc(3); buf[0] = 0x59; buf.writeUInt16BE(len, 1); }
    else { buf = Buffer.alloc(5); buf[0] = 0x5a; buf.writeUInt32BE(len, 1); }
    return Buffer.concat([buf, value]);
  }
  if (typeof value === 'string') {
    const encoded = Buffer.from(value, 'utf8');
    return encodeCbor(encoded);
  }
  if (Array.isArray(value)) {
    const items = value.map(v => encodeCbor(v));
    let header;
    if (items.length <= 23) { header = Buffer.alloc(1); header[0] = 0x80 | items.length; }
    else if (items.length <= 0xff) { header = Buffer.alloc(2); header[0] = 0x98; header[1] = items.length; }
    else { header = Buffer.alloc(3); header[0] = 0x99; header.writeUInt16BE(items.length, 1); }
    return Buffer.concat([header, ...items]);
  }
  throw new Error(`Unsupported type: ${typeof value}`);
}

function buildCrx3(zipPath, keyPath, outputPath) {
  const zipData = fs.readFileSync(zipPath);
  const keyPem = fs.readFileSync(keyPath, 'utf8');
  const privateKey = crypto.createPrivateKey(keyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  // Sign ZIP content with RSA-SHA256
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(zipData);
  const signature = sign.sign(privateKey);

  // CRX3 signed header: ["Cr24", pubkey_der, signature]
  const signedHeader = encodeCbor(["Cr24", pubKeyDer, signature]);

  // Build CRX3: magic | version(4) | header_len(4) | signed_header | zip
  const crxHeader = Buffer.alloc(12);
  crxHeader.write('Cr24', 0, 4, 'utf8');
  crxHeader.writeUInt32LE(3, 4);
  crxHeader.writeUInt32LE(signedHeader.length, 8);

  const crxData = Buffer.concat([crxHeader, signedHeader, zipData]);
  fs.writeFileSync(outputPath, crxData);
  console.log(`CRX3 created: ${outputPath} (${crxData.length} bytes)`);
  console.log(`Magic: ${crxData.slice(0,4).toString()}`);
  console.log(`Version: ${crxData.readUInt32LE(4)}`);
  console.log(`Header length: ${crxData.readUInt32LE(8)}`);
  console.log(`CBOR 3-item array: ${crxData[12] === 0x83 ? 'YES' : 'NO (format: ' + hex(crxData[12]) + ')'}`);
}

function hex(b) { return '0x' + b.toString(16).padStart(2,'0'); }

const [zipPath, keyPath, outputPath] = process.argv.slice(2);
if (!zipPath || !keyPath || !outputPath) {
  console.error('Usage: build-crx3.mjs <zip> <key.pem> <output.crx>');
  process.exit(1);
}
buildCrx3(zipPath, keyPath, outputPath);
