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

- [ ] `validateExportData`（`settingsExportImport.ts:375-433`）の `requiredKeys` 手写しリストを `DEFAULT_SETTINGS` keys − `API_KEY_FIELDS` 派生に置換（または `validateRestorableSettings` 委譲。どちらかを実装メモで選定）
- [ ] `apiKeyKeys` 手写しリスト（:420-424）を `API_KEY_FIELDS` 参照に統合
- [ ] `saveJsonToFile` ヘルパー新設。`:336-347` と `:353-367` の 12 行重複を解消
- [ ] v1/v2 HMAC 分岐は明示分岐のまま維持（テーブル化しない）
- [ ] 振る舞い変更なし（検証結果の許容/拒否集合が現行と同一であることを移行時回帰テストで証明）

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

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] type-check / lint / 対象テスト green
- [ ] コードレビュー完了
- [ ] `00-INDEX.md` 更新
