# レビュー所見と対処計画

Checking Teamによるコードレビューで発見された問題と、それらに対する対処計画です。

## レビュー概要

| 専門家 | 重要度 | 所見数 | 進捗 |
|--------|--------|--------|------|
| **Red Team** | Critical 1, High 4, Medium 1, Low 2 | 8件 | 4/8完了 |
| **Blue Team** | 修正必須 | 3件 | 3/3完了 |
| **Domain Logic** | 実装ミス 2, 不整合 3 | 5件 | 1/5完了 |
| **Maintainability** | TODO 15 | 15件 | 未着手 |
| **Performance** | 改善案 | 4件 | 未着手 |
| **UI/UX** | 改善推奨 | 数件 | 未着手 |
| **Accessibility** | 改善推奨 | 数件 | 未着手 |
| **i18n** | 改善推奨 | 数件 | 未着手 |

## 対応状況サマリー

| ID | 課題 | 重要度 | ステータス |
|----|------|--------|-----------|
| #1 | 暗号化キーのディープフィックス化 | Critical | ⏳ 実装予定 |
| #2 | 設定インポートの署名検証欠如 | High | ⏳ 実装予定 |
| #3 | 動的URL許可リストへの攻撃者入力許容 | High | ⏳ 実装予定 |
| #2+ | エクスポートからAPIキー除外 | High | ⏳ 実装予定 |
| #4 | BaseUrl SSRF検証なし | High | ✅ 完了 |
| #5 | プロンプトインジェクション対策 | High | ✅ 完了 |
| #6 | CSP制限 | High | ✅ 完了 |
| #7 | PII Sanitizer過剰一致 | Medium | 🟡 未着手 |
| #8 | 日付ベース重複チェック | Medium | ✅ 完了 |

---

## 重要度別対処計画

### 🚨 Critical - 即時対応

#### 1. 暗号化キーのインメモリ永続化問題
- **場所**: `/src/utils/storage.js:99-105`
- **問題**: PBKDF2鍵導出用シークレットがBase64エンコードされた状態でchrome.storage.localに平文保存されている
- **影響**: 暗号化が実質的に無効化、APIキー漏洩リスク
- **対処**:
  - シークレットをストレージに保存せず、ユーザーパスワードに基づくPBKDF2に移行（大幅な設計変更）
  - または、キーをService Worker内でのみ保持（再起動時に再要求）
- **ステータス**: 🟡 未着手

---

### ⚠️ High - 優先対応

#### 2. 設定インポートの署名検証欠如
- **場所**: `/src/utils/settingsExportImport.js:57-96`
- **問題**: JSON構造検証のみ、署名検証なし
- **対処**:
  - Ed25519等で署名検証導入（設計必要）
  - またはHMAC-SHA256で改ざん検知
  - ユーザー認証なしの設定インポートに警告表示
- **ステータス**: 🟡 未着手

#### 3. 動的URL許可リストへの攻撃者入力許容
- **場所**: `/src/utils/storage.js:376-416` (buildAllowedUrls)
- **問題**: ユーザー入力の `openai_base_url` を無検証で許可リストに追加
- **対処**:
  - 決定済ホワイトリスト方式採用
  - または設定変更時の完全なドメイン検証 + ユーザー警告
- **ステータス**: 🟡 未着手

#### 4. BaseUrl SSRF検証なし
- **場所**: `OpenAIProvider.js:17,33`
- **問題**: ユーザー設定baseUrlが直接使用、SSRF検証なし
- **対処**: baseUrlに対して既存のSSRF検証を適用
- **ステータス**: ✅ 完了 (2026-02-14)
- **実装内容**:
  - `src/utils/fetch.js` に `validateUrlForAIRequests()` 追加
  - `OpenAIProvider.js` のコンストラクタでbaseUrl検証
  - `GeminiProvider.js` の `testConnection()` でURL検証
  - `src/popup/settings/fieldValidation.js` に `validateBaseUrl()` 追加

#### 5. プロンプトインジェクションによるAI操作（High）
- **場所**: `GeminiProvider.js:36-40`, `OpenAIProvider.js:44-49`
- **問題**: Webページから抽出されたコンテンツを無加工でAIプロンプトに組み込み
- **悪用シナリオ**:
  - ページに埋め込まれた「Ignore above instructions」等のAIコマンド注入
  - AI経由のセッション情報収集、APIキー漏洩
