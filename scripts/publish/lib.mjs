#!/usr/bin/env node

/**
 * lib.mjs — shared plumbing for the store-publish scripts moved out of
 * .github/workflows/release.yml (DX Advocate finding: ~210 lines of inline
 * shell sat outside the repository's test surface — shellcheck and vitest
 * both reached nothing, so response-parsing branches only failed at release
 * time).
 *
 * The helpers reproduce the jq/curl semantics the shell relied on, so the
 * move stays a relocation (same branches, same messages, same exit
 * behaviour) instead of a behaviour change:
 *
 * - jq's `//` alternative operator: null/false — and a missing key, which jq
 *   reads as null — yields the alternative.
 * - jq property access `.a.b`: on null it yields null; on a number, string,
 *   boolean or array it errors. The shell surfaced that either as a
 *   `... 2>/dev/null || echo <fallback>` guard (→ *Or helpers) or, where no
 *   guard existed, as a pipefail abort of the step (→ jqExtract + explicit
 *   StepFailed).
 * - `jq -c '{...}'` projections stringify with null for missing keys.
 * - curl's non-zero exit under `set -e`: request/spawn failures abort via
 *   StepFailed so the step exits non-zero (see
 *   .checking-team-tmp/.../fix-release-shell.md for the exit-code note).
 *
 * Tests: scripts/__tests__/publish-stores.test.ts injects fetch/sleep/run
 * (DI), so no test ever waits on real time or touches the network.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Failure whose user-facing message has already been logged — the shell
 * equivalent of `echo "<message>"; exit <code>`. `runCli` exits with `code`
 * and prints nothing extra, so output stays byte-identical to the inline
 * shell for every branching message.
 */
export class StepFailed extends Error {
  constructor(code = 1) {
    super(`step failed (exit code ${code})`);
    this.name = 'StepFailed';
    this.code = Number.isInteger(code) && code > 0 ? code : 1;
  }
}

/** True when this module is the process entry (`node scripts/publish/x.mjs`). */
export function isCliEntry(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(process.argv[1]).href;
}

/**
 * Runs a CLI main and maps failures onto process.exitCode: StepFailed keeps
 * its code silently (messages are already out, like `echo …; exit 1`),
 * anything unexpected prints a stack like an unhandled shell error would.
 */
export function runCli(run) {
  Promise.resolve()
    .then(run)
    .catch((error) => {
      if (error instanceof StepFailed) {
        process.exitCode = error.code;
        return;
      }
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    });
}

/** Production poll pacing. Inject `sleep` in tests (TEST_RULE: no real waits). */
export function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** jq's `//` operator: only null/false (and missing) select the alternative. */
export function jqAlternative(value, alternative) {
  return value === null || value === undefined || value === false ? alternative : value;
}

/** JSON.parse that reports failure instead of throwing (jq's parse guard). */
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * jq's `.a.b…` path access over an already-parsed value: property access on
 * null yields null, on a non-object (string/number/boolean/array) it errors.
 * Returns { ok: false } exactly where the shell's jq would exit non-zero.
 */
export function jqPath(root, path) {
  let current = root;
  for (const key of path) {
    if (current === null || current === undefined) return { ok: true, value: null };
    if (typeof current !== 'object' || Array.isArray(current)) return { ok: false, value: undefined };
    current = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : null;
  }
  return { ok: true, value: current };
}

/**
 * `echo "$RESP" | jq -r '.<path>…'` over a raw response body. !ok means jq
 * would have exited non-zero (invalid JSON, or the path ran into a scalar),
 * which the shell either guarded with `|| echo <fallback>` or let abort the
 * step via pipefail.
 */
export function jqExtract(raw, path) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, value: undefined };
  return jqPath(parsed.value, path);
}

/**
 * The guarded form `echo "$RESP" | jq -r '.<path>… // "<alt>"' 2>/dev/null
 * || echo <alt>`: any parse/index failure yields the alternative instead of
 * failing the step.
 */
export function jqExtractOr(raw, path, alternative) {
  const extracted = jqExtract(raw, path);
  if (!extracted.ok) return alternative;
  return jqAlternative(extracted.value, alternative);
}

/** jq -r rendering: strings raw, other JSON values as compact JSON. */
export function jqRawRender(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * `jq -c '{error: (.error // null), status: .status, message: .message}'`,
 * returning null where jq would fail (invalid JSON / non-indexable input) so
 * the caller can print its `|| echo "Non-JSON response…"` fallback.
 */
export function projectErrorFields(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return null;
  const source = parsed.value;
  if (source !== null && (typeof source !== 'object' || Array.isArray(source))) return null;
  const object = source ?? {};
  return JSON.stringify({
    error: jqAlternative(object.error, null) ?? null,
    status: object.status === undefined ? null : object.status,
    message: object.message === undefined ? null : object.message,
  });
}

/**
 * `jq -c '{status, errorCode, message}'` (the Edge failure projection),
 * null where jq would fail → caller prints `|| echo "Non-JSON response"`.
 */
export function projectStatusFields(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return null;
  const source = parsed.value;
  if (source !== null && (typeof source !== 'object' || Array.isArray(source))) return null;
  const object = source ?? {};
  return JSON.stringify({
    status: object.status === undefined ? null : object.status,
    errorCode: object.errorCode === undefined ? null : object.errorCode,
    message: object.message === undefined ? null : object.message,
  });
}

/**
 * curl-equivalent request: `-sS` transport failures and `--max-time` both
 * abort the step (set -e), and redirects are NOT followed (the shell never
 * passed -L, so `redirect: 'manual'` keeps a 3xx a plain response).
 * `--connect-timeout 10` has no separate equivalent — the dominant
 * `--max-time` budget is enforced by the timer below.
 * Returns { status, headers, text }.
 */
export async function requestOrAbort(fetchFn, url, options, log) {
  const { method = 'GET', headers, body, timeoutMs } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text };
  } catch (error) {
    // curl -sS wrote its transport error to stderr and exited non-zero.
    // Message text is node-side now; the non-zero step failure is unchanged.
    log(`Request failed (${url}): ${error instanceof Error ? error.message : String(error)}`);
    throw new StepFailed();
  } finally {
    clearTimeout(timer);
  }
}

/** readFileSync that stops the step like curl's exit 26 (unreadable -T file). */
export function readFileOrAbort(path, log) {
  try {
    return readFileSync(path);
  } catch (error) {
    log(`Failed to open/read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    throw new StepFailed();
  }
}

/** spawnSync with inherit: `npx …` under set -e — non-zero stops the step. */
export function defaultRun(command, args, options = {}, log = console.error) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    // bash: `npx: command not found` (127). Still a non-zero step failure.
    // Via the injected log like every other helper (P12), so tests can pin it.
    log(`${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
