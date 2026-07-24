# ADR: SQLite と chrome.storage の二重書き込みとクォータ対策

## ステータス
採用済み

## 日付
2026-07-07

## 作成者
ar

## コンテキスト

Yasumaro はかつて全ての閲覧履歴を `chrome.storage.local` の `savedUrlsWithTimestamps` キーに保存していた。その後 SQLite（OPFS / IndexedDB）への移行が進み、現在は記録パイプライン（`RecordingPipeline`）が 2 つの保存先に同時に書き込んでいる：

| 保存先 | 用途 | 容量制限 |
|--------|------|---------|
| SQLite (OPFS/IDB) | プライマリストレージ。検索・フィルタ・ダッシュボードの全機能 | 実質無制限 |
| `chrome.storage.local` (`savedUrlsWithTimestamps`) | レガシー履歴パネル・重複チェック・URLキャッシュ | **5MB（Chrome ハードリミット）** |

この二重書き込みにより、`chrome.storage.local` が 5MB 上限に達すると設定（`saveSettings`）の保存に失敗し、ダッシュボードで `Storage quota exceeded` エラーが発生する。実際に 5,237,549 / 5,242,880 bytes（99.9%）まで達しているユーザーが確認されている。

### 二重書き込みが発生するコードパス

1. **パイプライン Step 9: `saveMetadataStep`**
   - URL エントリ（url + timestamp）を `savedUrlsWithTimestamps` に追加
   - 各種メタデータ（content, aiSummary, tokens, bytes, durations, aiProvider, aiModel 等）を `savedUrlsWithTimestamps` に書き込む ← **ここが肥大化の原因**
   - データは同時に `saveSqliteStep` で SQLite にも保存される

2. **`urlMetadata.ts` の各 setter**
   - `setUrlContent`, `setUrlAiSummary`, `setUrlSentTokens` などは全て楽観的ロックで `savedUrlsWithTimestamps` 配列を操作
   - 各 URL エントリに content（最大64KB）、aiSummary（可変長）などの large field が付与される

3. **`urlStorage.ts` の `setSavedUrlsWithTimestamps`, `updateUrlTimestamp`**
   - 既存エントリが見つかった場合、全フィールド（content, aiSummary 含む）を引き継ぐ
   - `MAX_CONTENT_ENTRIES=10` で content のみ一部削除されるが、aiSummary や tokens 等は削除されない

### なぜ二重書き込みを維持しているか

1. **フォールバックモード**: OPFS/IDB が利用できない環境では `FallbackStorage`（chrome.storage.local）が全データを保持する。このモードでは `savedUrlsWithTimestamps` が唯一のデータソース。
2. **レガシー履歴パネル**: `dashboard/historyPanel.ts` は `getSavedUrlEntries()` を通じて `savedUrlsWithTimestamps` を読み込む。SQLite 版パネル（sqlite-history）が存在するが、全てのユーザーが移行したわけではない。
3. **重複チェック**: `checkDuplicateStep` が `getSavedUrlsWithTimestamps()` を参照。
4. **URL キャッシュ**: `recordingLogic` が `getSavedUrlsWithTimestamps()` をキャッシュとして使用。

## 関連する ADR

- [OPFS永続化とFTS5全文検索の両立](./2026-06-17-opfs-fts5-coexistence.md) — SQLite への移行経緯
- `docs/STORAGE_MODES.md` — フォールバックモードのユーザー向け説明

## 決定事項

### 1. 二重書き込みを維持する（全 metadata field を両方のストレージに書き込む）

`saveMetadataStep` は従来通り全 metadata を `savedUrlsWithTimestamps` に書き込む。これにより:

- **フォールバックモードでも全データが利用可能**: OPFS/IDB 未対応環境でも content, aiSummary, tokens, bytes, durations, aiProvider 等が失われない
- **レガシー履歴パネルが全情報を表示可能**: SQLite 版に依存せず、`historyPanel.ts` が全フィールドを読み出せる
- **重複チェック・URL キャッシュに影響しない**: 既存のコードパスを変更する必要がない

書き込むフィールド一覧:
- URL エントリ（url + timestamp + title）← レガシー履歴パネル表示
- `recordType` ← 記録方式の識別
- `maskedCount` ← PII マスク件数
- `content`（本文）← 最大 64KB、最大の容量消費要因
- `tags` ← タグリスト
- `aiSummary`（AI 要約）← 可変長
- `sentTokens`, `receivedTokens`, `originalTokens`, `cleansedTokens`
- `pageBytes`, `candidateBytes`, `originalBytes`, `cleansedBytes`
- `aiSummaryOriginalBytes`, `aiSummaryCleansedBytes`, `aiSummaryCleansedElements`
- `aiSummaryCleansedReason`, `aiSummaryCleansedReasons`
- `aiProvider`, `aiModel`, `aiDuration`, `obsidianDuration`
- `extractedSentencesBytes`, `extractedSentencesOriginalBytes`
- `fallbackTriggered`