- **対処**:
  - AIプロンプトに組み込むコンテンツのサニタイズ
  - 特殊文字と制御文字の除去/エスケープ
  - 大文字小文字ミスマッチ等のインジェクションパターン検知
- **ステータス**: ✅ 完了 (2026-02-14)
- **実装内容**:
  - `src/utils/promptSanitizer.js` 新規作成
  - `sanitizePromptContent()` 関数によるインジェクションパターン検出と除外
  - 危険度レベル判定 (safe/low/medium/high)
  - `GeminiProvider.js` および `OpenAIProvider.js` でサニタイザ適用

#### 6. CSP制限（High）
- **場所**: `manifest.json:7`
- **問題**: connect-srcが事実上全ての外部リクエストを許容
- **対処**: 最小限のドメインに制限
- **ステータス**: ✅ 完了 (2026-02-14)
- **実装内容**:
  - `manifest.json` の CSP `connect-src` を最小限のドメインに制限
  - 許可ドメイン: `api.anthropic.com`, `api-inference.huggingface.co`, `openrouter.ai`, `api.openrouter.ai`, `*.sakuraha.jp`, `*.sakura.ad.jp`

---

## 詳細対処手順

### ✅ #4: BaseUrl SSRF対策（High）

**【完了】** 実装済み (2026-02-14)

**実装内容:**
1. `src/utils/fetch.js` に `validateUrlForAIRequests()` を新規追加
   - プロトコル検証、プライベートIPアドレス検証
   - Internetworkアクセスのみ許可（localhostはAIプロバイダー用に特別許可）
2. `OpenAIProvider.js` のコンストラクタでbaseUrl検証追加
3. `GeminiProvider.js` の `testConnection()` でテストURL検証追加
4. `src/popup/settings/fieldValidation.js` に `validateBaseUrl()` 追加

---

### ✅ #5: プロンプトインジェクション対策（High）

**【完了】** 実装済み (2026-02-14)

**実装内容:**
1. `src/utils/promptSanitizer.js` 新規作成
   - インジェクションパターン検出 (ignore, disregard, instead, etc.)
   - 危険な制御文字の除去
   - HTMLエンティティのエスケープ
   - 危険度レベル判定 (safe/low/medium/high)
2. `GeminiProvider.js` の `generateSummary()` でサニタイザ適用
3. `OpenAIProvider.js` の `generateSummary()` でサニタイザ適用

---

### ✅ #6: CSP制限（High）

**【完了】** 実装済み (2026-02-14)

**実装内容:**
1. `manifest.json` の `content_security_policy` を修正
2. `connect-src` を以下のドメインに制限:
   - AIプロバイダー: `generativelanguage.googleapis.com`, `api.groq.com`, `api.openai.com`, `api.anthropic.com`, `api-inference.huggingface.co`, `openrouter.ai`, `api.openrouter.ai`
   - Sakuraクラウド: `*.sakuraha.jp`, `*.sakura.ad.jp`
   - 本体通信: `https://127.0.0.1:*`, `http://127.0.0.1:*`, `https://localhost:*`, `http://localhost:*`
   - 拡張機能リソース: `chrome-extension:`

---

### ✅ #8: 日付ベース重複チェック実装（Medium）

**【完了】** 実装済み (2026-02-14)

**実装内容:**
1. `src/utils/storage.js` に `setSavedUrlsWithTimestamps()` 新規追加
   - Map<URL, timestamp> でタイムスタンプ管理
   - LRUエビクション維持
2. `src/background/recordingLogic.js` の重複チェックロジック更新:
   - `getSavedUrlsWithCache()` が Map<URL, timestamp> を返すように変更
   - 同じURLかつ同日の場合のみスキップ（年/月/日で比較）
   - 別日の場合は古いタイムスタンプを上書き
3. `addSavedUrl()` も日付ベース対応

---

### 🚨 #1: 暗号化キーのディープフィックス化（Critical）

**問題分析:**
- PBKDF2シークレット（32バイトランダム値）がBase64エンコードで平文保存
- 物理アクセスがある攻撃者によりAPIキーが復号可能
- Chrome Extensionのアーキテクチャ上、ストレージから秘密値を完全に排除することは困難

**採用アプローチ: chrome.runtime.idによるディープフィックス**

