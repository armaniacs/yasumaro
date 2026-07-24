import fs from 'fs';
import crypto from 'crypto';

function buildCrx2(zipPath, keyPath, outputPath) {
  const zipData = fs.readFileSync(zipPath);
  const keyPem = fs.readFileSync(keyPath, 'utf8');
  const privateKey = crypto.createPrivateKey(keyPem);

  const publicKey = crypto.createPublicKey(privateKey);
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(zipData);
  const signature = sign.sign(privateKey);

  // CRX2 binary format:
  // [magic "Cr24" (4B)] [version 2 (4B LE)] [pubkey len (4B LE)] [sig len (4B LE)] [pubkey] [signature] [zip]
  const header = Buffer.alloc(16);
  header.write('Cr24', 0, 4, 'utf8');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(pubKeyDer.length, 8);
  header.writeUInt32LE(signature.length, 12);

  const crxData = Buffer.concat([header, pubKeyDer, signature, zipData]);
  fs.writeFileSync(outputPath, crxData);
  console.log(`CRX2 created: ${outputPath} (${crxData.length} bytes)`);
  console.log(`Magic: ${crxData.slice(0, 4).toString()}`);
  console.log(`Version: ${crxData.readUInt32LE(4)}`);
}

const [zipPath, keyPath, outputPath] = process.argv.slice(2);
if (!zipPath || !keyPath || !outputPath) {
  console.error('Usage: node build-crx2.mjs <zip> <key.pem> <output.crx>');
  process.exit(1);
}
buildCrx2(zipPath, keyPath, outputPath);