### 2. クォータ超過時の自動回復機構を導入する（唯一の保護策）

`saveSettings` のクォータチェックで超過が検出された場合、`purgeLegacyStorage()` を呼び出してからリトライする。この自動回復が、二重書き込みによって `chrome.storage.local` が 5MB に達した際の唯一の安全弁となる。

`purgeLegacyStorage()` の動作:
1. `savedUrlsWithTimestamps` から large field（content, aiSummary 等）を全て削除
2. エントリを最新 500 件にトリミング（`LEGACY_MAX_ENTRIES = 500`）
3. 重複管理用の `savedUrls` キーを削除（`savedUrlsWithTimestamps` から再生成可能）
4. 解放されたバイト数を返し、`saveSettings` がリトライ

### 3. 保持対象フィールドをホワイトリストで明示的に列挙する

`purgeLegacyStorage`（`src/utils/storage/savedUrlStore.ts`）は「削除対象を列挙する定数」ではなく、**保持するフィールドをホワイトリストとしてインラインで列挙する方式**を採る。エントリを`{ url, timestamp }`の最小構成に切り詰めた上で、レガシー履歴パネルに必要な`recordType`・`maskedCount`・`tags`・`isTrancoDomain`のみを条件付きで復元する。それ以外の large field（`content`, `aiSummary`等）は自動的に除外される。新たに保持すべきフィールドが増えた場合はこのホワイトリストに追加する。

## 結果

### メリット

- **クォータ超過によるクラッシュが防止される**: 設定保存が自動的に空き容量を確保してリトライする
- **二重書き込みによる冗長性を維持**: フォールバックモード・レガシー履歴パネル・重複チェック・URL キャッシュが従来通り動作
- **全 metadata が両方のストレージに存在**: content/aiSummary 等もレガシーストレージから読み出せる
- **クォータ超過は最後の安全弁として機能**: 超過時のみ large field が削除され、SQLite のデータは維持される

### デメリット

- **通常運用中も chrome.storage.local が常に消費される**: 二重書き込みを維持するため、5MB に近づく速度は変わらない
- **クォータ超過時に large field が消失する**: 一度 `purgeLegacyStorage` が発動すると、content/aiSummary 等が chrome.storage.local から削除される。ただし SQLite 側には全データが残っているため実質的なデータロスはない。
- **クォータ超過時に古いエントリが消失する**: 最新 500 件のみ保持。SQLite 側には全データが残っている。
- **`purgeLegacyStorage` は対症療法**: 根本的な解決（二重書き込みの廃止）にはなっていない。

### 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/storage/savedUrlStore.ts` | `purgeLegacyStorage()` を追加（`src/utils/storage.ts`は集約ファイルとして再エクスポートのみ）。`saveSettings` のクォータチェックに自動回復機構を追加。 |
| `src/background/pipeline/steps/saveMetadataStep.ts` | 変更なし（全ての metadata 書き込みを維持） |

## 将来の削除計画

完全な SQLite 化が完了した時点で、以下を削除できる:

1. **`savedUrlsWithTimestamps` からの読み出し**:
   - `dashboard/historyPanel.ts` → `getSavedUrlEntries()` による読み出し → SQLite 版パネルに完全統合後に削除
   - `checkDuplicateStep` → SQLite の `UNIQUE(url, created_at)` 制約で重複防止可能に
   - `recordingLogic` → URL キャッシュ専用の軽量な仕組み（chrome.storage.session など）に置き換え

2. **`savedUrlsWithTimestamps` への書き込み**:
   - `saveMetadataStep` のエントリ追加処理
   - `urlMetadata.ts` の全 setter（setUrlRecordType 等）
   - `urlStorage.ts` の `setSavedUrlsWithTimestamps`, `updateUrlTimestamp`

3. **クォータ関連コード**:
   - `purgeLegacyStorage()` 関数全体（ただし, 設定保存時のクォータチェック自体は有用なので `LEGACY_STRIP_FIELDS` の削除のみでも可）

4. **`FallbackStorage`（`storageFallback.ts`）**:
   - OPFS/IDB が全環境で利用可能になったら削除可能。現時点ではモバイル Chrome 等を考慮すると維持。

### 削除トリガー（判断基準）

- ダッシュボードの履歴パネルが 100% SQLite 版のみになった
- content/aiSummary の表示が SQLite 版からのみ行われるようになった
- モバイル Chrome 等での OPFS 未対応が無視できる程度に低下した
- `chrome.storage.session` など軽量な代替キャッシュが導入された

## 参照

