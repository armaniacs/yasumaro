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

## Security Controls

1. **API Key Protection**: Keys never logged or exposed in error messages
2. **URL Validation**: Proper validation before making requests (see `src/utils/urlUtils.ts`)
3. **Self-signed Certificates**: Optional support for HTTPS Obsidian with custom certs
4. **Permission Minimization**: Request only necessary permissions in manifest
5. **Content Security**: CSP headers, avoid XSS vulnerabilities

## Privacy Features

- **PII Sanitization** (`src/utils/piiSanitizer.ts`): Masks personally identifiable information
- **Privacy Consent** (`src/popup/privacyConsent.ts`): User consent tracking for data collection
- **Privacy Pipeline** (`src/background/privacyPipeline.ts`): Privacy-preserving content processing
- All API keys encrypted in storage (PBKDF2 + AES-GCM)

## Regular Audits

- Review API endpoint configurations
- Validate content script permissions scope
- Check for data leakage in logs
- Verify secure storage of sensitive configurations
- Ensure proper HTTPS connections
