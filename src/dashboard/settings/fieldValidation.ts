/**
 * fieldValidation.ts
 * フィールドバリデーションモジュール
 * 設定フォームの各入力フィールドのバリデーションを行う
 */

import { getMessage, getMessageOr } from '../../utils/i18n.js';
import { PROVIDER_ALLOWLIST_ROWS } from '../../utils/storage/providerAllowlist.js';
import {
    GENERAL_SETTINGS_FIELDS,
    getDescriptorByElementId,
    type FieldDescriptor,
    type ValidationContext,
} from './fieldDescriptor.js';

export type ErrorPair = [HTMLInputElement | null, string];

/**
 * Example domains shown when the whitelist gate rejects a base URL. The ids
 * pick which providers the hint highlights; the domains themselves are
 * projected from the allowlist table rows, so a table change flows here
 * without a hand edit (the gate derives from the same table).
 */
const MAJOR_PROVIDER_HINT_IDS = ['openai', 'anthropic', 'groq', 'openrouter', 'mistral', 'deepinfra'] as const;
const SAKURA_PROVIDER_HINT_IDS = ['sakura'] as const;

function deriveHintDomains(ids: readonly string[]): string[] {
    return ids
        .map((id) => PROVIDER_ALLOWLIST_ROWS.find((row) => row.id === id)?.domain)
        .filter((domain): domain is string => typeof domain === 'string');
}

const MAJOR_PROVIDERS_HINT = deriveHintDomains(MAJOR_PROVIDER_HINT_IDS);
const SAKURA_DOMAINS_HINT = deriveHintDomains(SAKURA_PROVIDER_HINT_IDS);

/**
 * フィールドバリデーションの結果を表示
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 * @param {string} message - エラーメッセージ
 */
/**
 * Resolve an error element container-first: `scope.querySelector` wins so a
 * duplicated id in another panel can never steal the lookup; the document is
 * the fallback that keeps scopeless callers working. The null guard at the
 * call site is preserved — a missing element only flips aria-invalid.
 */
function resolveErrorElement(errorId: string, scope?: ParentNode | null): HTMLElement | null {
    if (scope && typeof scope.querySelector === 'function') {
        const found = scope.querySelector<HTMLElement>(`#${errorId}`);
        if (found) return found;
    }
    return document.getElementById(errorId) as HTMLElement | null;
}

function resolveInputElement(elementId: string, scope?: ParentNode | null): HTMLInputElement | null {
    if (scope && typeof scope.querySelector === 'function') {
        const found = scope.querySelector<HTMLInputElement>(`#${elementId}`);
        if (found) return found;
    }
    return document.getElementById(elementId) as HTMLInputElement | null;
}

export function setFieldError(input: HTMLInputElement, errorId: string, message: string, root?: ParentNode | null): void {
    const errorEl = resolveErrorElement(errorId, root);
    input.setAttribute('aria-invalid', 'true');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('visible');
    }
}

/**
 * フィールドのエラー状態をクリア
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 */
export function clearFieldError(input: HTMLInputElement, errorId: string, root?: ParentNode | null): void {
    const errorEl = resolveErrorElement(errorId, root);
    input.setAttribute('aria-invalid', 'false');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.remove('visible');
    }
}

/**
 * すべてのフィールドエラーをクリア
 * @param {Array.<[HTMLInputElement, string]>} pairs - [input, errorId]の配列
 */
export function clearAllFieldErrors(pairs: ErrorPair[]): void {
    for (const [input, errorId] of pairs) {
        if (input) clearFieldError(input, errorId);
    }
}

/**
 * プロトコルの警告を表示（HTTP選択時のセキュリティ注意喚起）
 * @param {string} message - 警告メッセージ
 */
function showProtocolWarning(message: string): void {
    const warningEl = document.getElementById('protocolWarning');
    if (warningEl) {
        warningEl.textContent = message;
        warningEl.classList.remove('hidden');
    }
}

/**
 * プロトコルの警告をクリア
 */
function clearProtocolWarning(): void {
    const warningEl = document.getElementById('protocolWarning');
    if (warningEl) {
        warningEl.textContent = '';
        warningEl.classList.add('hidden');
    }
}

/**
 * Field-specific DOM work a value-level descriptor cannot express — today only
 * the plaintext-HTTP security note. Keyed by element id so the table keeps one
 * row per field and the shared route stays free of field names; the
 * accept/reject decision and the error element still come from the row.
 */
const FIELD_SIDE_EFFECTS: Readonly<Record<string, (input: HTMLInputElement) => void>> = {
    protocol(input: HTMLInputElement): void {
        clearProtocolWarning();
        if (input.value.trim().toLowerCase() === 'http') {
            showProtocolWarning(getMessage('warningProtocolHttp'));
        }
    },
};

/**
 * Error text for a failed row. Rows without `errorFallback` resolve through
 * getMessage, which returns '' for an untranslated key — an empty error box is
 * the dashboard's display contract, and switching those rows to getMessageOr
 * would print raw key names on untranslated builds.
 */
function resolveErrorMessage(descriptor: FieldDescriptor<unknown>, errorKey: string): string {
    return descriptor.errorFallback === undefined
        ? getMessage(errorKey)
        : getMessageOr(errorKey, descriptor.errorFallback);
}

/**
 * The one validation route for a settings field: parse the raw input, run the
 * table's SSOT validator, then show or clear the table's error element. Blur
 * wiring and the save-time sweep both go through here, so a new table row is
 * validated with no edit in this file.
 */
