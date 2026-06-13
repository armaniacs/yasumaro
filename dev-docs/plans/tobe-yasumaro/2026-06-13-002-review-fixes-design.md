# Review Fixes Design — tobe-yasumaro レビュー指摘対応

**作成日:** 2026-06-13
**ステータス:** 承認済み
**親ドキュメント:** [plans/2026-06-13-1112-review-tobe-yasumaro.md](../../../plans/2026-06-13-1112-review-tobe-yasumaro.md)
**対象レビュー結果:** 22エージェント / 総合スコア 68.9 (ランク C) / High 31件 + Medium 36件

---

## 1. 目的 / Goals

1. レビューで検出された **High 31件 / Medium 36件 / Low 0件** を全件解消する
2. **データ損失・セキュリティ・後方互換性**の問題をリリースブロッカーとして最優先解消する
3. 並走で 8 トラックの通常改善を進め、総合スコアを **C (68.9) → A (80+) 以上**に引き上げる
4. 既存のモジュール構造を最大限尊重し、**新ファイル追加より既存ファイル内の修正**を優先する

## 2. 非目的 / Non-Goals

- 新機能の追加（今回のスコープは**レビュー指摘の修正のみ**）
- 既存ドキュメントの大幅な書き直し（N6 トラックの範囲内を除く）
- Chrome Web Store への公開作業（リリース準備は別 PBI）

## 3. スコープと優先順位

### 3.1 Hotfix（緊急・7項目）— 次 v5.x.0 リリース前に必須

| ID | 項目 | 担当エージェント指摘 |
|---|---|---|
| H1 | `msgOffscreen` の `setTimeout` 二重解決/リーク修正 | Domain Logic / System Architect / Tuning |
| H2 | `migrate`/`clear_all` の認証化（confirmToken + 確認モーダル） | Red Team / Test Experts / SRE |
| H3 | 暗号鍵導出の version header 化＋`getOrCreateEncryptionKey` 集約 | Legacy Bridge / Blue Team |
| H4 | レート制限の `chrome.storage.session` 仕様確認＋必要なら `local` へ昇格 | Red Team |
| H5 | データストア二重化の Optimistic Lock 適用（旧ストア読み取り専用化） | System Architect / Data Integrity / Maintainability |
| H6 | `OPFS_FALLBACK.md` リネーム + 冒頭概要明記 + 参照更新 | Documentation |
| H7 | `cspStyleUtils` の CSS エスケープ（`setElementColor`/`setElementWidth`） | Red Team / Blue Team |

### 3.2 通常トラック（並走 8 トラック）— 次マイナーバージョンまでに順次

| ID | トラック | 解消対象 |
|---|---|---|
| N1 | **i18n 漏れ修正** | `cleansingStatsView.ts`、`sqliteHistoryPanel.ts` のハードコード文字列、翻訳キー追加 |
| N2 | **アクセシビリティ** | サイドバーの ARIA tabs パターン、スピナーの `aria-live`、`window.confirm` 脱却 |
| N3 | **パフォーマンス** | `insertBatch` prepared-statement キャッシュ、`MigrationService` のバッチごと storage 書き込み最適化、`cachedTriggers` の `storage.onChanged` 連動 |
| N4 | **観測容易性** | 構造化ログの全面適用、SQLite 障害アラートパス、`addLog` 規約統一 |
| N5 | **リファクタ** | `errorMessage()` 全面適用、`setTimeout` リーク撲滅、`getOrCreateEncryptionKey` 集約（Hotfix 後にリファクタ）、`wa-sqlite` 重複解消 |
| N6 | **ドキュメント全面置換** | 旧ブランド名 `yasumaro` への置換、`OPFS_FALLBACK.md` リネーム（Hotfix 後に正式反映）、ブログ・PBI 整理 |
| N7 | **PII サニタイズ強化** | `manualContentFetcher` の PII サニタイズ統合、地域バイアス解消、PRIVACY.md 保持期間実装 |
| N8 | **設定/保持/コスト** | 設定エクスポート確認強化、OpenAI content limit 調整、FTS5 インデックス評価、Obsidian 同期のバッチ化 |

## 4. アーキテクチャ判断

### 4.1 既存構造の尊重
- 新ファイル追加は **H3 鍵集約** のみ
- H1〜H7 すべて、既存ファイル内の関数修正で完結
- N1〜N8 は各々 1〜3 ファイルの局所的修正

### 4.2 呼び出しフロー（H2 認証化後）