chrome.runtime.idをキー導出に組み込むことで、攻撃者がシークレットを抽出しても：
- 同じ拡張機能IDを持つ環境でしか復号できない
- 異なるブラウザやプロファイルのデータは相互運用不可能
- Secret抽出と復号の二重ハードルを実現

**実装手順:**

**Phase 1: キー導出の変更 (`src/utils/crypto.js`)**
```javascript
// 新規追加関数: chrome.runtime.idの使用を許可
export function getExtensionId() {
    return chrome.runtime.id;
}

// 既存のderiveKey関数の後ろに、ID付きキー導出を追加
export async function deriveKeyWithExtensionId(secret, salt, extensionId) {
    // secret + salt + extensionId を組み合わせてキー導出
    const combined = new TextEncoder().encode(secret + ':' + extensionId);
    return deriveKey(combined.toString('base64'), salt);
}
```

**Phase 2: storage.jsの更新 (`src/utils/storage.js`)**

1. `ENCRYPTION_SECRET` ストレージキーは維持（extensionの限界として認識）
2. `getOrCreateEncryptionKey()` 関数を更新：

```javascript
let cachedEncryptionKey = null;
let cachedExtensionId = null;

export async function getOrCreateEncryptionKey() {
    if (cachedEncryptionKey) {
        return cachedEncryptionKey;
    }

    // 現在のextension IDを取得
    const extensionId = chrome.runtime.id;

    // Extension ID変更時に再生成（通常は発生しないが安全策）
    if (cachedExtensionId && cachedExtensionId !== extensionId) {
        cachedEncryptionKey = null;
    }
    cachedExtensionId = extensionId;

    const result = await chrome.storage.local.get([
        StorageKeys.ENCRYPTION_SALT,
        StorageKeys.ENCRYPTION_SECRET
    ]);

    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT];
    let secret = result[StorageKeys.ENCRYPTION_SECRET];

    if (!saltBase64 || !secret) {
        const salt = generateSalt();
        saltBase64 = btoa(String.fromCharCode(...salt));
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));

        await chrome.storage.local.set({
            [StorageKeys.ENCRYPTION_SALT]: saltBase64,
            [StorageKeys.ENCRYPTION_SECRET]: secret
        });
    }

    const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
    // ID付きキー導出を使用
    cachedEncryptionKey = await deriveKeyWithExtensionId(secret, salt, extensionId);
    return cachedEncryptionKey;
}
```

**Phase 3: 既存データの再暗号化**

初期化時に、extension IDが変更されている場合または初回起動時に：
- 既存の暗号化データを検出
- 新しい暗号化キーで再暗号化
- キャッシュ済みデータを更新

**影響:**

| メリット | デメリット |
|---------|-----------|
| Extension IDがないと復号不可能 | chrome.runtime.idの取得に依存 |
| 異なる環境間のデータ分離 | Extension ID変更時にデータ移行必要 |
| 既存暗号化のセキュリティ強化 | 完全なセキュリティではない（ストレージは脆弱） |

**テスト:**
- Extension ID変更時の動作確認
- 既存データの復号正常性確認
- 新規暗号化・復号の正常性確認

---

### ⚠️ #2: 設定インポートの署名検証欠如（High）

**問題分析:**
- JSON構造検証のみ
- 改ざん検知不可、悪意設定インポート可能

**採用アプローチ: HMAC-SHA256改ざん検知**

**実装手順:**

**Phase 1: HMAC-SHA256実装 (`src/utils/crypto.js`)**

```javascript
/**
 * HMAC-SHA256を使用してハッシュを計算する
 * @param {string} secret - 共有シークレット
 * @param {string} message - メッセージ
 * @returns {Promise<string>} Base64エンコードされたHMACハッシュ
 */
export async function computeHMAC(secret, message) {
    const webcrypto = getWebCrypto();
    const encoder = new TextEncoder();

    const secretKey = await webcrypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await webcrypto.subtle.sign(
        'HMAC',
        secretKey,
        encoder.encode(message)
    );

    const signatureArray = Array.from(new Uint8Array(signature));
    return btoa(String.fromCharCode(...signatureArray));
}
```

**Phase 2: HmacSecretの生成・保存 (`src/utils/storage.js`)**

