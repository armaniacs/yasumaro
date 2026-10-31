/**
 * raw-owned-keys-audit-pin.test.ts
 *
 * Raw-owned storage-key audit pin (PBI 2026-10-31-05).
 *
 * `migrateToSingleSettingsObject()` folds raw top-level keys into the
 * `settings` blob and then deletes them (DESIGN_SPECIFICATIONS.md §5.1.1), so
 * a key whose owning module reads or writes it directly through
 * `chrome.storage.local` loses the only copy that owner can see the moment the
 * migration runs. §5.1.1 keeps the explicit `TOP_LEVEL_ONLY_KEYS` allowlist in
 * `settingsMigration.ts` for exactly that reason, and the audit that keeps the
 * allowlist complete used to be open work: nothing failed when a raw-owned key
 * was added to `StorageKeys` without being classified, and the leak surfaced
 * only as deleted user state on the next migration.
 *
 * This suite pins the audit shut. Nothing here can make a misclassification
 * illegal, so it does the things that are actually checkable:
 *
 *   1. every non-test .ts source under `src/` and `entrypoints/` is scanned
 *      for direct `chrome.storage.local` read/write call sites — including
 *      optional-chain, receiver-alias and call-return receiver forms
 *      (`chrome?.storage?.local?.get`, `g.storage.local.get`,
 *      `this.storage.local.set`, `this.getChromeApi()?.storage?.local?.get`) —
 *      so a broken collector cannot pass silently, and
 *   2. every `StorageKeys` value resolved at such a call site must be on the
 *      `TOP_LEVEL_ONLY_KEYS` allowlist parsed straight out of the
 *      `settingsMigration.ts` source — a raw-owned key added to `StorageKeys`
 *      without a classification fails the pin, and
 *   3. the audit table below (the executable form of the §5.1.1 contract
 *      table) and the implementation allowlist must match set-for-set, so
 *      neither side can drift, and
 *   4. direct call sites whose key is a parameter (queue adapters, session
 *      stores, injected stores) must be declared here with the member keys
 *      their callers trace to, and
 *   5. the detector still recognizes every syntax form it exists to catch,
 *      while leaving comment mentions of `chrome.storage.local` unflagged.
 *
 * Classification is by **direct access**, never by name pattern: substring
 * tests such as `key.includes('_version')` misclassify settings whose name
 * merely ends in `_version` (`gemini_api_version`, a dashboard-editable value)
 * and say nothing about the CAS records they were meant to exclude. The
 * declared probe reads below are the one exception the audit records
 * explicitly: `privacy_mode` / `pii_confirmation_ui` are read raw only by the
 * one-time legacy-consent evidence probe, and `cleansing_offscreen_enabled` is
 * read raw by the actual offscreen-delegation gate in
 * `content/cleansingOffscreenDelegate.ts` — all three are owned by the
 * settings blob, so they keep migrating.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync, type Stats } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { StorageKeys } from '../types.js';
import { STORAGE_KEY_VALUES } from '../settingsBackup.js';
import { isMigratableStorageKey, migrateToSingleSettingsObject } from '../settingsMigration.js';
import { InMemoryStoragePort } from '../storagePort.js';

/* ------------------------------------------------- the audit table (§5.1.1) */

/**
 * Every `StorageKeys` member whose owning module reads or writes it directly
 * through `chrome.storage.local` — the executable form of the §5.1.1 contract
 * table. Keyed by the `StorageKeys` identifier so a renamed or removed member
 * fails the pin instead of silently dropping out of the audit.
 */