```
[Dashboard UI]
  ↓ ユーザー操作（ボタンクリック + 確認モーダル）
  ↓ confirmToken 自動付与
chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', subtype: 'clear_all', confirmToken })
  ↓
service-worker.ts (chrome.runtime.onMessage)
  ↓
dashboardSqliteHandlers.ts (H2 修正後)
  ├ confirmToken 検証 (H2)
  ├ ログ記録 (N4)
  ├ sqliteClient.clearAll() (H1 修正後経由)
  │   ↓
  │   msgOffscreen → offscreen.ts → sqlite.ts (H1 修正後)
  │   ↓
  │   withOptimisticLock → SQLite WAL (H5)
  │   ↓
  │   バックアップ .bak 作成 (H5)
  └ 結果を返す
```

### 4.3 H3 鍵集約後の構造

```
[Before]
src/utils/storage.ts          → getOrCreateEncryptionKey (旧)
src/utils/storageEncrypted.ts → getOrCreateEncryptionKey (新・重複)
src/utils/crypto.ts           → (既存)

[After]
src/utils/crypto.ts           → 単一の getOrCreateEncryptionKey(versioned)
                                EncryptionEnvelope { version, salt, iterations, hash, data }
src/utils/storage.ts          → crypto.ts へ re-export（後方互換）
src/utils/storageEncrypted.ts → 削除（c2: 削除）
```

## 5. Hotfix 詳細設計

### 5.1 H1: `msgOffscreen` タイムアウト修正

**ファイル:** `src/background/sqliteClient.ts`

**設計:**
```typescript
async msgOffscreen(type, payload = {}): Promise<OffscreenResponse> {
  try {
    await this.ensureOffscreenDocument();
    return await new Promise<OffscreenResponse>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Offscreen message '${type}' timed out after ${MESSAGE_TIMEOUT_MS}ms`));
      }, MESSAGE_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        { type, target: 'offscreen', payload },
        (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);  // ← 追加
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        }
      );
    });
  } catch (error) {
    this.offscreenAlive = false;
    throw error;
  }
}
```

**テストケース:**
- 正常応答時に `setTimeout` が `clearTimeout` される
- 10秒タイムアウト時に reject される
- 応答が返った後に `setTimeout` が発火しても二重解決しない
- offscreen クラッシュ時に reject される

### 5.2 H2: `migrate`/`clear_all` 認証化

**ファイル:** `src/background/handlers/dashboardSqliteHandlers.ts` + `src/background/service-worker.ts` + `src/dashboard/sqliteHistoryPanel.ts`（確認モーダル）

**設計:**

1. service-worker 起動時に `confirmToken = crypto.randomUUID()` を生成し `chrome.storage.session` に保存
2. ダッシュボード UI からのメッセージに `confirmToken` を自動付与
3. ハンドラ側で `confirmToken` 不一致なら `success: false, error: 'Confirmation token mismatch'`
4. `clear_all` サブタイプの場合、**ダッシュボード UI で確認モーダル**を必ず表示（既存の `window.confirm` をやめて、N2 のアクセシブルなモーダルに置換）

**許可サブタイプと認証要件:**

| サブタイプ | 認証 | 確認モーダル |
|---|---|---|
| `query` / `search` / `get_count` / `status` | 不要 | 不要 |
| `toggle_star` | 必要 | 不要 |
| `update` | 必要 | 不要 |
| `delete` | 必要 | 必要 |
| `migrate` | 必要 | 必要 |
| `clear_all` | 必要 | 必要（既存ユーザー履歴が全削除） |

### 5.3 H3: 鍵導出 version header 化

**ファイル:** `src/utils/crypto.ts`（集約先）+ `src/utils/storage.ts`（re-export のみ）+ `src/utils/storageEncrypted.ts`（削除）

**設計:**

```typescript
// 既存: string ベースの単一鍵
// 新規: versioned envelope

interface EncryptionEnvelope {
  version: 1 | 2;
  kdf: 'pbkdf2';
  hash: 'SHA-256' | 'SHA-512';
  iterations: number;
  salt: string;  // base64
  iv: string;    // base64
  data: string;  // base64 ciphertext
}

const CURRENT_VERSION = 2;
const DEFAULT_ITERATIONS_V2 = 600_000;
const DEFAULT_HASH_V2 = 'SHA-256';

export async function getOrCreateEncryptionKey(
  masterPassword: string
): Promise<{ key: CryptoKey; version: number; needsMigration: boolean }>;

