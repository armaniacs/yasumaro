# Security Review Guide

> Code review checklist, threat model, and security controls for the extension. CI/CD workflow security lives separately in [docs/CI_SECURITY_CHECKLIST.md](../docs/CI_SECURITY_CHECKLIST.md). Referenced from [AGENTS.md](../AGENTS.md).

## Review Checklist

- [ ] No hardcoded API keys or sensitive data
- [ ] Proper input validation for all external data (API responses, user input)
- [ ] Safe HTML content handling (sanitize if inserting into DOM)
- [ ] Appropriate permissions requested in manifest.json
- [ ] HTTPS used for all external API calls where possible
- [ ] Manifest V3 compliance (no background scripts, use service worker)
- [ ] Proper CSP adherence, no `eval()` or inline scripts
- [ ] Proper async handling in service worker
- [ ] Content script injection only where needed
- [ ] Consistent error handling with user notifications
- [ ] Use structured error codes (see [ERROR_CODES.md](ERROR_CODES.md))
- [ ] Proper cleanup of event listeners and intervals
- [ ] No memory leaks in long-running service worker
- [ ] Modular code organization and clear separation of concerns

## Threat Model Overview

| Threat Vector | Mitigation |
|---------------|-----------|
| Data Privacy | All browsing data processed locally |
| API Keys | Stored in Chrome local storage, never logged |
| Local REST API | Self-signed certificate support |
| Content Script Injection | Runs on all web pages with user consent |
| PKI/Certificate | HTTPS with protocol/port validation |
| Forged extension messages | No `externally_connectable`; `sender.id` match; `extension-only` registration |

### Who can invoke destructive DASHBOARD_SQLITE operations

Assessed 2026-09-16. Three layers stop an outside caller, in this order:

1. **No `externally_connectable` in the manifest.** Web pages and other extensions cannot reach `chrome.runtime.sendMessage` at all — the browser refuses to deliver.
2. **`checkSenderTrust` requires `sender.id === chrome.runtime.id`** (`src/background/handlers/senderTrust.ts`). The browser assigns that id; it cannot be forged.
3. **`DASHBOARD_SQLITE` is registered `extension-only`**, so even our own content scripts are rejected.

**The confirmToken is not one of these layers.** Anything that reaches the token check is already one of our own extension pages, and any such page may call `create_confirm_token` freely (it is in `TOKEN_EXEMPT_OPS`). The token's real contributions are parameter binding via `scopeHash`, single-use + 60s TTL, and defence in depth should layers 1–3 regress.

When reviewing, do not accept "this operation requires a confirmToken" as the argument that it is safe from outside callers. Point at layers 1–3 instead. Details and the full analysis: `src/messaging/sqliteOperationSecurity.ts` and PBI 2026-09-16-03.

**Out of scope:** XSS inside our own dashboard. A script running there can mint its own tokens, so the gate cannot help; this is a deliberate scope decision. Revisit it if the dashboard ever renders untrusted HTML.

## Security Controls

1. **API Key Protection**: Keys never logged or exposed in error messages
2. **URL Validation**: Proper validation before making requests (see `src/utils/urlUtils.ts`)
3. **Self-signed Certificates**: Optional support for HTTPS Obsidian with custom certs
4. **Permission Minimization**: Request only necessary permissions in manifest
5. **Content Security**: CSP headers, avoid XSS vulnerabilities

## Privacy Features

- **PII Sanitization** (`src/utils/piiSanitizer.ts`): Masks personally identifiable information
- **Privacy Consent** (`src/utils/storage/privacyConsent.ts`): User consent tracking for data collection
- **Privacy Pipeline** (`src/background/privacyPipeline.ts`): Privacy-preserving content processing
- All API keys encrypted in storage (PBKDF2 + AES-GCM)

## Regular Audits

- Review API endpoint configurations
- Validate content script permissions scope
- Check for data leakage in logs
- Verify secure storage of sensitive configurations
- Ensure proper HTTPS connections