```javascript
export const StorageKeys = {
    // ... 既存キー
    HMAC_SECRET: 'hmac_secret', // 追加
};

let cachedHmacSecret = null;

async function getOrCreateHmacSecret() {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }

    const result = await chrome.storage.local.get([StorageKeys.HMAC_SECRET]);
    let secret = result[StorageKeys.HMAC_SECRET];

    if (!secret) {
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));
        await chrome.storage.local.set({
            [StorageKeys.HMAC_SECRET]: secret
        });
    }

    cachedHmacSecret = secret;
    return secret;
}
```

**Phase 3: エクスポート時の署名追加 (`src/utils/settingsExportImport.js`)**

```javascript
export async function exportSettings() {
  const settings = await getSettings();
  const exportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };

  const json = JSON.stringify(exportData, null, 2);

  // HMAC署名を計算
  const { computeHMAC } = await import('./crypto.js');
  const { getOrCreateHmacSecret } = await import('./storage.js');
  const hmacSecret = await getOrCreateHmacSecret();
  const signature = await computeHMAC(hmacSecret, json);

  // 署名付きエクスポートデータ
  const signedExportData = {
    ...exportData,
    signature,
  };

  const signedJson = JSON.stringify(signedExportData, null, 2);
  const blob = new Blob([signedJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = getExportFilename();
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

**Phase 4: インポート時の署名検証 (`src/utils/settingsExportImport.js`)**

```javascript
export async function importSettings(jsonData) {
  try {
    const parsed = JSON.parse(jsonData);

    // 署名があるかチェック
    if (!parsed.signature) {
      console.warn('Imported settings has no signature. Proceeding without verification.');
      // 旧形式のエクスポートファイルとの互換性のため、署名検証なしで続行
    } else {
      // 署名検証
      const { computeHMAC } = await import('./crypto.js');
      const { getOrCreateHmacSecret } = await import('./storage.js');
      const hmacSecret = await getOrCreateHmacSecret();

      // 署名を除いてハッシュ計算
      const { signature, ...dataForVerification } = parsed;
      const dataJson = JSON.stringify(dataForVerification, null, 2);

      const computedSignature = await computeHMAC(hmacSecret, dataJson);

      if (signature !== computedSignature) {
        console.error('Signature verification failed. Settings may have been tampered with.');
        alert('設定ファイルの署名検証に失敗しました。ファイルが改ざんされている可能性があります。');
        return null;
      }
    }

    // 構造検証（既存のvalidateExportDataを使用）
    if (!validateExportData(parsed)) {
      return null;
    }

    await saveSettings(parsed.settings);
    return parsed.settings;
  } catch (error) {
    console.error('Failed to import settings:', error);
    return null;
  }
}
```

**影響:**
- 署名があるファイルは改ざん検知が可能
- 署名がない旧形式のファイルはそのままインポート可能（後方互換性）
- HMAC SecretはAPIキーと同様に保護が必要

---

### ⚠️ #2+: エクスポートからAPIキーを除外（High）

**問題分析:**
- 現在のエクスポート機能はAPIキーを平文で含む
- エクスポートファイルが漏洩するとAPIキーが流出する

**実装手順:**

**Phase 1: APIキーフィールドの除外 (`src/utils/settingsExportImport.js`)**

```javascript
// APIキーフィールドのリストを定義
const API_KEY_FIELDS = [
    'obsidian_api_key',
    'gemini_api_key',
    'openai_api_key',
    'openai_2_api_key',
];

/**
 * APIキーフィールドを除外した設定を取得する
 * @param {object} settings - 元の設定
 * @returns {object} APIキーが除外された設定
 */
function sanitizeSettingsForExport(settings) {
    const { [StorageKeys.ENCRYPTION_SALT]: _, [StorageKeys.ENCRYPTION_SECRET]: __, ...sanitized } = settings;

    for (const field of API_KEY_FIELDS) {
        delete sanitized[field];
    }

    return sanitized;
}