export async function decryptEnvelope(
  envelope: EncryptionEnvelope,
  masterPassword: string
): Promise<string>;

export async function encryptEnvelope(
  plaintext: string,
  masterPassword: string,
  version?: number
): Promise<EncryptionEnvelope>;
```

**マイグレーション手順:**
1. 旧 storage キーに保存された「生 ciphertext」を検出
2. 旧パラメータ（iterations=100_000, hash='SHA-256'）で復号
3. 新パラメータ（iterations=600_000, hash='SHA-256'）で再暗号化して envelope 形式で保存
4. 旧生 ciphertext は削除

**後方互換:**
- 旧生 ciphertext が残っていても、新コードで復号 → envelope で再保存のフォールバック
- 1 リリース並行稼働後、旧生 ciphertext パスを削除

### 5.4 H4: レート制限の永続化確認

**ファイル:** `src/background/rateLimiter.ts` + `src/background/sessionStore.ts`

**確認事項と対応:**
1. `SessionStore` の保存先が `chrome.storage.session` か `chrome.storage.local` か確認
   - `chrome.storage.session`: ブラウザ終了まで保持、SW 再起動でも保持
   - `chrome.storage.local`: 永続保持
2. `chrome.storage.session` なら **Red Team 指摘の「タブクローズでリセット」は誤り** — ただし sender key がタブ依存なら sender key 寿命で消える
3. sender key がタブ ID なら、`chrome.storage.local` への昇格を検討
4. 永続化テストを追加して仕様を明文化

**設計判断（要確認の上で）:**
- sender key を「タブ ID」ではなく「オリジン（ドメイン）」に変更
- 保存先は `chrome.storage.local`
- 1 時間ウィンドウ

### 5.5 H5: Optimistic Lock 適用

**ファイル:** `src/background/pipeline/steps/saveSqliteStep.ts` + `src/utils/optimisticLock.ts`

**設計:**

```typescript
// src/background/pipeline/steps/saveSqliteStep.ts
import { withOptimisticLock } from '../../../utils/optimisticLock.js';

