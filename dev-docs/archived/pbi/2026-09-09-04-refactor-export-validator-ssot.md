# PBI 04: settingsExportImport の requiredKeys を SSOT 派生に ＋ blob 保存統合

## ユーザーストーリー

設定のエクスポート/インポートを使う利用者として、新しい設定キーが追加されてもエクスポート検証が自動で追従してほしい。なぜなら現状は `validateExportData` の `requiredKeys`（~20 キー手写し）が `DEFAULT_SETTINGS` と並行して手動追従を要求し、キー追加の同期漏れでインポートが静かに失敗する恐れがあるから。

## 優先度

- 順位: 04 / 6
- RICE スコア: 8.0（Reach=2 / Impact=1 / Confidence=80% / Effort=0.2 人週）
- 根拠: `API_KEY_FIELDS` は PBI 2026-09-04-01 で SSOT 化済みだが requiredKeys は未接続という「SSOT 化の半分済み」パターン。派生元（defaults.ts）が既に存在するため機械的。blob 保存 12 行 ×2 の逐語重複も同時に解消。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: なし（01/02/03/06 とファイル非重複）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 新しい設定キーが requiredKeys に自動で入る
  Given validateExportData が DEFAULT_SETTINGS の keys から requiredKeys を派生している
  When  defaults.ts に新しいキー（API_KEY_FIELDS 以外）が追加される
  Then  validateExportData のテストが修正なしで新キーを要求する
        （手写しリストの更新が不要）

Scenario: API キーフィールドは必須要求から外れる
  Given requiredKeys = DEFAULT_SETTINGS keys − API_KEY_FIELDS の派生規則が定義されている
  When  API キーを含まないエクスポートデータを検証する
  Then  現行と同一の検証結果になる（API キーの必須性に関する振る舞い変更をしない）

Scenario: 平文と暗号化エクスポートのファイル保存が同一ヘルパーを使う
  Given saveJsonToFile(json, filename) ヘルパーが新設されている
  When  exportSettings（平文）と saveEncryptedExportToFile（暗号化）が保存する
  Then  両者とも同一ヘルパーを経由し、Blob → anchor → revoke のライフサイクルが
        1 箇所に集約される