const RAW_OWNED_KEYS = {
    // Keyring: re-encrypting or relocating these strands the ciphertext.
    ENCRYPTION_SALT: 'keyring in storage/encryptionSession.ts — written on anonymous-key setup, read by kdfNegotiator.ts',
    ENCRYPTION_SECRET: 'keyring in storage/encryptionSession.ts — wrapped envelope written/read on key derive',
    HMAC_SECRET: 'keyring in storage/encryptionSession.ts — HMAC envelope written/read on export-key derive',
    MASTER_PASSWORD_SALT: 'keyring in storage/encryptionSession.ts — written on master-password setup, read by the three verify paths',
    MASTER_PASSWORD_HASH: 'keyring in storage/encryptionSession.ts — written on master-password setup/rehash',
    // KEK-transition anchors (persisted via StoragePort, read back on restart).
    MASTER_PASSWORD_PENDING_SALT: 'KEK-transition anchor in storage/encryptionSession.ts (port-mediated persistence)',
    MASTER_PASSWORD_PENDING_HASH: 'KEK-transition anchor in storage/encryptionSession.ts (port-mediated persistence)',
    // Version-managed consent state read straight from top-level storage.
    PRIVACY_CONSENT_VERSION: 'storage/privacyConsent.ts — recordPolicyVersionAcknowledgment writes, the prompt gate reads',
    TRANCO_VERSION: 'trustDb/trancoConsentManager.ts — version-managed Tranco state (allowlisted per §5.1.1)',
    PRIVACY_CONSENT: 'storage/privacyConsent.ts — signed consent record; every reader reads it straight from top-level storage',
    PRIVACY_CONSENT_DENIED_COUNT: 'storage/privacyConsent.ts — denial counter read/written straight from top-level storage',
    PRIVACY_CONSENT_LAST_DENIAL_TIME: 'storage/privacyConsent.ts — last-denial timestamp read/written straight from top-level storage',
    // RecordingTriggerManager reads these keys directly from top-level storage.
    RECORDING_TRIGGERS: 'background/recordingTriggerManager.ts — readTopLevelOrBlob reads it straight from top-level storage',
    SNAPSHOT_INTERVAL_MINUTES: 'background/recordingTriggerManager.ts — readTopLevelOrBlob reads it straight from top-level storage',
    // Trust database owned by TrustDbKernel with its own optimistic lock.
    TRUST_DB: 'trustDb/TrustDbKernel.ts — persists with its own withOptimisticLock on the raw key',
    // AI usage counters: checkRateLimit and recordUsage read/write them directly.
    AI_USAGE_MONTH: 'utils/aiUsageTracker.ts — checkRateLimit/recordUsage read/write straight from top-level storage',
    AI_USAGE_TOKENS_SENT: 'utils/aiUsageTracker.ts — recordUsage writes straight from top-level storage',
    AI_USAGE_TOKENS_RECEIVED: 'utils/aiUsageTracker.ts — recordUsage writes straight from top-level storage',
    AI_USAGE_REQUEST_COUNT: 'utils/aiUsageTracker.ts — recordUsage writes straight from top-level storage',
    AI_RATE_LIMIT_WINDOW_START: 'utils/aiUsageTracker.ts — checkRateLimit reads/writes straight from top-level storage',
    AI_RATE_LIMIT_COUNT: 'utils/aiUsageTracker.ts — checkRateLimit reads/writes straight from top-level storage',
    // SQLite engine migration state, each owned by the module that moves it.
    YASUMARO_MIGRATION_STATUS: 'background/migration/migrationState.ts — read/written/removed straight from top-level storage',
    YASUMARO_MIGRATION_PROGRESS: 'background/migration/migrationState.ts — read/written/removed straight from top-level storage',
    YASUMARO_MIGRATION_RETRY_COUNT: 'background/migration/migrationState.ts — read/written/removed straight from top-level storage',
    OPFS_FALLBACK_MODE: 'offscreen/sqliteEngineHost.ts, sqliteEngineContext/fallbackMigration.ts and background/migration/opfsRecovery.ts — set/removed straight from top-level storage',
    OPFS_MIGRATION_V2_DONE: 'offscreen/opfsWorker/migrationV2.ts, sqliteEngineContext/migrationBackup.ts and offscreen/sqliteStatus.ts — set/read straight from top-level storage',
    OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT: 'offscreen/opfsWorker/migrationV2.ts and offscreen/sqliteStatus.ts — set/read straight from top-level storage',
    OPFS_MIGRATION_V2_COMPLETED_AT: 'offscreen/opfsWorker/migrationV2.ts and offscreen/sqliteStatus.ts — set/read straight from top-level storage',
    OPFS_MIGRATION_V2_RECORD_COUNT: 'offscreen/opfsWorker/migrationV2.ts and offscreen/sqliteStatus.ts — set/read straight from top-level storage',
    IDB_MIGRATION_V2_DONE: 'offscreen/sqliteEngineContext/migrationBackup.ts — set/read straight from top-level storage',
    IDB_MIGRATION_BACKUP: 'offscreen/sqliteEngineContext/migrationBackup.ts — JSON snapshot written/removed straight from top-level storage',
    // Permission-ladder opt-in read straight from top-level storage.
    ALLOW_ALL_URLS_OPT_IN: 'popup/contentFetchGateway.ts — the reader reads it straight from top-level storage',
    // Last capture outcome written by the content script, read by the dashboard.
    LAST_CAPTURE_OUTCOME: 'utils/captureOutcome.ts — written/read straight from top-level storage (PBI 2026-10-22-06)',
    // PBI 2026-10-31-05: gaps the audit found — raw-owned but unclassified.
    MASTER_PASSWORD_ENABLED: 'storage/encryptionSession.ts writes it on master-password setup; authGuard.ts, settingsMigration.ts and privacyConsent.ts read it straight from top-level storage (SettingsRepository.ts and SessionAlarmService.ts read the same top-level key through the Port seam) — folding it strands the master-KEK ciphertext and opens a locked session',
    MASTER_PASSWORD_KDF_ITERATIONS: 'storage/encryptionSession.ts — KDF iteration record written/read straight from top-level storage',
    IS_LOCKED: 'storage/encryptionSession.ts writes it on lock/unlock; authGuard.ts reads it straight from top-level storage — folding it reports an unlocked session for a locked one',
    CONTENT_STORAGE_ENABLED: 'storage/privacyConsent.ts — acceptConsent writes it, the record-flow gate reads it straight from top-level storage',
    NAV_TRAIL_CONSENT: 'storage/navTrailConsent.ts — device-local opt-in read/written straight from top-level storage (absent from DEFAULT_SETTINGS by design)',
    DOMAIN_FILTER_CACHE: 'storage/domainFilterCache.ts writes the content-script mirror; the content script reads it straight from top-level storage',
    DOMAIN_FILTER_CACHE_TIMESTAMP: 'storage/domainFilterCache.ts — cache timestamp written straight from top-level storage for the content script',
    DOMAIN_FILTER_MODE: 'storage/domainFilterCache.ts — mode mirror written straight from top-level storage for the content script',
    ALLOWED_URLS: 'background/allowedUrlsSync.ts — derived allowlist written straight from top-level storage on every settings write and at startup',
    ALLOWED_URLS_HASH: 'background/allowedUrlsSync.ts — change-detection key written straight from top-level storage',
    HISTORY_SORT_PREFERENCE: 'dashboard/panels/asyncData/sqliteHistoryModel.ts — panel sort preference read/written straight from top-level storage',
    CLEANSING_FEEDBACK_QUEUE: 'utils/aiSummaryCleaner/feedbackQueue.ts — queue read straight from top-level storage; the lock persists at the same key',
    RECORDING_PAUSED_UNTIL: 'background/recordingPause.ts — pause deadline read/written/removed straight from top-level storage',
} satisfies Record<string, string>;