export async function exportSettings() {
  const settings = await getSettings();

  // APIキーを除外した設定でエクスポート
  const sanitizedSettings = sanitizeSettingsForExport(settings);

  const exportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: sanitizedSettings,
    // APIキー除外フラグを追加
    apiKeyExcluded: true,
  };

  const json = JSON.stringify(exportData, null, 2);
  // ... 以降は既存の実装
}
```

**Phase 2: インポート時のAPIキー処理 (`src/utils/settingsExportImport.js`)**

```javascript
export async function importSettings(jsonData) {
  try {
    const parsed = JSON.parse(jsonData);

    // 署名検証（Phase 4の実装）

    // 構造検証
    if (!validateExportData(parsed)) {
      return null;
    }

    // APIキーが除外されている場合、インポートしない
    if (parsed.apiKeyExcluded) {
      console.info('Imported settings have API keys excluded. Existing API keys will be preserved.');
      // 既存の設定を取得し、APIキーのみ維持
      const existingSettings = await getSettings();
      const { obsidian_api_key, gemini_api_key, openai_api_key, openai_2_api_key, ...imported } = parsed.settings;
      const merged = {
        ...imported,
        obsidian_api_key: existingSettings.obsidian_api_key,
        gemini_api_key: existingSettings.gemini_api_key,
        openai_api_key: existingSettings.openai_api_key,
        openai_2_api_key: existingSettings.openai_2_api_key,
      };
      await saveSettings(merged);
      return merged;
    }

    await saveSettings(parsed.settings);
    return parsed.settings;
  } catch (error) {
    console.error('Failed to import settings:', error);
    return null;
  }
}
```

**影響:**
- エクスポートファイルからAPIキーが除外される
- インポート時、既存のAPIキーは維持される
- ユーザーはAPIキーを手動で再入力する必要がある

---

### ⚠️ #3: 動的URL許可リストへの攻撃者入力許容（High）

**問題分析:**
- ユーザー入力の `openai_base_url` を無検証で許可リストに追加
- SSRF攻撃経由となる

**採用アプローチ: 決定済ホワイトリスト方式（拡張版）**

**実装手順:**

**Phase 1: ホワイトリスト定数の追加 (`src/utils/storage.js`)**

```javascript
// 許可するAIプロバイダードメインのホワイトリスト
// 参照: LiteLLM providers.json https://github.com/BerriAI/litellm/blob/main/litellm/llms/openai_like/providers.json
export const ALLOWED_AI_PROVIDER_DOMAINS = [
    // メジャーAIプロバイダー
    'generativelanguage.googleapis.com',   // Google Gemini
    'api.groq.com',                          // Groq
    'api.openai.com',                        // OpenAI公式
    'api.anthropic.com',                     // Anthropic Claude
    'api-inference.huggingface.co',          // Hugging Face
    'openrouter.ai',                         // OpenRouter
    'api.openrouter.ai',                     // OpenRouter API
    'mistral.ai',                            // Mistral AI
    'deepinfra.com',                         // DeepInfra
    'cerebras.ai',                           // Cerebras

    // APIゲートウェイ
    'ai-gateway.helicone.ai',                // Helicone

    // LiteLLMサポートプロバイダー
    'api.publicai.co',                       // PublicAI
    'api.venice.ai',                         // Venice AI
    'api.scaleway.ai',                       // Scaleway
    'api.synthetic.new',                     // Synthetic
    'api.stima.tech',                        // Apertis (Stima API)
    'nano-gpt.com',                          // Nano-GPT
    'api.poe.com',                           // Poe
    'llm.chutes.ai',                         // Chutes
    'api.abliteration.ai',                   // Abliteration
    'api.llamagate.dev',                     // LlamaGate
    'api.gmi-serving.com',                   // GMI Cloud
    'api.sarvam.ai',                         // Sarvam AI
    'deepseek.com',                          // DeepSeek
    'xiaomimimo.com',                        // Xiaomi MiMo

    // クラウドネイティブAI
    'nebius.com',                            // Nebius AI
    'sambanova.ai',                          // SambaNova
    'nscale.com',                            // Nscale
    'featherless.ai',                        // Featherless AI
    'galadriel.com',                         // Galadriel
    'perplexity.ai',                         // Perplexity AI
    'recraft.ai',                            // Recraft

    // 埋込みAI
    'jina.ai',                               // Jina AI
    'voyageai.com',                          // Voyage AI

    // その他
    'volcengine.com',                        // Volcano Engine (bytedance)
    'z.ai',                                  // ZHIPU AI
    'wandb.ai',                              // Weights & Biases

    // Sakuraクラウドドメイン
    'sakuraha.jp',                           // Sakuraクラウド（任意サブドメイン）
    'sakura.ad.jp',                          // Sakuraクラウド（任意サブドメイン）

    // ローカル環境（開発用）
    'localhost',
    '127.0.0.1',
];