export async function saveSqliteStep(context: RecordingContext): Promise<void> {
  await withOptimisticLock(
    `sqlite-write-${context.recordId}`,
    async () => {
      await sqliteClient.insert(record);
      await sqliteClient.update(obsidianSyncedKey, { obsidian_synced: 1 });
    },
    { maxRetries: 3, retryDelayMs: 100 }
  );
}
```

**旧ストア読み取り専用化:**
- `src/background/recordingLogic.ts` 内の `chrome.storage.local.set({ savedUrlsWithTimestamps: ... })` をすべて削除
- 読み取りコードは `src/dashboard/sqliteHistoryPanel.ts` などの UI 層で SQLite のみ参照
- `MigrationService` 起動時のみ旧ストアから読み取り → SQLite 投入後、削除せず並行稼働

### 5.6 H6: `OPFS_FALLBACK.md` リネーム

**ファイル:**
- `docs/OPFS_FALLBACK.md` → `docs/STORAGE_MODES.md`
- `README.md` 内の参照更新
- `CHANGELOG.md` 内の参照更新

**設計:**
- 内容を再読し、ファイル名と一致させる
- 冒頭 1〜2 行で「IndexedDB + SQLite モード」と「chrome.storage フォールバックモード」の 2 つを明記
- 旧 OPFS への言及は「補足: 以前のバージョンでは OPFS を使用していたが…」として履歴として残す
- ファイル名 `STORAGE_MODES.md`（中立的・内容と一致）

### 5.7 H7: CSS エスケープ

**ファイル:** `src/dashboard/cspStyleUtils.ts`

**設計:**

```typescript
function escapeCssIdentifier(value: string): string {
  // CSS identifier としてサニタイズ
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

function escapeCssValue(value: string): string {
  // CSS value としてサニタイズ（color 等）
  // 色として不正な文字を除去
  return value.replace(/[<>"'`{};()\\]/g, '');
}

export function setElementColor(elementId: string, color: string): void {
  const safeId = escapeCssIdentifier(elementId);
  const safeColor = escapeCssValue(color);
  const el = document.getElementById(safeId);
  if (!el) return;
  el.style.setProperty('color', safeColor);  // ← setProperty で style 属性経由
}

export function setElementWidth(elementId: string, width: string): void {
  const safeId = escapeCssIdentifier(elementId);
  const safeWidth = escapeCssValue(width);
  const el = document.getElementById(safeId);
  if (!el) return;
  el.style.setProperty('width', safeWidth);
}
```

**テストケース:**
- 入力に `<script>` を含む → サニタイズ
- 入力に `;}` を含む → サニタイズ
- 入力に `url(javascript:...)` を含む → サニタイズ
- 通常の色名・サイズ文字列は素通り

## 6. 通常トラック詳細（要点のみ）

各トラックは **1〜3 ファイルの局所的修正** で完結。実装詳細は `writing-plans` スキルで個別 PBI を起こす。

### 6.1 N1: i18n 漏れ修正
- `cleansingStatsView.ts` の日本語ハードコード → `data-i18n` 化
- `sqliteHistoryPanel.ts` の英語ハードコード → `data-i18n` 化
- `public/_locales/{ja,en}/messages.json` に翻訳追加
- `npm run i18n:validate` を gate に追加

### 6.2 N2: アクセシビリティ
- サイドバーに `role="tablist"` / `role="tab"` / `role="tabpanel"` / `aria-selected` 付与
- スピナーに `aria-live="polite"` 付与
- `window.confirm` 脱却 → アクセシブルな確認モーダル実装
- `docs/ACCESSIBILITY.md` の規約に準拠

### 6.3 N3: パフォーマンス
- `src/offscreen/sqlite.ts` の `insertBatch` で prepared-statement をバッチ開始時に 1 回生成・キャッシュ
- `src/background/migrationService.ts` の `run()` 内のバッチごと `chrome.storage.local` 書き込みを「N 件ごと」または「完了時のみ」に最適化
- `src/background/recordingTriggerManager.ts` の `cachedTriggers` を `chrome.storage.onChanged` リスナーで無効化

### 6.4 N4: 観測容易性
- `src/utils/logger.ts` の `addLog` 規約統一（`LogType`, `category`, `details` の型固定）
- 構造化ログの全面適用（既存コードに散在する `console.log` を置換）
- 永続的 SQLite 障害のアラートパス追加（`chrome.notifications` 経由）

### 6.5 N5: リファクタ
- `errorMessage()` ユーティリティを新コードで一貫使用（`src/utils/errorUtils.ts`）
- `setTimeout` リーク撲滅（`chrome.alarms` への置換 or ライフサイクル管理）
- `getOrCreateEncryptionKey` 集約（Hotfix H3 と同時に実施）
- `wa-sqlite` 重複解消（`package.json` から `@journeyapps/wa-sqlite` の重複エントリ削除）

### 6.6 N6: ドキュメント全面置換
- 旧ブランド名 `Obsidian Weave` / `obsidian-weave` / `Obsidian Smart History` → `yasumaro` / `Yasumaro`
- `OPFS_FALLBACK.md` → `STORAGE_MODES.md`（Hotfix H6 後に正式反映）
- ブログ・PBI の著者プロフィール冒頭
- ただし **CHANGELOG 4.x 以前は履歴保持**（バージョン履歴の整合性）
- AGENTS.md の命名ガイドラインに照らして整合性チェック

### 6.7 N7: PII サニタイズ強化
- `src/background/manualContentFetcher.ts` の fetch 結果に `piiSanitizer.sanitize()` を適用
- PII パターンの多言語化（日本語特化から英語・中国語・韓国語の基本パターン追加）
- PRIVACY.md の保持期間（90日 / 1,000件）を SQLite 層に実装（`src/offscreen/sqlite.ts` に `purgeOldRecords` 関数追加）
- 自動実行タイミング: 起動時 + 1 日 1 回（`chrome.alarms`）

### 6.8 N8: 設定/保持/コスト
- 設定エクスポートの取り込み時に API キー上書き確認モーダル表示
- `OpenAIProvider.ts` の content limit を 30,000 → 10,000 に戻す（FinOps 指摘）
- FTS5 trigram インデックスの評価（効果 vs コスト、必要なら削除）
- `obsidianSyncService.ts` の同期を recording ごと → バッチ（5件まとめ）に変更

## 7. データ整合性

### 7.1 状態管理
- H3 鍵集約: 鍵 blob の version 管理
- H5 Optimistic Lock: 書き込み競合の防止
- H2 confirmToken: 危険な操作の防止

### 7.2 マイグレーション順序
1. H3 鍵集約（既存ユーザーのデータ保護）
2. H5 Optimistic Lock（書き込み整合性）
3. H1 タイムアウト修正（モバイル環境の改善）
4. H2 認証化（危険な操作の保護）
5. H4 レート制限確認（状態保護）
6. H6 ドキュメント整備（ユーザビリティ）
7. H7 CSS エスケープ（セキュリティ）

## 8. エラーハンドリング

### 8.1 Hotfix 後のエラーパス
- `msgOffscreen` タイムアウト → `addLog(LogType.WARN, ...)` + リトライ（1回）
- `clear_all` 確認モーダル キャンセル → `success: false, error: 'cancelled'`
- 鍵マイグレーション失敗 → 旧鍵での復号を維持（フォールバック）
- Optimistic Lock 競合 → リトライ 3 回 → 失敗時 `addLog(LogType.ERROR, ...)` + ユーザー通知
- レート制限超過 → 既存のエラーパスを維持

### 8.2 ログ規約（N4 で統一）
```typescript
addLog(LogType.INFO, 'Component: action succeeded', { details });
addLog(LogType.WARN, 'Component: action failed, will retry', { details, error: errorMessage(err) });
addLog(LogType.ERROR, 'Component: action failed permanently', { details, error: errorMessage(err) });
```

## 9. テスタビリティ

### 9.1 テスト戦略
- **Hotfix 7 項目**: すべてにユニットテスト追加
- **N1〜N8**: 各トラックに最低 1 件のテスト追加
- **手動テスト**:
  - 拡張機能ロード → ダッシュボードで「履歴全削除」ボタン押下 → 確認モーダル表示 → キャンセルできる
  - SW DevTools で SW を強制終了 → 再起動 → レート制限が保持されている
  - 旧バージョンで暗号化した API キーを新バージョンで読込 → 自動復号 → 再暗号化
  - Safari でロード → 警告バナー表示
  - 1000 件超の履歴がある状態で「90日 / 1000件」保持期間実行

### 9.2 検証ゲート
- `npm validate`（type-check + 全テストユニット）合格
- 変更ファイルに対する手動テスト完了

## 10. 影響範囲・リスク

| リスク | 影響 | 緩和策 |
|---|---|---|
| H3 鍵導出変更で既存ユーザーが API キー再入力 | 中 | version header + 自動再暗号化、フォールバック機能 |
| H2 認証トークンで外部ツール（API 直接利用）破壊 | 低 | トークンなしでも query/search は許可 |
| H5 旧ストア読み取り専用化で既存導線破壊 | 中 | 旧ストアからの読み出しは 1 リリース並行稼働、その後削除 |
| N6 旧ブランド名置換で履歴的 CHANGELOG 整合性 | 低 | バージョン 4.x 以前は履歴保持、4.x 以降は新名称統一 |
| N7 SQLite 暗号化はパフォーマンス影響大 | 中 | スコープ外（PRIVACY.md 保持期間実装で代替） |
| N8 OpenAI content limit 縮小で既存プロンプト失敗 | 低 | ユーザー設定での上書きを許可 |

## 11. リリース計画

| Phase | リリース | 内容 |
|---|---|---|
| v5.x.0 | 緊急 | H1〜H7（Hotfix 7項目） |
| v5.x.1 | 通常 | N1, N2, N4, N5（コード品質改善） |
| v5.x.2 | 通常 | N3, N7, N8（パフォーマンス・プライバシー・コスト） |
| v5.x.3 | 通常 | N6（ドキュメント全面置換） |

## 12. 成功基準

- [ ] High 指摘 31件すべてが解消される
- [ ] Medium 指摘 36件すべてが解消される
- [ ] `npm validate` が全 PR で合格する
- [ ] 手動テストチェックリストが全項目クリアする
- [ ] 次回レビューで総合スコア 80 以上（A ランク）になる
- [ ] 自動テストカバレッジが現状から改善する

## 13. 参照ドキュメント

- [Checking Team レポート](../../../plans/2026-06-13-1112-review-tobe-yasumaro.md)
- [AGENTS.md](../../../AGENTS.md)（命名規約、テスト戦略）
- [dev-docs/ERROR_CODES.md](../../ERROR_CODES.md)
- [dev-docs/DESIGN_SPECIFICATIONS.md](../../DESIGN_SPECIFICATIONS.md)
- [docs/PRIVACY.md](../../../docs/PRIVACY.md)
- [docs/ACCESSIBILITY.md](../../../docs/ACCESSIBILITY.md)
- [docs/i18n-guide.md](../../../docs/i18n-guide.md)
