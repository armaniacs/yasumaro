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

### 3. 削除対象 large field を明示的に列挙する

`purgeLegacyStorage` 内の `LEGACY_STRIP_FIELDS` 定数で、クォータ回復時に削除するフィールドを管理する。新たな large field が追加された場合、ここに追加することを推奨する。この定数が、将来の完全 SQLite 化時に一括削除すべきフィールドの一覧としても機能する。

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
| `src/utils/storage.ts` | `purgeLegacyStorage()` を追加。`saveSettings` のクォータチェックに自動回復機構を追加。 |
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
- `src/utils/storage.ts` — `purgeLegacyStorage()` 実装
- `src/utils/storageUrls.ts` — `storageUrls.ts` エクスポート集約
- `src/background/pipeline/steps/saveMetadataStep.ts` — 二重書き込みの主要箇所
- `src/offscreen/storageFallback.ts` — FallbackStorage 実装