/**
 * Keys read raw but owned by the settings blob, so folding them is by design.
 * Each reason states the measured behavior of the raw read, not the intended
 * one; a new entry must record what the read actually drives.
 */
const DECLARED_MIGRATABLE_RAW_READS = [
    {
        key: StorageKeys.PRIVACY_MODE,
        reason: 'read raw only by the one-time legacy-consent evidence probe (migrateLegacyPrivacyConsent); the owner is the settings blob the dashboard edits, so folding is by design',
    },
    {
        key: StorageKeys.PII_CONFIRMATION_UI,
        reason: 'same one-time evidence probe; a dashboard-editable user setting whose owner is the settings blob',
    },
    {
        key: StorageKeys.CLEANSING_OFFSCREEN_ENABLED,
        reason: 'read raw as the actual gate decision (isCleansingOffscreenEnabled in content/cleansingOffscreenDelegate.ts: the top-level read picks offscreen delegation vs the sync fallback, cached once and invalidated by storage.onChanged on the same top-level key); the owner is the settings blob (DEFAULT_SETTINGS) and the tree has no top-level writer, so folding is by design — but the gate has no blob-tier reader, so a legacy profile whose top-level copy folds on the next migration silently loses an enabled flag and falls back to sync cleansing (follow-up PBI candidate)',
    },
] as const;

/**
 * Direct call sites whose first argument is a parameter (a function argument,
 * a cross-file constant, or an object-member constant) the scanner cannot
 * resolve statically. Each declares the member keys its callers trace to; a
 * new parameterized helper must be declared here or the pin fails.
 */
const KEY_PARAMETERIZED_HELPERS = [
    {
        file: 'src/utils/storage/storagePort.ts',
        reason: 'the StoragePort implementation itself — forwards caller-provided keys; the settings blob path writes the settings key',
        tracedMembers: [] as string[],
    },
    {
        file: 'src/background/queueStorageAdapter.ts',
        reason: 'QueueStorageAdapter load/save take a key parameter — the PersistentRetryQueue storage keys offline_network_queue and pending_chrome_storage_writes (module-owned, not StorageKeys values)',
        tracedMembers: [],
    },
    {
        file: 'src/background/sessionStore.ts',
        reason: 'session/local migration for sw:* session keys (not StorageKeys values)',
        tracedMembers: [],
    },
    {
        file: 'src/background/webhookExport/webhookExportHistory.ts',
        reason: 'the injected store takes a key parameter — webhook_export_history_v1 (module-owned, not a StorageKeys value)',
        tracedMembers: [],
    },
    {
        file: 'src/background/webhookExport/webhookExportSettings.ts',
        reason: 'the injected store takes a key parameter — webhook_export_settings_v1 (module-owned, not a StorageKeys value)',
        tracedMembers: [],
    },
    {
        file: 'src/background/localMarkdownExportCore.ts',
        reason: 'removes the local_md_export_* retention keys (module-owned, not StorageKeys values)',
        tracedMembers: [],
    },
    {
        file: 'src/background/dailyPurgeHandler.ts',
        reason: 'removes expired local_md_export_* keys (module-owned, not StorageKeys values)',
        tracedMembers: [],
    },
    {
        file: 'src/background/migration/legacyMigration.ts',
        reason: 'reads/removes the legacy savedUrls family and the MIGRATION_*_KEY constants imported from migrationState.js (cross-file consts)',
        tracedMembers: [
            StorageKeys.YASUMARO_MIGRATION_STATUS,
            StorageKeys.YASUMARO_MIGRATION_PROGRESS,
            StorageKeys.YASUMARO_MIGRATION_RETRY_COUNT,
        ],
    },
    {
        file: 'src/utils/crypto/hmacKeyStore.ts',
        reason: 'getOrCreateWrappedHmacKey takes storageKey/versionKey parameters — module-local HMAC signature envelope constants plus the quarantine suffix (not StorageKeys values)',
        tracedMembers: [],
    },
    {
        file: 'src/utils/aiUsageTracker.ts',
        reason: 'readAiUsageNumber takes a key parameter — the callers pass the AI usage counter members the audit table already lists',
        tracedMembers: [],
    },
    {
        file: 'src/background/recordingTriggerManager.ts',
        reason: 'readTopLevelOrBlob takes a key parameter — the auto-save trigger settings',
        tracedMembers: [StorageKeys.RECORDING_TRIGGERS, StorageKeys.SNAPSHOT_INTERVAL_MINUTES],
    },
    {
        file: 'src/utils/RateLimitService.ts',
        reason: 'flushPendingWrites/checkRateLimit/resetFailedAttempts call this.storage.local (the injected StoragePort whose default is CHROME_STORAGE_PORT) with the module-local STORAGE_KEYS constants passwordFailedAttempts, firstFailedAttemptTime and lockedUntil (not StorageKeys values)',
        tracedMembers: [],
    },
    {
        file: 'src/utils/storage/encryptionSession.ts',
        reason: 'the HMAC quarantine key is a template of the classified hmac_secret plus the cross-file QUARANTINE_SUFFIX constant (not a StorageKeys value)',
        tracedMembers: [],
    },
] as const;

