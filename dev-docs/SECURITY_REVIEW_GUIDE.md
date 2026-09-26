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
| SSRF via user-supplied URL | Per-entry-point URL guard (`src/utils/ssrfGuard.ts`); **DNS rebinding remains** — see below |
| Forged extension messages | No `externally_connectable`; `sender.id` match; `extension-only` registration |

### Who can invoke destructive DASHBOARD_SQLITE operations

Assessed 2026-09-16. Three layers stop an outside caller, in this order:

1. **No `externally_connectable` in the manifest.** Web pages and other extensions cannot reach `chrome.runtime.sendMessage` at all — the browser refuses to deliver.
2. **`checkSenderTrust` requires `sender.id === chrome.runtime.id`** (`src/background/handlers/senderTrust.ts`). The browser assigns that id; it cannot be forged.
3. **`DASHBOARD_SQLITE` is registered `extension-only`**, so even our own content scripts are rejected.

**The confirmToken is not one of these layers.** Anything that reaches the token check is already one of our own extension pages, and any such page may call `create_confirm_token` freely (it is in `TOKEN_EXEMPT_OPS`). The token's real contributions are parameter binding via `scopeHash`, single-use + 60s TTL, and defence in depth should layers 1–3 regress.

When reviewing, do not accept "this operation requires a confirmToken" as the argument that it is safe from outside callers. Point at layers 1–3 instead. Details and the full analysis: `src/messaging/sqliteOperationSecurity.ts` and PBI 2026-09-16-03.

**Out of scope:** XSS inside our own dashboard. A script running there can mint its own tokens, so the gate cannot help; this is a deliberate scope decision. Revisit it if the dashboard ever renders untrusted HTML.

### SSRF guard: what it checks, and what it cannot check

The guard is `src/utils/ssrfGuard.ts`. It is the SSRF threat model's positive document, and the
**residual risk below is part of that model, not an open bug.**

#### What the guard inspects

- URL syntax, and the protocol allowlist (`https:`, `http:` only).
- IP literals — IPv4 and IPv6, via `normalizeIpHostname` (brackets stripped) and `isPrivateIpAddress`.
- `localhost` by name, and private / link-local / ULA ranges.
- The port, where the entry point constrains it: `ALLOWED_LOCALHOST_PORTS` is
  `{27123, 27124, 11434, 1234}`.
- Redirect targets, **when the entry point asks for it** — see the entry-point table.

Three entry-point validators exist: `validateUrl()` (the general form, with `requireValidProtocol`
and `blockLocalhost` options), `validateUrlForFilterImport()`, and `validateUrlForAIRequests()`
(which additionally permits localhost on an allowed port, for local AI providers).

#### The four entry points

| Entry point | Validator | Redirect handling |
|---|---|---|
| Filter-list import (`FETCH_URL`, `extension-only`) | `validateUrlForFilterImport` | `redirect: 'error'` — any redirect aborts. Plus a `response.redirected` re-check. |
| AI provider base URL | `validateUrlForAIRequests` + registry allowlist | n/a — the URL is a configured origin, pinned per provider |
| Manual / regenerate tab fetch | `validateUrl({ requireValidProtocol: true, blockLocalhost: true })` | n/a |
| Common fetch helper | `fetchWithRedirectGuard` re-applies `validateUrlForFilterImport` to every hop, using `redirect: 'manual'` | per-hop URL re-validation, up to `MAX_REDIRECT_HOPS` |

Note the deliberate difference between rows 1 and 4. `FETCH_URL` uses `redirect: 'error'` because
all known filter-list sources are fixed HTTPS hosts that rely on neither http→https nor mirror
redirects, so the stricter policy costs nothing (ADR `2026-08-29-fetch-redirect-policy.md`).
`fetchWithRedirectGuard` is the contract for any entry point that must follow redirects.

#### What the guard does NOT verify — residual risk

**The guard never compares the hostname it approved against the IP the browser actually connects
to.** It validates a URL *string*; DNS resolution happens later, inside the browser's network
stack, and is outside anything the extension can observe. A hostname that passes the guard at
validation time can resolve to a loopback or private address when `fetch` actually runs.

This is DNS rebinding, and it is the reason the guard must not be described as "SSRF protection"
in the general case. What it *does* give is: private IP literals and redirects are refused.

Two follow-on limits, stated so they are not over-read:

- Re-validating a redirect hop is a **URL-string** operation. The hop is not re-checked against
  its resolved IP.
- The contract tests in `src/utils/__tests__/ssrfGuard.test.ts` (23 cases) cover private IPv4/IPv6,
  localhost, scheme, and redirect hops. Two of them assert that a **public** hostname is allowed
  as-is (`https://example.com/filters.txt`, `https://api.openai.com/v1/chat`). There is **no test
  for a hostname whose DNS answer changes**, because the guard does not model that — so those
  public-hostname cases are not evidence that a hostname's DNS answer is safe.

#### Why the risk is accepted rather than fixed here

The MV3 service worker has no DNS resolver it can control and no API to pin a connection to a
resolved IP. Complete mitigation is therefore not available inside the extension; closing it
would require a design change outside the guard.

Reachability is limited by factors that already exist: the extension CSP, the origin allowlist and
its confirmation flow, extension-only registration of `FETCH_URL`, `redirect: 'error'` on the
filter path, and the localhost port constraint. The browser's own Private Network Access and
DNS-rebinding protections apply on top but are not something this codebase controls.

**Residual-risk owner: the security reviewer.** When reviewing, do not accept "we validate URLs"
as the argument that SSRF is prevented. Ask which entry point is in play, what its redirect
policy is, and record the acceptance decision here. If connection-IP pinning is ever required,
that is a design question, not a guard change.



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
