import fs from 'fs';
import crypto from 'crypto';

// Minimal protobuf varint + length-delimited field encoder (no external deps).
// Only what CRX3's CrxFileHeader/SignedData/AsymmetricKeyProof messages need.
// Ref: https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto

function encodeVarint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeLengthDelimitedField(fieldNumber, payload) {
  const tag = (fieldNumber << 3) | 2; // wire type 2: length-delimited
  return Buffer.concat([encodeVarint(tag), encodeVarint(payload.length), payload]);
}

function encodeSignedData(crxId) {
  // message SignedData { optional bytes crx_id = 1; }
  return encodeLengthDelimitedField(1, crxId);
}

function encodeAsymmetricKeyProof(publicKeyDer, signature) {
  // message AsymmetricKeyProof { optional bytes public_key = 1; optional bytes signature = 2; }
  return Buffer.concat([
    encodeLengthDelimitedField(1, publicKeyDer),
    encodeLengthDelimitedField(2, signature),
  ]);
}

function encodeCrxFileHeader(proofBuf) {
  // message CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; ... }
  return encodeLengthDelimitedField(2, proofBuf);
}

function buildCrx3(zipPath, keyPath, outputPath) {
  const zipData = fs.readFileSync(zipPath);
  const keyPem = fs.readFileSync(keyPath, 'utf8');
  const privateKey = crypto.createPrivateKey(keyPem);

  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  // crx_id = first 16 bytes of SHA256(public_key_der)
  const crxId = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedData = encodeSignedData(crxId);

  // Signed payload: "CRX3 SignedData" + len(signedData, 4B LE) + signedData + zip content
  const signatureContext = Buffer.from('CRX3 SignedData', 'utf8');
  const signedDataLenLE = Buffer.alloc(4);
  signedDataLenLE.writeUInt32LE(signedData.length, 0);

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureContext);
  sign.update(signedDataLenLE);
  sign.update(signedData);
  sign.update(zipData);
  const signature = sign.sign(privateKey);

  const proof = encodeAsymmetricKeyProof(publicKeyDer, signature);
  const header = encodeCrxFileHeader(proof);

  const magic = Buffer.from('Cr24', 'utf8');
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(header.length, 0);

  const crxData = Buffer.concat([magic, version, headerLen, header, zipData]);
  fs.writeFileSync(outputPath, crxData);
  console.log(`CRX3 created: ${outputPath} (${crxData.length} bytes)`);
  console.log(`Magic: ${crxData.subarray(0, 4).toString()}`);
  console.log(`Version: ${crxData.readUInt32LE(4)}`);
}

const [zipPath, keyPath, outputPath] = process.argv.slice(2);
if (!zipPath || !keyPath || !outputPath) {
  console.error('Usage: node build-crx3.mjs <zip> <key.pem> <output.crx>');
  process.exit(1);
}
buildCrx3(zipPath, keyPath, outputPath);
