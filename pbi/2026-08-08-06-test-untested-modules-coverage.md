# PBI: 未テストの主要モジュールにテストを追加する

**作成日**: 2026-08-08
**優先度**: 高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（テスト追加のみ。本体コードは変更しない）
**種別**: 🔧非機能追加（test）

---

## 背景

アーキテクチャレビュー（2026-08-08）で、**直近のリファクタで分離された新モジュールにテストが付いていない**ことが判明した。

### 1. `recordingCache.ts` — 395行・テスト0

```bash
find src -name "*recordingCache*"
# → src/background/recordingCache.ts のみ（テストファイルが存在しない）
```

commit `63bce1a`（RecordingLogic 分割）で切り出された新モジュール。PBI `2026-08-08-01` の受け入れ基準には「`RecordingCache` の単体テストを追加（既存テストがカバー）」と記録されているが、**専用テストファイルは作られていない**。

`RecordingCache` が持つ責務は本来テストが必須の領域：
- settings / URL / privacy の3種キャッシュ + TTL + 自動退避
- `chrome.storage.session` への永続化
- **VULN-014（API キー redaction）**

呼び出し元は `service-worker.ts`（264・276・340・593行）と `handlers/lifecycleHandlers.ts`。

### 2. `messageHandlers.ts` — 732行に対しテスト163行

```bash
# messageHandlers.test.ts が import しているもの
grep -n "^import" src/background/handlers/__tests__/messageHandlers.test.ts
# → createValidVisitHandler, resetVisitRateLimiter のみ
```

17ファクトリのうち**テストされているのは `createValidVisitHandler` 1つだけ**。8つの `it()` のうち7つは VALID_VISIT のレート制限に関するもの。

残る16ファクトリは `service-worker.test.ts`（2415行）経由の間接検証のみ。とくに `createManualRecordHandler` / `createSaveRecordHandler` は `isSecureUrl` によるセキュリティチェック（368-377・466-475行）を持つ。

### 3. `BuiltInAiProvider.ts` — 113行・テスト0

PBI `2026-08-08-05` で扱うため本PBIでは対象外（重複を避ける）。

### 削除テスト

該当なし（テスト追加のため）。ただし**テストが無いモジュールは deletion test を適用できない**という点が重要：使われているか、正しいかを検証する手段が無い。

---

## 実装者向け注記: 現状の確認

```bash
# recordingCache の public 表面
grep -n "export\|static\|async" src/background/recordingCache.ts | head -40

# recordingCache の呼び出し元
grep -rn "RecordingCache" src/ --include="*.ts" | grep -v __tests__ | grep -v "recordingCache.ts"

# 既存の RecordingLogic 系テストがキャッシュをどこまでカバーしているか
ls src/background/__tests__/ | grep -i "recording"
```

**重要**: `recordingCache.ts` は「既存テストがカバー」とPBIに記録されている。まず既存テストが実際に何をカバーしているかを確認し、**本当に不足している範囲だけ**を追加すること。重複テストを増やすのは目的ではない。

---

## 設計

### テスト対象の優先順位

| 優先 | 対象 | 理由 |
|---|---|---|
| 1 | `RecordingCache` の VULN-014（API キー redaction） | セキュリティ。漏洩したら実害 |
| 2 | `RecordingCache` の TTL 期限切れ・無効化 | キャッシュの正しさは記録の正しさに直結 |
| 3 | `RecordingCache` の session storage 永続化 | Service Worker 再起動時の復元 |
| 4 | `createManualRecordHandler` / `createSaveRecordHandler` の `isSecureUrl` チェック | セキュリティ |
| 5 | その他ハンドラの正常系・異常系 | 網羅性 |

### 方針: 網羅率より「壊れたら困る場所」

17ファクトリ全てに完全なテストを書くのは費用対効果が悪い。**セキュリティチェックと状態遷移**に絞る。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: API キーがキャッシュから漏れない
  Given settings に API キーが含まれる
  When RecordingCache がキャッシュを session storage へ永続化する
  Then 永続化されたデータに API キーの平文が含まれない

Scenario: TTL 経過後にキャッシュが再取得される
  Given キャッシュが TTL 内に取得済みである
  When TTL を超過した後に取得する
  Then ストレージから再取得される

Scenario: 安全でない URL の記録が拒否される
  Given http:// や file:// などの安全でない URL
  When MANUAL_RECORD / SAVE_RECORD ハンドラを呼ぶ
  Then 記録が拒否される