- [Chrome storage.local quota 仕様](https://developer.chrome.com/docs/extensions/reference/api/storage#property-local)
- `src/utils/storage/savedUrlStore.ts` — `purgeLegacyStorage()` 実装（`src/utils/storage.ts`から再エクスポート）
- `src/utils/storageUrls.ts` — `storageUrls.ts` エクスポート集約
- `src/background/pipeline/steps/saveMetadataStep.ts` — 二重書き込みの主要箇所
- `src/offscreen/storageFallback.ts` — FallbackStorage 実装

## 終了条件（M9: デュアルライト終了条件フラグ）

完全 SQLite 化への過渡期として、`LEGACY_DUAL_WRITE_ENABLED` 設定キーを追加した。これは「二重書き込みをいつ止めるか」という終了条件をユーザー/運用側で制御するためのスイッチである。

### 仕様

| 項目 | 値 |
|------|-----|
| キー | `legacy_dual_write_enabled` |
| 型 | `boolean` |
| デフォルト | `true`（既存の二重書き込み挙動を維持） |
| 設定場所 | `StorageKeys` / `DEFAULT_SETTINGS` |

- `true`（デフォルト）: 従来通り `saveMetadataStep` が `chrome.storage.local`（`savedUrlsWithTimestamps`）へ全 metadata を書き込む（SQLite との二重書き込み）。
- `false`: `saveMetadataStep` の `chrome.storage.local` 書き込みを **全スキップ** する。`saveSqliteStep` による SQLite 書き込みは影響なく実行され、SQLite のみが単一の情報源（single source of truth）となる。

### スキップされる範囲

`saveMetadataStep` 全体が早期リターンするため、以下の `chrome.storage.local` 書き込みが全て行われなくなる：

- `savedUrlsWithTimestamps` への URL エントリ追加
- `setUrlRecordType` / `setUrlContent` / `setUrlAiSummary` / `setUrlTags` / 各 `setUrl*Bytes` / `setUrl*Tokens` / `setUrlAiProvider` / `setUrlAiModel` / `setUrlAiDuration` / `setUrlObsidianDuration` / `setUrlExtractedSentencesBytes` / `setUrlFallbackTriggered` 等の全 setter

これにより `chrome.storage.local`（5MB 上限）の消費が止まり、クォータ超過に起因する `Storage quota exceeded` を構造的に回避できる。

### 判定ロジック

`RecordingContext.settings[StorageKeys.LEGACY_DUAL_WRITE_ENABLED]` を参照し、明示的に `false` の場合のみスキップする（`undefined` や旧ユーザーはデフォルト `true` として扱い、既存挙動を維持）。

```ts
const legacyDualWriteEnabled =
  (context.settings?.[StorageKeys.LEGACY_DUAL_WRITE_ENABLED] as boolean | undefined) !== false;
if (!legacyDualWriteEnabled) {
  return context; // skip chrome.storage.local legacy write
}
```

### 關連する影響（false 時の挙動変化）

以下は「将来の削除計画」の依存先であり、`false` にした環境ではこれらが `chrome.storage.local` から読めなくなる点に注意。

- `dashboard/historyPanel.ts`: レガシー履歴パネル（SQLite 版への統合が済んでいない場合）の表示が空になる。
- `checkDuplicateStep`: `getSavedUrlsWithTimestamps()` による重複チェックが機能しなくなる（SQLite の `UNIQUE(url, created_at)` への移行が必要）。
- `recordingLogic` の URL キャッシュ参照が無効になる（軽量な代替キャッシュへの置換が必要）。

したがって `false` は「SQLite 版パネルへの移行完了後」または「FallbackStorage 非利用（全環境で OPFS/IDB 利用可能）」な環境向けの運用スイッチである。

### 実装箇所

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/storage/types.ts` | `LEGACY_DUAL_WRITE_ENABLED` キーと型を追加 |
| `src/utils/storage/defaults.ts` | デフォルト値 `true` を追加 |
| `src/background/pipeline/steps/saveMetadataStep.ts` | フラグ判定による早期リターン（chrome.storage.local 書き込みのスキップ） |

### 終了トリガー（このフラグを恒久的に除去する条件）

「削除トリガー」（ADR 末尾）が全て満たされた時点で、本フラグと `saveMetadataStep` のレガシー書き込み、および `purgeLegacyStorage()` を一括削除できる。それまではデフォルト `true` のまま運用し、段階的に `false` への移行を検証する。

## Implements

- `src/utils/storage/types.ts` (`LEGACY_DUAL_WRITE_ENABLED` キー)
- `src/utils/storage/defaults.ts`
- `src/utils/storage.ts`
- `src/background/pipeline/steps/saveMetadataStep.ts`
- `src/utils/storageUrls.ts`
- `src/offscreen/storageFallback.ts`
