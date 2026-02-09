# API Key Encryption Architecture Design

## Overview

This document describes the architecture for implementing API key encryption using Web Crypto API to address the security vulnerability identified in the pre-release review.

## Requirements

### Security Requirements
- Encrypt all API keys stored in `chrome.storage.local`
- Use AES-GCM encryption algorithm (authenticated encryption)
- Derive encryption key from user-provided master password using PBKDF2
- Migrate existing plaintext API keys to encrypted format automatically

### Functional Requirements
- Provide functions to encrypt and decrypt API keys
- Manage master password securely
- Handle encryption/decryption errors gracefully
- Maintain backward compatibility during migration

## Architecture Design

### Components

#### 1. Crypto Module (`src/utils/crypto.js`)

**Purpose**: Provide encryption and decryption utilities using Web Crypto API

**Key Functions**:
```javascript
// Derive encryption key from master password
async function deriveKey(password, salt)

// Encrypt plaintext using AES-GCM
async function encrypt(plaintext, key)

// Decrypt ciphertext using AES-GCM
async function decrypt(ciphertext, key)

// Generate random salt
function generateSalt()

// Generate random IV (Initialization Vector)
function generateIV()
```

**Implementation Details**:
- Use `crypto.subtle.pbkdf2()` for key derivation
- Use `crypto.subtle.encrypt()` with AES-GCM algorithm
- Use `crypto.subtle.decrypt()` with AES-GCM algorithm
- Key length: 256 bits
- PBKDF2 iterations: 100,000
- Salt length: 16 bytes
- IV length: 12 bytes (recommended for AES-GCM)

#### 2. Storage Module Modifications (`src/utils/storage.js`)

**Purpose**: Integrate encryption into API key storage operations

**Modifications**:
- Add `MASTER_PASSWORD` storage key
- Add `ENCRYPTION_SALT` storage key
- Modify `saveSettings()` to encrypt API keys before saving
- Modify `getSettings()` to decrypt API keys after loading
- Add migration function to encrypt existing plaintext keys

**New Functions**:
```javascript
// Save master password (hashed)
async function saveMasterPassword(password)

// Verify master password
async function verifyMasterPassword(password)

// Migrate existing plaintext API keys to encrypted format
async function migrateApiKeysToEncrypted()
```

#### 3. Master Password Management

**Storage**:
- Store hashed master password in `chrome.storage.local`
- Store encryption salt in `chrome.storage.local`
- Store derived key in memory only (session-based)

**Flow**:
1. User sets master password (first-time setup)
2. Hash password and store in `chrome.storage.local`
3. Generate salt and store in `chrome.storage.local`
4. Derive encryption key from password and salt
5. Use derived key for encryption/decryption operations

### Data Flow

#### Saving API Keys
```
User Input → Master Password Verification → Derive Key → Encrypt API Key → Save to chrome.storage.local
```

#### Loading API Keys
```
chrome.storage.local → Load Encrypted Keys → Derive Key → Decrypt API Keys → Return to Application
```

#### Migration Flow
```
Load Settings → Check if Keys are Encrypted → If Not: Derive Key → Encrypt Keys → Save Encrypted Keys
```

### Error Handling

#### Encryption Errors
- Log error with appropriate severity
- Return error message to user
- Do not save plaintext if encryption fails

#### Decryption Errors
- Log error with appropriate severity
- Return error message to user
- Prompt user to re-enter master password if key derivation fails

#### Migration Errors
- Log error with appropriate severity
- Skip migration for failed keys
- Continue with other keys

### Security Considerations

#### Key Management
- Never store derived encryption key in persistent storage
- Store only salt and hashed password
- Derive key on-demand from master password

#### Password Security
- Use PBKDF2 with high iteration count (100,000)
- Store only password hash (not plaintext)
- Use random salt for each installation

#### Encryption Security
- Use AES-GCM for authenticated encryption
- Use unique IV for each encryption operation
- Store IV alongside ciphertext

#### Migration Security
- Migrate keys only after successful password verification
- Delete plaintext keys after successful encryption
- Log migration events for audit

### Implementation Phases

#### Phase 1: Crypto Module
- Implement `src/utils/crypto.js`
- Add unit tests for encryption/decryption
- Test with various input sizes

#### Phase 2: Storage Integration
- Modify `src/utils/storage.js`
- Add master password management
- Implement encryption/decryption hooks

#### Phase 3: Migration
- Implement migration function
- Test migration with existing data
- Add rollback mechanism if needed

#### Phase 4: UI Integration
- Add master password setup UI
- Add password verification UI
- Update error messages

#### Phase 5: Testing
- Integration tests
- End-to-end tests
- Security audit

### Backward Compatibility

#### Migration Strategy
- Detect if API keys are encrypted (check for encryption marker)
- If not encrypted, trigger migration
- Migration runs once on first load after update

#### Fallback
- If decryption fails, prompt user to re-enter master password
- If master password is lost, user must re-enter API keys

### Testing Strategy

#### Unit Tests
- Test encryption/decryption with various inputs
- Test key derivation with different passwords
- Test error handling

#### Integration Tests
- Test full save/load cycle
- Test migration process
- Test error recovery

#### Security Tests
- Test that plaintext is never stored
- Test that keys are properly derived
- Test that IV is unique for each encryption

## File Structure

```
src/
├── utils/
│   ├── crypto.js (NEW)
│   ├── storage.js (MODIFIED)
│   └── __tests__/
│       ├── crypto.test.js (NEW)
│       └── storage.test.js (MODIFIED)
└── popup/
    └── passwordSetup.html (NEW)
```

## Dependencies

- Web Crypto API (built-in browser API)
- No external dependencies required

## Performance Considerations

- PBKDF2 key derivation is CPU-intensive (100,000 iterations)
- Cache derived key in memory during session
- Re-derive key only when master password changes

## Future Enhancements

- Support for biometric authentication (WebAuthn)
- Support for hardware security keys
- Support for password managers integration
- Support for multiple encryption profiles

## References

- [Web Crypto API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [AES-GCM - Wikipedia](https://en.wikipedia.org/wiki/Galois/Counter_Mode)
- [PBKDF2 - RFC 2898](https://tools.ietf.org/html/rfc2898)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)