/* ------------------------------------------------------------------ scanner */

/**
 * Receiver + method of a direct chrome.storage.local read/write call. The
 * receiver may be the chrome global itself, an alias, or an optional/call-return
 * chain (`chrome?.storage?.local?.get`, `g.storage.local.get`,
 * `this.storage.local.set`, `this.getChromeApi()?.storage?.local?.get`), so a
 * call whose `.storage.local` member chain is spelled out still matches even
 * when the receiver is not the chrome global itself.
 */
const DIRECT_STORAGE_CALL_RE =
    /\b[A-Za-z_$][\w$]*(?:\(\))?\??\.storage\??\.local\??\.(get|set|remove|getBytesInUse|clear)\s*\(/g;

const PRODUCTION_ROOTS = ['src', 'entrypoints'] as const;
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist', '.wxt', 'coverage']);

/** @returns repo-relative POSIX paths of every non-test .ts source under `dir`. */
function collectProductionFiles(dir: string, acc: string[] = []): string[] {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return acc;
    }
    for (const entry of entries) {
        const full = join(dir, entry);
        let st: Stats | undefined;
        try {
            st = statSync(full);
        } catch {
            continue; // broken symlink
        }
        if (st.isDirectory()) {
            if (SKIP_DIRS.has(entry)) continue;
            collectProductionFiles(full, acc);
        } else if (
            st.isFile() &&
            extname(entry) === '.ts' &&
            !entry.endsWith('.test.ts') &&
            !entry.endsWith('.d.ts')
        ) {
            // Repo-relative POSIX paths so the declarations below and the
            // reported paths read the same on every platform.
            acc.push(full.split(sep).join('/').replace(`${process.cwd().split(sep).join('/')}/`, ''));
        }
    }
    return acc;
}

/**
 * Replaces comments with spaces (keeping newlines so line numbers stay true)
 * while leaving string-literal contents alone: a `http://` URL inside a string
 * is not a line comment.
 */