/**
 * ドメインがホワイトリストに含まれるかチェックする
 * @param {string} url - チェック対象のURL
 * @returns {boolean} 許可される場合true
 */
export function isDomainInWhitelist(url) {
    try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;

        // 完全一致チェック
        if (ALLOWED_AI_PROVIDER_DOMAINS.includes(hostname)) {
            return true;
        }

        // ワイルドカードチェック（*.sakuraha.jp 等）
        for (const allowedDomain of ALLOWED_AI_PROVIDER_DOMAINS) {
            if (allowedDomain.startsWith('*.')) {
                const domainSuffix = allowedDomain.substring(2);
                if (hostname === domainSuffix || hostname.endsWith('.' + domainSuffix)) {
                    return true;
                }
            }
        }

        return false;
    } catch (e) {
        return false;
    }
}
```

**Phase 2: buildAllowedUrls() の更新 (`src/utils/storage.js`)**

```javascript
export function buildAllowedUrls(settings) {
    const allowedUrls = new Set();

    // Obsidian API
    const protocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] || 'http';
    const port = settings[StorageKeys.OBSIDIAN_PORT] || '27123';
    allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));

    // Gemini API
    allowedUrls.add('https://generativelanguage.googleapis.com');

    // OpenAI互換API - ホワイトリストチェック
    const openaiBaseUrl = settings[StorageKeys.OPENAI_BASE_URL];
    if (openaiBaseUrl) {
        if (isDomainInWhitelist(openaiBaseUrl)) {
            const normalized = normalizeUrl(openaiBaseUrl);
            allowedUrls.add(normalized);
        } else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }

    const openai2BaseUrl = settings[StorageKeys.OPENAI_2_BASE_URL];
    if (openai2BaseUrl) {
        if (isDomainInWhitelist(openai2BaseUrl)) {
            const normalized = normalizeUrl(openai2BaseUrl);
            allowedUrls.add(normalized);
        } else {
            console.warn(`OpenAI 2 Base URL not in whitelist, skipped: ${openai2BaseUrl}`);
        }
    }

    // uBlock Filter Sources
    const ublockSources = settings[StorageKeys.UBLOCK_SOURCES] || [];
    for (const source of ublockSources) {
        if (source.url && source.url !== 'manual') {
            try {
                const parsed = new URL(source.url);
                allowedUrls.add(normalizeUrl(parsed.origin));
            } catch (e) {
                // 無効なURLは無視
            }
        }
    }

    return allowedUrls;
}
```

**Phase 3: UIへの警告追加 (`src/popup/settings/fieldValidation.js`)**

```javascript
export async function validateBaseUrl(input) {
    const v = input.value.trim();
    if (!v) {
        clearFieldError(input, 'baseUrlError');
        return true;
    }

    try {
        new URL(v);

        // ホワイトリストチェック
        const { isDomainInWhitelist, ALLOWED_AI_PROVIDER_DOMAINS } = await import('../../utils/storage.js');
        if (!isDomainInWhitelist(v)) {
            // メジャープロバイダーとワイルドカードドメインを重点表示
            const majorProviders = [
                'api.openai.com', 'api.anthropic.com', 'api.groq.com',
                'openrouter.ai', 'mistral.ai', 'deepinfra.com'
            ];
            const wildcardDomains = ['*.sakuraha.jp', '*.sakura.ad.jp'];

            const message = `このドメインは許可リストにありません。\n\n` +
                `主要プロバイダー: ${majorProviders.join(', ')}\n` +
                `Sakuraクラウド: ${wildcardDomains.join(', ')}\n` +
                `その他: LiteLLM対応プロバイダー（全${ALLOWED_AI_PROVIDER_DOMAINS.length}ドメイン）`;

            setFieldError(input, 'baseUrlError', message);
            return false;
        }

        clearFieldError(input, 'baseUrlError');
        return true;
    } catch (e) {
        setFieldError(input, 'baseUrlError', getMessage('errorInvalidUrl'));
        return false;
    }
}
```

**影響:**
- ホワイトリスト外のURLは許可リストに追加されない
- SSRF攻撃のリスク低減
- カスタムAIプロバイダーの使用には制限

**テスト:**
- 各ホワイトリストドメインの正常動作確認
- ホワイトリスト外ドメインの拒否確認
- ワイルドカードドメインのマッチング確認

---

### 🟡 #7: PIIパターン改善（Medium）

**対処:**

**実装手順:**
1. `piiSanitizer.js:31-34` のパターン修正
2. 単純な数字ではなく、文脈を考慮したパターン実装
3. 偽陽性統計収集機能追加
4. ユニットテスト更新

---

### 🟡 Medium - 中期対応

#### 7. PII Sanitizer過剰一致
- **場所**: `/src/utils/piiSanitizer.js:31-34`
- **問題**: `/\b\d{7}\b/` で単純な7桁数字全てを銀行口座と誤判定
- **対処**: PIIパターンをより具体的に
- **ステータス**: 🟡 未着手

#### 8. 日付ベースの重複チェック未実装
- **場所**: `src/background/recordingLogic.js:150-152`, `src/utils/storage.js:263-266`
- **問題**: 仕様「同じページは1日1回のみ」に対し、実装は永遠に重複扱い
- **対処**: 日付ベースのTTLまたは履歴管理実装
- **ステータス**: ✅ 完了 (2026-02-14)

---

### 🟢 Low / Improvement - 長期対応

#### 9. Maintainability 問題
- 15件の「TODO: 実装後に有効化」テスト
- popup.jsのconsole.log削除
- 非推奨メソッド削除計画
- 循環依存回避見直し

#### 10. Performance 改善
- getAllowedUrls()キャッシュ追加
- Loggerバッチ書き込み実装

#### 11. Accessibility 改善
- h1見出し追加
- ドロップダウンフォーカストラップ

#### 12. i18n 改善
- 英語サポート追加

---

## 並列実行可能なタスク

### 第一フェーズ（critical/high）

1. ✅ **BaseUrl SSRF検証追加** - 完了 (2026-02-14)
2. ✅ **CSP制限緩和** - 完了 (2026-02-14)
3. ✅ **プロンプトInjection対策** - 完了 (2026-02-14)
4. ✅ **日付ベース重複チェック実装** - 完了 (2026-02-14)
5. ⏳ **暗号化キーにruntime.idを組み込む** - 実装予定 (Critical)
6. ⏳ **設定インポートの署名検証** - 実装予定 (High)
7. ⏳ **エクスポートからAPIキーを除外** - 実装予定 (High)
8. ⏳ **動的URL許可リストのホワイトリスト化** - 実装予定 (High)

### 第二フェーズ（medium）

1. **PIIパターン改善** - piiSanitizer.jsの修正

### 第三フェーズ（low/improvement）

1. **TODOテスト対応**
2. **console.log削除**
3. **アーキテクチャ改善項目**

---

## 依存関係図

```
Critical
├── 暗号化キー改善（runtime.id）─┐
│                            │ 依存関係なし
High                          │
├── BaseUrl SSRF ────────────┘ ✅ 完了
├── CSP制限 ─────────────────┘ ✅ 完了
├── プロンプトInjection ──────┘ ✅ 完了
├── 動的URL許可（ホワイトリスト）
├── 設定インポート署名
└── エクスポートAPIキー除外

Medium
├── PIIパターン
└── 日付ベース重複 ─────────────┘ ✅ 完了

Low
├── TODO対応
├── console.log削除
├── Performance
├── Accessibility
└── i18n
```

---

## 進捗サマリー (2026-02-14)

### 完了済み
- ✅ BaseUrl SSRF対策 (High)
- ✅ CSP制限修正 (High)
- ✅ プロンプトインジェクション対策 (High)
- ✅ 日付ベース重複チェック実装 (Medium)

### 実装プラン作成済み
- ⏳ 暗号化キーのディープフィックス化（chrome.runtime.id導入）(Critical)
- ⏳ 設定インポートの署名検証 (HMAC-SHA256) (High)
- ⏳ エクスポートからAPIキーを除外 (High)
- ⏳ 動的URL許可リストのホワイトリスト化（拡張版）(High)

### 未着手
- 🟡 PIIパターン改善 (Medium)
- 🟡 Maintainability改善 (TODO 15件)
- 🟡 Performance改善
- 🟡 Accessibility改善
- 🟡 i18n改善

**全体進捗: 4/8 High優先項目完了 (50%)、残り4件の実装プラン作成済み**