export function validateDescriptorField(
    descriptor: FieldDescriptor<unknown>,
    input: HTMLInputElement,
    ctx?: ValidationContext,
    root?: ParentNode | null
): boolean {
    FIELD_SIDE_EFFECTS[descriptor.elementId]?.(input);
    const scope = root ?? descriptor.container ?? undefined;
    const errorKey = descriptor.validate(descriptor.parse(input.value), ctx);
    if (errorKey !== null) {
        setFieldError(input, descriptor.errorId, resolveErrorMessage(descriptor, errorKey), scope);
        return false;
    }
    clearFieldError(input, descriptor.errorId, scope);
    return true;
}

/**
 * Blur listener for one descriptor row. `ctx` may be a static context or a
 * thunk resolving it at blur time, so provider-dependent rows always judge
 * with the currently selected provider.
 */
export function setupDescriptorValidation(
    descriptor: FieldDescriptor<unknown>,
    input: HTMLInputElement | null,
    ctx?: ValidationContext | (() => ValidationContext)
): () => void {
    if (!input) return () => {};
    const handler = () => {
        const resolved = typeof ctx === 'function' ? ctx() : ctx;
        validateDescriptorField(descriptor, input, resolved, descriptor.container ?? undefined);
    };
    input.addEventListener('blur', handler);
    return () => input.removeEventListener('blur', handler);
}

/**
 * Row lookup for the element ids the caller hardcodes. A missing row is a table
 * regression, not a runtime condition, so it fails loudly instead of silently
 * dropping the field's blur validation.
 */
function requireDescriptor(elementId: string): FieldDescriptor<unknown> {
    const descriptor = getDescriptorByElementId(elementId);
    if (!descriptor) {
        throw new Error(`fieldDescriptor.ts has no row for element id "${elementId}"`);
    }
    return descriptor;
}

/**
 * Container-scoped blur wiring for the rows the general-settings panel passes by
 * container query. setupAllFieldValidations already reaches them by element id,
 * so a blur can run their validation twice; harmless because a run only writes
 * its own row's error element.
 */
export function setupObsidianHostValidation(input: HTMLInputElement | null): () => void {
    return setupDescriptorValidation(requireDescriptor('obsidianHost'), input);
}

/**
 * Gemini API バージョンフィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export function setupGeminiApiVersionValidation(input: HTMLInputElement | null): () => void {
    return setupDescriptorValidation(requireDescriptor('geminiApiVersion'), input);
}

/**
 * BaseUrlフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {Promise<boolean>} 有効な場合はtrue
 */
export async function validateBaseUrl(input: HTMLInputElement): Promise<boolean> {
    const v = input.value.trim();
    if (!v) {
        // 空文字は許容（デフォルト値が使用される）
        clearFieldError(input, 'baseUrlError');
        return true;
    }

    try {
        new URL(v);

        // ホワイトリストチェック
        const { isDomainInWhitelist, ALLOWED_AI_PROVIDER_DOMAINS } = await import('../../utils/storage/urlWhitelist.js');
        if (!isDomainInWhitelist(v)) {
            const message = `このドメインは許可リストにありません。\n\n` +
                `主要プロバイダー: ${MAJOR_PROVIDERS_HINT.join(', ')}\n` +
                `Sakuraクラウド: ${SAKURA_DOMAINS_HINT.join(', ')}\n` +
                `その他: LiteLLM対応プロバイダー（全${ALLOWED_AI_PROVIDER_DOMAINS.length}ドメイン）`;

            setFieldError(input, 'baseUrlError', message);
            return false;
        }

        clearFieldError(input, 'baseUrlError');
        return true;
    } catch (_e) {
        setFieldError(input, 'baseUrlError', getMessageOr('errorInvalidUrl', 'Invalid URL format'));
        return false;
    }
}

/**
 * Blur validation for the general-settings fields. The caller hands over the
 * nodes it already resolved; matching them by element id keeps container-scoped
 * lookups working, and rows the caller did not supply are looked up by id —
 * which is what makes a newly added table row blur-validated with no line here.
 * The provider id is resolved lazily through `getProviderId` at blur time, so
 * the maxTokens row always judges with the currently selected provider.
 * @returns {Array.<() => void>} リスナー削除関数の配列
 */
export function setupAllFieldValidations(
    protocolInput: HTMLInputElement | null,
    portInput: HTMLInputElement | null,
    minVisitDurationInput?: HTMLInputElement | null,
    minScrollDepthInput?: HTMLInputElement | null,
    maxTokensPerPromptInput?: HTMLInputElement | null,
    getProviderId: () => string = () => ''
): (() => void)[] {
    const supplied = new Map<string, HTMLInputElement>();
    for (const input of [protocolInput, portInput, minVisitDurationInput, minScrollDepthInput, maxTokensPerPromptInput]) {
        if (input?.id) supplied.set(input.id, input);
    }

    const listeners: (() => void)[] = [];
    for (const descriptor of GENERAL_SETTINGS_FIELDS) {
        const input = supplied.get(descriptor.elementId)
            ?? (document.getElementById(descriptor.elementId) as HTMLInputElement | null);
        if (input) listeners.push(setupDescriptorValidation(descriptor, input, () => ({ providerId: getProviderId() })));
    }
    return listeners;
}

/**
 * Save-time validation: every table row whose input is in the DOM, resolved by
 * element id. A new row is swept without an edit here.
 */
export function validateAllFields(ctx?: ValidationContext, root?: ParentNode | null): boolean {
    let hasError = false;
    for (const descriptor of GENERAL_SETTINGS_FIELDS) {
        const scope = root ?? descriptor.container ?? undefined;
        const input = resolveInputElement(descriptor.elementId, scope);
        if (input && !validateDescriptorField(descriptor, input, ctx, scope)) hasError = true;
    }
    return !hasError;
}