function stripComments(text: string): string {
    let out = '';
    let i = 0;
    let inString: string | null = null;
    while (i < text.length) {
        const c = text[i];
        const n = text[i + 1];
        if (inString !== null) {
            out += c;
            if (c === '\\') {
                out += n ?? '';
                i += 2;
                continue;
            }
            if (c === inString) inString = null;
            i++;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            inString = c;
            out += c;
            i++;
            continue;
        }
        if (c === '/' && n === '*') {
            let j = i + 2;
            while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) {
                out += text[j] === '\n' ? '\n' : ' ';
                j++;
            }
            out += '  ';
            i = j + 2;
            continue;
        }
        if (c === '/' && n === '/') {
            let j = i;
            while (j < text.length && text[j] !== '\n') {
                out += ' ';
                j++;
            }
            i = j;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/** @returns the top-level comma-separated parts of `s`. */
function splitTopLevel(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString: string | null = null;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i]!; // loop condition guarantees the index is in range
        if (inString !== null) {
            if (c === '\\') {
                cur += c + (s[i + 1] ?? '');
                i++;
                continue;
            }
            if (c === inString) inString = null;
            cur += c;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            inString = c;
            cur += c;
            continue;
        }
        if ('([{'.includes(c)) depth++;
        if (')]}'.includes(c)) depth--;
        if (c === ',' && depth === 0) {
            parts.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

/** @returns the key expressions of a `{ ... }` literal passed to set(). */
function objectKeyExpressions(expr: string): string[] {
    const inner = expr.slice(expr.indexOf('{') + 1, expr.lastIndexOf('}'));
    const keys: string[] = [];
    for (const part of splitTopLevel(inner)) {
        const t = part.trim();
        const computed = /^\[(.+)\]\s*:/.exec(t);
        if (computed?.[1] !== undefined) {
            keys.push(computed[1]);
            continue;
        }
        const named = /^([A-Za-z0-9_$'"]+)\s*:/.exec(t);
        if (named?.[1] !== undefined) {
            const raw = named[1];
            keys.push(/^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw);
            continue;
        }
        const spread = /^\.\.\.([A-Za-z0-9_]+)/.exec(t);
        if (spread?.[1] !== undefined) keys.push(`SPREAD:${spread[1]}`);
    }
    return keys;
}

/** @returns `ident -> initializer expression` for every `const` in `text`. */
function constBindings(text: string): Map<string, string> {
    const map = new Map<string, string>();
    const re = /(?:^|\n)([ \t]*(?:export[ \t]+)?const[ \t]+([A-Za-z0-9_]+)(?:[ \t]*:[^=\n]*)?[ \t]*=[ \t]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const header = m[1] ?? '';
        let i = m.index + header.length;
        while (text[i] === ' ') i++;
        let expr = '';
        let depth = 0;
        let inString: string | null = null;
        let done = false;
        for (; i < text.length && !done; i++) {
            const c = text[i]!; // loop condition guarantees the index is in range
            if (inString !== null) {
                if (c === '\\') {
                    expr += c + (text[i + 1] ?? '');
                    i++;
                    continue;
                }
                if (c === inString) inString = null;
                expr += c;
                continue;
            }
            if (c === "'" || c === '"' || c === '`') {
                inString = c;
                expr += c;
                continue;
            }
            if ('([{'.includes(c)) depth++;
            if (')]}'.includes(c)) {
                depth--;
                expr += c;
                if (depth === 0) done = true;
                continue;
            }
            if ((c === ';' || c === '\n') && depth === 0) {
                done = true;
                continue;
            }
            expr += c;
        }
        const ident = m[2];
        if (ident !== undefined) map.set(ident, expr.trim());
    }
    return map;
}

/**
 * Resolves one key expression to storage-key strings. Static forms resolve
 * (string literal, `StorageKeys.X`, same-file `const`, array/object/template
 * of those); anything else is recorded as unresolvable so the pin can demand
 * a declaration for it.
 */
function resolveKeyExpression(
    expr: string,
    bindings: Map<string, string>,
    out: string[],
    dyn: string[],
    seen: Set<string> = new Set<string>(),
): void {
    const e = expr.trim();
    if (/^(['"])((?:(?!\1).)*)\1$/.test(e)) {
        out.push(e.slice(1, -1));
        return;
    }
    const enumRef = /^StorageKeys\.([A-Z0-9_]+)/.exec(e);
    if (enumRef?.[1] !== undefined) {
        const value = STORAGE_KEY_MAP[enumRef[1]];
        if (value !== undefined) out.push(value);
        else dyn.push(`ENUM?${enumRef[1]}`);
        return;
    }
    if (e === 'null' || e === 'undefined' || e === '') return;
    const spread = /^\.\.\.([A-Za-z0-9_]+)/.exec(e);
    if (spread?.[1] !== undefined) {
        const target = bindings.get(spread[1]);
        if (target !== undefined) resolveKeyExpression(target, bindings, out, dyn, seen);
        else dyn.push(`SPREAD ${spread[1]}`);
        return;
    }
    if (bindings.has(e)) {
        if (seen.has(e)) return;
        seen.add(e);
        resolveKeyExpression(bindings.get(e) ?? '', bindings, out, dyn, seen);
        return;
    }
    if (/^\[/.test(e)) {
        const inner = e.slice(1, e.lastIndexOf(']'));
        for (const part of splitTopLevel(inner)) resolveKeyExpression(part, bindings, out, dyn, seen);
        return;
    }
    if (/^\{/.test(e)) {
        for (const key of objectKeyExpressions(e)) {
            const t = key.trim();
            if (/^SPREAD:/.test(t)) {
                const target = bindings.get(t.slice(7));
                if (target !== undefined) resolveKeyExpression(target, bindings, out, dyn, seen);
                else dyn.push(`OBJSPREAD ${t.slice(7)}`);
            } else {
                resolveKeyExpression(t, bindings, out, dyn, seen);
            }
        }
        return;
    }
    if (/^`/.test(e)) {
        const refs = [...e.matchAll(/\$\{([^}]+)\}/g)].map((x) => (x[1] ?? '').trim());
        const values: string[] = [];
        for (const ref of refs) {
            const literal = /^(['"])((?:(?!\1).)*)\1$/.exec(ref);
            if (literal?.[2] !== undefined) {
                values.push(literal[2]);
                continue;
            }
            const enumPart = /^StorageKeys\.([A-Z0-9_]+)/.exec(ref);
            if (enumPart?.[1] !== undefined && STORAGE_KEY_MAP[enumPart[1]] !== undefined) {
                values.push(STORAGE_KEY_MAP[enumPart[1]] ?? '');
                continue;
            }
            if (bindings.has(ref)) {
                const sub: string[] = [];
                const subDyn: string[] = [];
                resolveKeyExpression(bindings.get(ref) ?? '', bindings, sub, subDyn, new Set<string>([...seen, ref]));
                if (subDyn.length === 0 && sub.length === 1) {
                    values.push(sub[0] ?? '');
                    continue;
                }
            }
            dyn.push(`TEMPLATE ${e.slice(0, 40)}`);
            return;
        }
        if (values.length === refs.length) {
            out.push(values.join(''));
            return;
        }
        dyn.push(`TEMPLATE ${e.slice(0, 40)}`);
        return;
    }
    dyn.push(`DYNAMIC ${e.slice(0, 50)}`);
}

interface RawAccessScan {
    /** Scanned production sources, so a broken collector cannot pass silently. */
    scannedFiles: string[];
    /** `StorageKeys` values resolved at a direct call site -> `file:line(method)` sites. */
    memberHits: Map<string, string[]>;
    /** The resolved member values as one set, for the classification pin. */
    memberKeys: Set<string>;
    /** Keys resolved at a direct call site that are not `StorageKeys` values. */
    nonMemberKeys: Map<string, string[]>;
    /** Direct call sites whose first argument resolves to no storage key. */
    unresolvedSites: string[];
}

function scanRawAccess(): RawAccessScan {
    const scannedFiles = PRODUCTION_ROOTS.flatMap((root) => collectProductionFiles(join(process.cwd(), root)));
    const memberHits = new Map<string, string[]>();
    const nonMemberKeys = new Map<string, string[]>();
    const unresolvedSites: string[] = [];
    for (const file of scannedFiles) {
        const raw = readFileSync(file, 'utf8');
        const clean = stripComments(raw);
        if (!DIRECT_STORAGE_CALL_RE.test(clean)) continue;
        DIRECT_STORAGE_CALL_RE.lastIndex = 0;
        const bindings = constBindings(raw);
        let m: RegExpExecArray | null;
        while ((m = DIRECT_STORAGE_CALL_RE.exec(clean)) !== null) {
            const openIdx = m.index + m[0].length - 1;
            let depth = 1;
            let i = openIdx + 1;
            let arg = '';
            let inString: string | null = null;
            for (; i < clean.length; i++) {
                const c = clean[i];
                if (inString !== null) {
                    if (c === '\\') {
                        arg += c + (clean[i + 1] ?? '');
                        i++;
                        continue;
                    }
                    if (c === inString) inString = null;
                    arg += c;
                    continue;
                }
                if (c === "'" || c === '"' || c === '`') {
                    inString = c;
                    arg += c;
                    continue;
                }
                if (c === '(') depth++;
                if (c === ')') {
                    depth--;
                    if (depth === 0) break;
                }
                arg += c;
            }
            const parts = arg.trim() ? splitTopLevel(arg) : [];
            // chrome.storage.local signatures take the keys as the first
            // argument; later arguments are callbacks, not keys.
            const first = (parts[0] ?? '').trim();
            const out: string[] = [];
            const dyn: string[] = [];
            if (first) resolveKeyExpression(first, bindings, out, dyn);
            const line = clean.slice(0, m.index).split('\n').length;
            const method = m[1] ?? '?';
            for (const key of out) {
                if (MEMBER_VALUES.has(key)) {
                    const sites = memberHits.get(key) ?? [];
                    sites.push(`${file}:${line}(${method})`);
                    memberHits.set(key, sites);
                } else {
                    const sites = nonMemberKeys.get(key) ?? [];
                    sites.push(file);
                    nonMemberKeys.set(key, sites);
                }
            }
            for (const d of dyn) unresolvedSites.push(`${file}:${line} ${method}(${d})`);
        }
    }
    return { scannedFiles, memberHits, memberKeys: new Set<string>(memberHits.keys()), nonMemberKeys, unresolvedSites };
}

/* ------------------------------------------- enum map + parsed allowlist */

/** The runtime StorageKeys SSOT, keyed by identifier for source resolution. */
const STORAGE_KEY_MAP = StorageKeys as Record<string, string>;
/** Every `StorageKeys` value — the set `isMigratableStorageKey` accepts from. */
const MEMBER_VALUES: ReadonlySet<string> = new Set<string>(Object.values(STORAGE_KEY_MAP));

/** @returns the audit table's keys, failing loudly on a stale entry. */
function rawOwnedMemberKeys(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const ident of Object.keys(RAW_OWNED_KEYS)) {
        const value = STORAGE_KEY_MAP[ident];
        if (value === undefined) {
            throw new Error(`the audit table references StorageKeys.${ident}, which no longer exists — update the table`);
        }
        keys.add(value);
    }
    return keys;
}

/**
 * Parses the explicit `TOP_LEVEL_ONLY_KEYS` allowlist out of the
 * settingsMigration.ts source. The allowlist is not exported, so the pin reads
 * what the code actually classifies — an import could not exist, and parsing
 * keeps the audit honest about the implementation it guards.
 */
function parseTopLevelOnlyKeys(): ReadonlySet<string> {
    const raw = readFileSync(join(process.cwd(), 'src/utils/storage/settingsMigration.ts'), 'utf8');
    // Comments first: a `StorageKeys.X` mention inside a comment would
    // otherwise be parsed as a member of the allowlist.
    const source = stripComments(raw);
    const declStart = source.indexOf('const TOP_LEVEL_ONLY_KEYS');
    if (declStart < 0) {
        throw new Error('TOP_LEVEL_ONLY_KEYS no longer exists in settingsMigration.ts — update the pin');
    }
    const listStart = source.indexOf('[', declStart);
    let depth = 0;
    let listEnd = -1;
    for (let i = listStart; i < source.length; i++) {
        if (source[i] === '[') depth++;
        else if (source[i] === ']') {
            depth--;
            if (depth === 0) {
                listEnd = i;
                break;
            }
        }
    }
    if (listStart < 0 || listEnd < 0) {
        throw new Error('TOP_LEVEL_ONLY_KEYS is no longer an array literal — update the pin');
    }
    const keys = new Set<string>();
    for (const match of source.slice(listStart, listEnd).matchAll(/StorageKeys\.([A-Z0-9_]+)/g)) {
        const ident = match[1];
        if (ident === undefined) continue;
        const value = STORAGE_KEY_MAP[ident];
        if (value === undefined) {
            throw new Error(`TOP_LEVEL_ONLY_KEYS references StorageKeys.${ident}, which no longer exists — update the pin`);
        }
        keys.add(value);
    }
    if (keys.size === 0) {
        throw new Error('parsed no members from TOP_LEVEL_ONLY_KEYS — the pin cannot classify anything');
    }
    return keys;
}

const RAW_OWNED_MEMBER_KEYS = rawOwnedMemberKeys();
const TOP_LEVEL_ONLY_PARSED = parseTopLevelOnlyKeys();
const DECLARED_PROBE_KEYS: ReadonlySet<string> = new Set<string>(DECLARED_MIGRATABLE_RAW_READS.map((d) => d.key));
/** The whole audit scan, computed once for every test below. */
const AUDIT = scanRawAccess();

/**
 * The pin's core invariant: every raw-owned `StorageKeys` member must be
 * classified. Throws naming the leak so the unclassified key can be fixed.
 */
function assertEveryRawOwnedKeyClassified(
    rawMemberKeys: Iterable<string>,
    classified: ReadonlySet<string>,
    label: string,
): void {
    const unclassified = [...rawMemberKeys].filter((key) => !classified.has(key)).sort();
    if (unclassified.length > 0) {
        throw new Error(
            `${label}: raw-owned StorageKeys members read or written directly through chrome.storage.local that are missing from TOP_LEVEL_ONLY_KEYS — migrating them deletes the only copy their owner can see: ${unclassified.join(', ')}`,
        );
    }
}

/* -------------------------------------------------------------------- tests */

describe('raw-owned storage-key audit pin', () => {
    it('scans the whole production tree so a broken collector cannot pass silently', () => {
        expect(AUDIT.scannedFiles.length).toBeGreaterThan(100);
        // The scan must reach the modules this audit exists to guard.
        for (const required of [
            'src/utils/storage/privacyConsent.ts',
            'src/utils/storage/encryptionSession.ts',
            'src/utils/trustDb/TrustDbKernel.ts',
            'src/utils/aiUsageTracker.ts',
            'src/background/allowedUrlsSync.ts',
        ]) {
            expect(AUDIT.scannedFiles, `the scan must include ${required}`).toContain(required);
        }
    });

    it('resolves the raw-owned keys the pin exists to catch', () => {
        for (const key of [
            StorageKeys.PRIVACY_CONSENT,
            StorageKeys.MASTER_PASSWORD_SALT,
            StorageKeys.ENCRYPTION_SALT,
            StorageKeys.TRUST_DB,
            StorageKeys.AI_USAGE_MONTH,
            StorageKeys.ALLOW_ALL_URLS_OPT_IN,
            StorageKeys.YASUMARO_MIGRATION_STATUS,
        ]) {
            expect(AUDIT.memberKeys.has(key), `the scan must resolve ${key} at a direct call site`).toBe(true);
        }
    });

    it('classifies every raw-accessed StorageKeys member at a direct call site', () => {
        // The precondition is part of the assertion: a scan that resolved
        // nothing could classify anything.
        expect(AUDIT.memberKeys.size).toBeGreaterThan(20);
        const classified = new Set<string>([...TOP_LEVEL_ONLY_PARSED, ...DECLARED_PROBE_KEYS]);
        expect(() =>
            assertEveryRawOwnedKeyClassified(AUDIT.memberKeys, classified, 'direct chrome.storage.local call sites'),
        ).not.toThrow();
    });

    it('keeps the audit table and the implementation allowlist in lockstep', () => {
        expect([...RAW_OWNED_MEMBER_KEYS].sort()).toEqual([...TOP_LEVEL_ONLY_PARSED].sort());
    });

    it('declares every key-parameterized helper and traces its member keys', () => {
        const helperFiles = new Set<string>(KEY_PARAMETERIZED_HELPERS.map((h) => h.file));
        for (const site of AUDIT.unresolvedSites) {
            const file = site.slice(0, site.indexOf(':'));
            expect(helperFiles.has(file), `undeclared key-parameterized helper: ${site}`).toBe(true);
        }
        for (const helper of KEY_PARAMETERIZED_HELPERS) {
            expect(existsSync(join(process.cwd(), helper.file)), `declared helper no longer exists: ${helper.file}`).toBe(true);
            for (const key of helper.tracedMembers) {
                expect(MEMBER_VALUES.has(key), `traced key is not a StorageKeys value: ${key}`).toBe(true);
                expect(RAW_OWNED_MEMBER_KEYS.has(key), `traced key is missing from the audit table: ${key}`).toBe(true);
            }
        }
        assertEveryRawOwnedKeyClassified(
            KEY_PARAMETERIZED_HELPERS.flatMap((h) => [...h.tracedMembers]),
            TOP_LEVEL_ONLY_PARSED,
            'traced helper keys',
        );
    });

    it('fails when a raw-owned key lands in StorageKeys without a classification', () => {
        // The probe must look like a real leak: a value neither the allowlist
        // nor the audit table classifies.
        const probe = 'audit_pin_probe_raw_owned_key';
        expect(MEMBER_VALUES.has(probe)).toBe(false);
        expect(RAW_OWNED_MEMBER_KEYS.has(probe)).toBe(false);
        expect([...TOP_LEVEL_ONLY_PARSED]).not.toContain(probe);
        // Adding the probe to the scan result (列挙へ入れる) must fail the pin.
        const tampered = new Set<string>(AUDIT.memberKeys);
        tampered.add(probe);
        expect(() => assertEveryRawOwnedKeyClassified(tampered, TOP_LEVEL_ONLY_PARSED, 'tampered scan')).toThrow(
            /audit_pin_probe_raw_owned_key/,
        );
    });

    it('fails when a classification disappears from TOP_LEVEL_ONLY_KEYS', () => {
        // Removing a real classification (列挙から外す) must fail the pin too.
        const tampered = new Set<string>(TOP_LEVEL_ONLY_PARSED);
        tampered.delete(StorageKeys.PRIVACY_CONSENT);
        expect(() => assertEveryRawOwnedKeyClassified(RAW_OWNED_MEMBER_KEYS, tampered, 'tampered allowlist')).toThrow(
            /privacy_consent/,
        );
    });

    it('leaves keys outside the migration contract alone', () => {
        // Keys the owning module owns outright (not StorageKeys values) are
        // never folded by the migration, so they need no classification.
        for (const key of ['settings', 'savedUrls', 'savedUrlsWithTimestamps', 'legacyStoreReadOnly', 'debugMode']) {
            expect(MEMBER_VALUES.has(key), `${key} must not be a StorageKeys value`).toBe(false);
            expect(isMigratableStorageKey(key), `${key} must not be migratable`).toBe(false);
        }
    });

    it('table-drives isMigratableStorageKey over the full audit table', () => {
        // Every raw-owned key stays out of the migration fold.
        for (const key of RAW_OWNED_MEMBER_KEYS) {
            expect(isMigratableStorageKey(key), `${key} must not be migratable`).toBe(false);
        }
        // The declared probes stay migratable: their owner is the settings blob.
        for (const { key } of DECLARED_MIGRATABLE_RAW_READS) {
            expect(isMigratableStorageKey(key), `${key} must stay migratable`).toBe(true);
        }
        // Contrast: user settings the dashboard edits via the blob keep
        // migrating, even when their name resembles a raw-owned key.
        for (const key of [
            StorageKeys.GEMINI_API_VERSION,
            StorageKeys.OBSIDIAN_PORT,
            StorageKeys.AI_RATE_LIMIT_MAX,
            StorageKeys.MAX_MONTHLY_TOKENS,
        ]) {
            expect(isMigratableStorageKey(key), `${key} must stay migratable`).toBe(true);
        }
        // CAS records, the migration record and backup keys are not
        // StorageKeys values, which is what already rejects them.
        expect(isMigratableStorageKey('settings_version')).toBe(false);
        expect(isMigratableStorageKey('legacy_settings_backup_1750000000000')).toBe(false);
        expect(isMigratableStorageKey('settings_migrated')).toBe(false);
    });

    it('keeps the newly classified raw-owned keys readable after migrating', async () => {
        const port = new InMemoryStoragePort();
        port.seed({
            [StorageKeys.OBSIDIAN_PORT]: '27123',
            [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
            [StorageKeys.IS_LOCKED]: true,
            [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: 600000,
            [StorageKeys.CONTENT_STORAGE_ENABLED]: true,
            [StorageKeys.NAV_TRAIL_CONSENT]: { enabled: true, consentedAt: 1000 },
            [StorageKeys.RECORDING_PAUSED_UNTIL]: 5000,
            [StorageKeys.HISTORY_SORT_PREFERENCE]: '{"sortBy":"url","sortDir":"asc"}',
            [StorageKeys.CLEANSING_FEEDBACK_QUEUE]: [],
            [StorageKeys.DOMAIN_FILTER_CACHE]: ['example.com'],
            [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: 42,
            [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
            [StorageKeys.ALLOWED_URLS]: ['https://example.com'],
            [StorageKeys.ALLOWED_URLS_HASH]: 'https://example.com',
        });
        await expect(migrateToSingleSettingsObject({ port })).resolves.toBe(true);
        const after = await port.get(null);
        // The raw-owned keys keep their only copy: the migration never folds
        // or deletes them.
        expect(after[StorageKeys.MASTER_PASSWORD_ENABLED]).toBe(true);
        expect(after[StorageKeys.IS_LOCKED]).toBe(true);
        expect(after[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]).toBe(600000);
        expect(after[StorageKeys.CONTENT_STORAGE_ENABLED]).toBe(true);
        expect(after[StorageKeys.NAV_TRAIL_CONSENT]).toEqual({ enabled: true, consentedAt: 1000 });
        expect(after[StorageKeys.RECORDING_PAUSED_UNTIL]).toBe(5000);
        expect(after[StorageKeys.HISTORY_SORT_PREFERENCE]).toBe('{"sortBy":"url","sortDir":"asc"}');
        expect(after[StorageKeys.CLEANSING_FEEDBACK_QUEUE]).toEqual([]);
        expect(after[StorageKeys.DOMAIN_FILTER_CACHE]).toEqual(['example.com']);
        expect(after[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]).toBe(42);
        expect(after[StorageKeys.DOMAIN_FILTER_MODE]).toBe('blacklist');
        expect(after[StorageKeys.ALLOWED_URLS]).toEqual(['https://example.com']);
        expect(after[StorageKeys.ALLOWED_URLS_HASH]).toBe('https://example.com');
        // The scattered settings key still folds into the blob: adding
        // classifications must not freeze the migration.
        expect(after[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        expect(after['settings']).toMatchObject({ [StorageKeys.OBSIDIAN_PORT]: '27123' });
    });
});