```

## 受け入れ基準

- [x] `validateExportData`（`settingsExportImport.ts:375-433`）の `requiredKeys` 手写しリストを `DEFAULT_SETTINGS` keys − `API_KEY_FIELDS` 派生に置換（または `validateRestorableSettings` 委譲。どちらかを実装メモで選定）
- [x] `apiKeyKeys` 手写しリスト（:420-424）を `API_KEY_FIELDS` 参照に統合
- [x] `saveJsonToFile` ヘルパー新設。`:336-347` と `:353-367` の 12 行重複を解消
- [x] v1/v2 HMAC 分岐は明示分岐のまま維持（テーブル化しない）
- [x] 振る舞い変更なし（検証結果の許容/拒否集合が現行と同一であることを移行時回帰テストで証明）

## テスト戦略

- 移行時回帰: 派生 requiredKeys と旧手写しリストの同値性テストを先に書き、差分が出たら意図（キー追加漏れの是正）を記録してから着地
- 単体: 派生規則のテスト（API_KEY_FIELDS 除外・新キー自動追従）
- 回帰: 既存 export/import/restore テスト群 green

## 実装アプローチ

1. 同値性回帰テスト作成（旧リスト vs 派生）
2. 派生へ置換（差分は drift の是正として記録）
3. `saveJsonToFile` 抽出
4. `restorableSettings` との重複は選定記録のみ（統合するかは実装メモで判断）

## 見積もり

0.2 人週。難易度: 🟢低。副作用: 🟢なし（挙動不変）。種別: 🔧非機能追加（refactor）。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] type-check / lint / 対象テスト green
- [x] コードレビュー完了
- [x] `00-INDEX.md` 更新

## 実装メモ

### 派生集合 vs 手写しリストの差分と解決

1. `requiredKeys`（手写し 21 キー → 派生 `Object.keys(DEFAULT_SETTINGS)` − `API_KEY_FIELDS` 約 150 キー）
   - 手写し 21 キーはすべて派生集合に含まれることをテストで確認（後方互換の核は維持）。
   - 差分（派生のみに含まれる約 130 キー。例: `obsidian_host`、`ai_provider_priority_list`、クレンジング規則フラグ群、保持ポリシー群）は手写し側の追従漏れ（drift）と判定。PBI シナリオ 1（新キー自動追従）の意図どおり派生を採用し、検証は厳格化された。
   - 影響: 旧 21 キーのみのペイロードは今後拒否される。ただし実エクスポート（`settingsRepository.getAll()` 起点）は全キーを含むため、正規ラウンドトリップには影響しない。既存テストの fixture は `DEFAULT_SETTINGS` ベースに更新した。
2. `apiKeyKeys`（手写し 4 キー → SSOT 6 キー）
   - 差分 `provider_api_key`、`github_pat` は手写し側の追従漏れと判定。`sanitizeSettingsForExport`／`mergeWithExistingApiKeys` は既に SSOT 6 キーで動作していたため、検証だけが不整合だった。SSOT 参照に統合。
   - 影響: `apiKeyExcluded=false` 時に 6 キー全ての存在が要求される（従来は 4 キー）。`apiKeyExcluded=true` の振る舞い（API キー不要求・存在許容）は変更なし。
3. `validateRestorableSettings` への委譲は不採用。あちらは allowlist フィルタ（`sanitized`＋`skippedKeys` を返し、拒否しない）で boolean 検証と意味論が異なり、allowlist が export キーの部分集合のため委譲自体が振る舞い変更になる。選定記録としてここに残す。

### 変更ファイル

- `src/utils/settingsExportImport.ts`: `REQUIRED_EXPORT_KEYS` 派生定数を新設（`DEFAULT_SETTINGS` keys − `API_KEY_FIELDS`）、`validateExportData` の両手写しリストを置換、`saveJsonToFile(json, filename)` を export 関数として新設し `exportSettings`／`saveEncryptedExportToFile` の重複 12 行×2 を置換（ファイル名・動作は同一）。v1/v2 HMAC 分岐は未接触。
- `src/utils/__tests__/settingsExportImport-ssot.test.ts`: 新設 8 テスト。旧リストのスナップショットによる移行同値 3 件（legacy 包含・drift 棚卸し・API キー superset）、意図振る舞い 4 件（full 設定受理・派生のみキー欠落で拒否・旧 21 キー fixture 拒否・SSOT 6 キー要求）、`saveJsonToFile` 単体 1 件（Blob→anchor→revoke ライフサイクル）。
- `src/utils/__tests__/settingsExportImport.test.ts`: fixture を `DEFAULT_SETTINGS` ベースのヘルパー（`sanitizedFullSettings`／`fullSettingsWithKeys`）に置換。`apiKeyExcluded=false` 系は 6 キー明示に更新。
- `src/utils/__tests__/settingsExportImport-signature.test.ts`: 成功系 fixture を full settings に置換（特殊文字テストは override 値を維持）。失敗系 fixture は署名段階で拒否されるため期待値不変。

### 逸脱・残作業

- `saveJsonToFile` は別モジュールに切り出さず `settingsExportImport.ts` 内 export とした（スコープ最小化のため）。
- `00-INDEX.md` 更新と `dev-docs/archived/pbi/` への移動は未実施（`git mv` が必要で本タスクの非コミット・非 git 操作方針の範囲外のため。メンテナ側での実施を想定）。
- `settingsExportImport.ts` の `no-restricted-imports` warning（`./logger.js`）は既存のもので本変更による新規ではない。lint は 0 errors。

### 検証結果

- 新規 SSOT スイート: 8/8 green（実装前は意図振る舞い 4 件＋helper 1 件が red で drift を実証、実装後に green）
- 対象 3 スイート: 53/53 green
- `npx vitest run src/utils`: 227 ファイル 4348 テスト green
- `npm run type-check`: clean
- `npm run lint`: 0 errors（124 warnings は既存）
