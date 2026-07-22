# ADR: Response Size Limit Guardrail

**Date**: 2026-07-22
**Status**: Accepted
**Related**: VulnHunter Fix Batch (2026-07-21), PBI-03 (Reliability/Races/Resource Exhaustion)

## Context

VulnHunter security audit (2026-07-21) identified that `response.text()` calls throughout the codebase
lack size limit validation, creating potential for resource exhaustion attacks (CWE-400). An attacker
could serve an extremely large response body, causing the extension to consume excessive memory and
potentially crash the service worker.

Root cause analysis (5 Whys) revealed that while some API calls had ad-hoc size checks, there was no
consistent rule or pattern for enforcing size limits on HTTP responses. This led to the creation of
a custom ESLint rule to detect missing size limit checks.

## Decision

Establish the following 3-layer guardrail as a permanent rule:

### Layer 1: Automated Detection (lint rule)
- ESLint custom rule `local/require-response-size-limit` applies to all `src/**/*.ts` files
- This rule detects `response.text()` calls that lack a preceding Content-Length check or size limit guard
- The rule operates at `error` level and blocks CI on violations
- Detection patterns include:
  - `content-length` header checks
  - `contentLength` variable usage
  - `maxSize` / `MAX_SIZE` / `sizeLimit` constants
  - Numeric size comparisons (e.g., `5 * 1024 * 1024`)
  - `.length >` or `.byteLength <` comparisons

### Layer 2: Review Checklist
- `.github/pull_request_template.md` includes the following check item:
  - "fetch: All `response.text()` / `response.json()` calls have a preceding Content-Length or size limit check"
- All PRs must confirm this as part of security review

### Layer 3: Architecture Standard (this ADR)
- **Rule**: All HTTP response body consumption (`response.text()`, `response.json()`, `response.arrayBuffer()`, etc.)
  must be preceded by a size limit validation
- **Exceptions**: Cases where size validation is not required
  - Test files (`__tests__/` directory)
  - Mock files (`__mocks__/` directory)
  - Responses from trusted local sources (e.g., `chrome-extension://` URLs)
  - Responses where the size is inherently bounded (e.g., small configuration files)

## Size Limit Patterns

| Pattern | Example | Usage |
|---------|---------|-------|
| Content-Length header check | `if (contentLength > maxSize) throw` | Before `response.text()` |
| Constant size limit | `const maxSize = 5 * 1024 * 1024` | Define max acceptable size |
| Helper function | `validateResponseSize(response)` | Centralize size validation logic |

## Trade-offs

### Advantages
- Prevents resource exhaustion attacks via large response bodies
- Automated detection catches missing size checks at development time
- 3-layer approach ensures coverage even if one layer fails

### Disadvantages
- Current implementation uses token-based heuristic matching, which can produce false positives
  (e.g., comments containing "content-length") and false negatives (e.g., size checks in helper functions)
- Requires developers to add size checks before every `response.text()` call, adding boilerplate
- Rule may need maintenance as new response consumption patterns emerge

## Affected Components
- All `src/**/*.ts` files that make HTTP requests and consume response bodies
- ESLint configuration (`eslint.config.js`) — requires ongoing maintenance of the custom rule
- `src/privacy/privacy.ts` — example of a file that was updated to include size validation

## Future Improvements
- Refactor the lint rule to use AST-based statement inspection instead of token-based matching
  to reduce false positives and improve detection of helper function patterns
- Introduce a shared utility function `validateResponseSize(response, maxSize)` to centralize
  size validation logic and make it easier for the lint rule to detect
- Consider adding runtime size limits in addition to compile-time checks

## Related ADRs
- [Markdown Output Sanitization Guardrail](2026-07-22-markdown-output-sanitization-guardrail.md) — companion guardrail for XSS prevention
