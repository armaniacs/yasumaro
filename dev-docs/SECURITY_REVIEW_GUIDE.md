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
- API-key ciphertext is AAD-bound to the settings field it lives under (`EncryptedData.version: 2`), so moving an envelope between fields fails to decrypt instead of sending the key to the wrong provider. The binding is passed by the reader, never stored in the envelope; AAD-less envelopes (v1) stay readable until rewritten.

### Privacy-consent gating: what must ask, and what must not

`hasPrivacyConsent()` is the single source of truth, and there are exactly **two
kinds of gate** read point:

1. **The admission gate** — `createBackgroundServices()` wires
   `isRecordingAllowed: () => hasPrivacyConsent()`
   (`src/background/compositionManifest.ts:41`, `src/background/service-worker.ts:177`),
   and `RecordingAdmission` calls it before admitting a record
   (`src/background/recordingAdmission.ts` → `reason: 'privacy_consent_required'`).
2. **Outbound gates** — paths that leave the admission flow entirely (the dashboard
   Obsidian export in `src/background/handlers/dashboardSqlite/coreCrudHandler.ts`,
   the alarm replay / notification / review-digest paths in PBI `2026-10-19-10`).
   These take an injected `isConsentGranted: () => Promise<boolean>` from the
   composition root, whose body is the same one-line read of `hasPrivacyConsent()`.
   The handler never implements its own judgement; it only calls the injected seam.

Other production readers are **not gates** and are fine to add:
the global consent badge (`src/background/consentBadge.ts:22`) and the popup's
own consent state (`src/entrypoints/popup/popup.ts:18`).

Two rules for a new outbound path:

1. **Is it allowed to run at all without consent?** If it can carry a recorded
   row, a page body, or a derived summary, it needs the gate; if it carries only
   configuration the user just typed, it does not. Local-only operations (delete,
   clear-all, star, update) never take the gate — otherwise a withdrawn user could
   not erase their own data.
2. **When is the gate read?** Admission-time consent does **not** license later
   execution. Anything that runs on a timer, an alarm, a queue, or a user
   interaction *after* the record was admitted must re-read consent at that
   moment, because consent can be withdrawn in between (withdrawal does not purge
   queues). This is the failure mode behind rows 8–10 below.

| # | Operation | Gated? | Why / where |
|---|---|---|---|
| 1 | Automatic recording (`VALID_VISIT`) | Yes | Writes browsing history; `RecordingAdmission` rejects it (`recordingAdmission.ts:78-80`) |
| 2 | Manual record / preview / save (`MANUAL_RECORD`, `PREVIEW_RECORD`, `SAVE_RECORD`) | Yes | Same admission pre-stage (`src/background/handlers/recordingHandlers.ts`) |
| 3 | Regenerate summary (`REGENERATE_SUMMARY`) | Yes | Its own `admit('regenerate')` call (`recordingHandlers.ts:360`) |
| 4 | AI summarization inside the recording pipeline | Inherited **at record time** | Runs downstream of an admitted record |
| 5 | Obsidian export inside the recording pipeline | Inherited **at record time** | Export is a step of the pipeline |
| 6 | AI / Obsidian / Gist connection tests | No | Send only the configuration the user typed (URL, API key, PAT). Blocking them would stop an unconsented user from validating settings before deciding |
| 7 | Tranco metadata / list download | No | Public list metadata; no user data |
| 8 | Offline retry replay (`src/background/offlineQueueProcessor.ts`) | **Yes — at execution time** | The `yasumaro-offline-network-retry` alarm re-reads consent before the cycle and skips the whole queue when it is withdrawn (a per-job skip would burn retries and starve consented jobs). Pinned by `src/background/__tests__/offlineQueueProcessor.test.ts` ("does not replay queued jobs after the user withdrew consent", "replays the same jobs once consent is granted again") |
| 9 | Notification "save" re-run (`src/background/handlers/notificationHandlers.ts`) | **Yes — at click time** | A privacy-confirm notification outlives the consent it was raised under; the Save button re-reads consent and keeps the pending page so a re-consented user can retry. Pinned by `src/background/handlers/__tests__/notificationHandlers.test.ts` ("does not record a pending page after consent was withdrawn") |
| 10 | Weekly / monthly review digest (`src/background/reviewSummaryGenerator.ts`) | **Yes — at execution time** | The digest joins every row in the period, so consent is re-read after the `REVIEW_SUMMARY_ENABLED` check; nothing is sent and `REVIEW_SUMMARY_LAST_GENERATED_*` stays untouched, so a re-granted consent can still build the period. Pinned by `src/background/__tests__/reviewSummaryGenerator-extra.test.ts` ("does not send the digest to AI when consent was withdrawn") |
| 11 | Dashboard "append selected to Obsidian" (`src/background/handlers/dashboardSqlite/coreCrudHandler.ts`) | **Yes — at execution time** | Rows leave for the Obsidian REST API, outside `RecordingAdmission`. The append case reads the injected `isConsentGranted` (wired in `src/background/dashboardSqliteWiring.ts` from `hasPrivacyConsent`) after input validation and **before** `getSettings`/`query`, so a withdrawn profile neither sends nor reads the rows. All other dashboardSqlite subtasks stay ungated (local-only). Pinned by `src/background/__tests__/dashboardSqliteHandlers-append.test.ts` ("refuses to append when consent was withdrawn (and reads no rows)", "still appends when consent is granted (regression guard)") |
| 12 | `GistSyncTarget.sync` / `syncBatch` | **Not wired yet** | These send recorded rows, so they need the gate **when they get a production caller**. As of 2026-10-19 the only production use of `GistSyncTarget` is the dashboard connection test (`src/dashboard/gistSettings.ts:48`) |
| 13 | Settings export / import (`src/utils/settingsExportImport.ts`) | **Consent never travels** | A settings file must not carry the consent record: an export would grant consent on the target profile, and a revoked export would withdraw a valid grant there. Consent is an act performed on *this* device. `sanitizeSettingsForExport` drops `privacy_consent` / `_version` / `_denied_count` / `_last_denial_time`; the import path ignores those **and** `privacy_mode` / `pii_confirmation_ui`, because `migrateLegacyPrivacyConsent` reads them as evidence of a previous grant and would auto-consent from a file. Pinned by `src/utils/__tests__/settingsExportImport-consent.test.ts` |

`requireConsent()` used to exist as an unused "guard the caller" helper
(`privacyConsent.ts`); it was removed on 2026-10-19 because nothing called it and
its name implied a second seam that does not exist. The rows marked **gap** were
what that name was hiding: paths that never saw the gate at all. Rows 8–11 are all
closed as of 2026-10-19 (PBI `2026-10-19-10` for the scheduled/queued paths, PBI
`2026-10-19-11` for the dashboard export). Every one of those re-checks takes an
injected `isConsentGranted: () => Promise<boolean>` from the composition — do not
import the consent module from the handler itself.

**Consent is device-local, not portable** (row 13, PBI `2026-10-19-12`). Treat any
path that copies settings between profiles as an outbound path for consent: a
restored profile must show the consent modal, and restoring a backup must never
grant or withdraw consent on the target. This is the same family as rows 8–10 —
consent is a *state*, so it can differ from when the artifact that carries it was
created.

## Regular Audits

- Review API endpoint configurations
- Validate content script permissions scope
- Check for data leakage in logs
- Verify secure storage of sensitive configurations
- Ensure proper HTTPS connections