Scenario: 既存テストが全てパスする
  When テストを追加する
  Then npm run validate が成功する
```

## 受け入れ基準

- [x] 既存テストのカバー範囲を調査し、不足範囲を特定（重複テストを作らない）
- [x] `src/background/__tests__/recordingCache-session.test.ts` を新規作成（17件）
- [x] VULN-014（API キー redaction）のテストを含む — **永続化の境界**で検証
- [x] TTL 期限切れ・キャッシュ無効化のテストを含む
- [x] session storage 永続化・復元のテストを含む
- [x] `createManualRecordHandler` / `createSaveRecordHandler` の `isSecureUrl` チェックのテストを追加（14件）
- [x] `npm run validate` が成功する（7470 tests pass）

### 調査結果の訂正（2026-08-08）

**レビュー時の「`recordingCache.ts` はテスト0」は誤りだった。** ファイル名一致（`find src -name "*recordingCache*"`）で判定したためで、実際には別名のテストからカバーされていた。

| 既存テスト | カバー範囲 |
|---|---|
| `recordingLogic-cache.test.ts` | `getSettingsWithCache` / `invalidateSettingsCache` / 設定キャッシュのTTL・バージョン（22件） |
| `recordingLogic-redact.test.ts` | `redactSettingsApiKeys` 単体（VULN-014、3件） |
| `headerDetector.test.ts` | privacyCache への書き込み・LRU退避 |
| `integration-recording.test.ts` | `getCacheState` 経由の統合 |

**実際に未カバーだった領域**（今回追加した箇所）:

1. **session storage への永続化と復元の往復** — `loadCacheFromSession` / `scheduleCacheSave` は既存テストで一度も検証されていなかった
2. **VULN-014 が「永続化の境界」で効いていること** — 既存テストは `redactSettingsApiKeys` を単体で呼ぶだけで、`saveCacheToSession` が実際にそれを通しているかは未検証だった
3. **復元時のTTL判定** — 期限切れキャッシュを復元しないこと
4. **URLキャッシュのTTL・無効化**
5. **privacy キャッシュの session storage フォールバック**（SW再起動からの復帰）

### テストが本当に欠陥を捕まえることの確認

書いたテストが素通りしないことを、**意図的に実装を壊して確認した**。

| 壊した箇所 | 結果 |
|---|---|
| `saveCacheToSession` の `redactSettingsApiKeys()` を外す | VULN-014 テストが失敗（session に平文APIキーが書かれることを検出） |
| `createManualRecordHandler` の `isSecureUrl` チェックを無効化 | URLスキームのテスト5件が失敗 |

いずれも復旧済み。

## テスト戦略

### 単体テスト
- `RecordingCache`: TTL / 無効化 / 永続化 / redaction
- `messageHandlers`: セキュリティチェック（`isSecureUrl`）を中心に

### モック方針
- `chrome.storage.session` / `chrome.storage.local` をモック
- 時間経過は `vi.useFakeTimers()` で制御（TTL テストに必須）

## 実装アプローチ

1. 既存の RecordingLogic 系テストを読み、キャッシュのカバー範囲を確認
2. 不足範囲を洗い出す
3. `recordingCache.test.ts` を作成（VULN-014 から）
4. `messageHandlers.test.ts` にセキュリティチェックのテストを追加
5. `npm run validate`

## 見積もり
2pt（既存カバー範囲の調査 + 2ファイルのテスト作成）

## 技術的考慮事項

- `RecordingCache` は static メソッド中心（`RecordingLogic.cacheState` から移管された経緯）。テスト間で状態が漏れないよう `beforeEach` でのリセットが必要
- TTL テストは実時間待ちにせず `vi.useFakeTimers()` を使う（テスト実行時間の増加を避ける）
- `messageHandlers` のテストは deps を注入する形なのでモックしやすい（14/16 が関数フィールドのみのため）
- `createManualRecordHandler` / `createSaveRecordHandler` は `ObsidianClient` / `SqliteClient` の実体を要求する（PBI `2026-08-08-01` で narrowing されなかった2件）。テストではこれらのモックが必要

## 関連

- アーキテクチャレビュー（2026-08-08）小粒指摘
- 先行作業: commit `63bce1a`（RecordingLogic 分割。本PBIはその後始末）
- 関連PBI: `2026-08-08-01-refactor-recording-logic-split.md`（「既存テストがカバー」と記録された箇所の検証）
- 対象: `src/background/recordingCache.ts`, `src/background/handlers/messageHandlers.ts`
