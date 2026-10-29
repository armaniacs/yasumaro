# Security Policy

## Reporting a Vulnerability

We take the security of Yasumaro seriously. If you discover a security vulnerability, please report it responsibly.

**Do not** report security vulnerabilities through public GitHub Issues.

Instead, please report them via:

- **GitHub Security Advisory**: https://github.com/armaniacs/yasumaro/security/advisories/new
- **Email**: Open a [GitHub Security Advisory](https://github.com/armaniacs/yasumaro/security/advisories/new) for encrypted communication.

When reporting, please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if available)

We aim to acknowledge reports within 48 hours and provide a timeline for the fix.

## Scope

This security policy covers:

- The Yasumaro Chrome extension (Manifest V3)
- API key storage and encryption
- PII handling and sanitization
- Diagnostic log PII handling (see `dev-docs/SECURITY_REVIEW_GUIDE.md`)
- Content Security Policy
- Egress destinations: user-selected AI providers, user-configured Obsidian Local REST API, and the opt-in Gist sync feature (`api.github.com`, PAT-based) ― declared in `wxt.config.ts` host_permissions and derived from `src/utils/cspDomains.ts`; undeclared origins are blocked by the runtime CSP validator and browser declarations
- Egress policy: per-domain send policy (send allowed / record without summary / mask required) owned by `src/utils/storage/aiDomainPolicy.ts` and enforced in the privacy pipeline; the send audit ledger records the time, destination, character count, and policy verdict
- Webhook export (opt-in, off by default): a user-configured https destination receiving summary, tags, and URL only. Undeclared origins are blocked before any network access. PII masking and private exclusion are applied pre-send; page bodies are never transmitted
- Third-party dependency vulnerabilities

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 6.x     | :white_check_mark: |
| < 6.0   | :x:                |
