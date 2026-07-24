import fs from 'fs';
import crypto from 'crypto';

function buildCrx2(zipPath, keyPath, outputPath) {
  const zipData = fs.readFileSync(zipPath);
  const keyPem = fs.readFileSync(keyPath, 'utf8');
  const privateKey = crypto.createPrivateKey(keyPem);
  
  // Get the public key DER
  const publicKey = crypto.createPublicKey(privateKey);
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  
  // Sign ZIP with RSA-SHA256
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(zipData);
  const signature = sign.sign(privateKey);
  
  // CRX2 format:
  // Magic: "Cr24" (4 bytes)
  // Version: 2 (4 bytes, little-endian)
  // Public key length: 4 bytes (little-endian)
  // Signature length: 4 bytes (little-endian)
  // Public key: pubKeyDer.length bytes
  // Signature: signature.length bytes
  // ZIP content: zipData.length bytes
  
  const header = Buffer.alloc(16);
  header.write('Cr24', 0, 4, 'utf8');          // magic
  header.writeUInt32LE(2, 4);                    // version 2
  header.writeUInt32LE(pubKeyDer.length, 8);     // pubkey length
  header.writeUInt32LE(signature.length, 12);    // signature length
  
  const crxData = Buffer.concat([header, pubKeyDer, signature, zipData]);
  fs.writeFileSync(outputPath, crxData);
  console.log(`CRX2 created: ${outputPath} (${crxData.length} bytes)`);
  console.log(`Magic: ${crxData.slice(0,4).toString()}`);
  console.log(`Version: ${crxData.readUInt32LE(4)}`);
}

const [zipPath, keyPath, outputPath] = process.argv.slice(2);
if (!zipPath || !keyPath || !outputPath) { console.error('Usage'); process.exit(1); }
buildCrx2(zipPath, keyPath, outputPath);
