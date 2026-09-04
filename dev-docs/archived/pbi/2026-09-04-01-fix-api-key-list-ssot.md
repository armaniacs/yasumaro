# PBI: 秘匿キー一覧の SSOT 一本化（storagePort / settingsMigration 二重管理の解消）

## ユーザーストーリー
拡張機能の保守担当者として、秘匿キー一覧を1箇所で管理したい、なぜなら新プロバイダー追加時に片方の更新漏れがあっても平文残留やエクスポート漏洩を起こさないようにするためだから

## 優先度
- 順位: 01 / 3
- RICEスコア: **60**（Reach=4 / Impact=3 / Confidence=1.0 / Effort=0.2）
- 根拠: セキュリティ境界のドリフトは不可逆な漏洩につながる。`storagePort.ts` の正規化マッチを維持したまま SSOT 化でき、工数は 0.2 人週と最小。依存なしのため最初に着手する

## 背景
`src/utils/storage/storagePort.ts:15`（文字列リテラル版、redact 用）と `src/utils/storage/settingsMigration.ts:77`（`StorageKeys` 参照版、migration / export / mask 用）で同一6要素が二重定義されている。`storagePort.ts` は `vi.mock` hoisting 対策で意図的に `StorageKeys` を import していない。どちらかに新キーを追加し忘れると、`chrome.storage.session` への平文残留（VULN-014 回帰）か、`chrome.storage.local` の平文残留＋エクスポート漏洩のいずれかがサイレントに発生する。現状テストは6要素固定値の検証のみで drift を検出できない。

## BDD受け入れシナリオ
Scenario: 新プロバイダーキーを1箇所に追加する
  Given 秘匿キー一覧が SSOT で一元管理されている
  When 開発者が新しい API キーの StorageKey を SSOT に追加する
  Then redact・マスキング・migration・export のすべてが新キーに対応する

Scenario: 二重管理のドリフトをテストが検出する
  Given 両経路のキー一覧を比較するテストが存在する
  When 片方のリストだけが変更される
  Then テストが失敗し drift を検出できる

Scenario: hoisting 回避が維持される
  Given customPromptManager 系テストが SettingsRepository を mock している
  When テストスイート全体を実行する
  Then storagePort のキー解決が undefined にならず全テストがパスする

## 受け入れ基準
- [x] 秘匿キー一覧の正典が1箇所に定義され、両モジュールがそこから解決する
- [x] `storagePort.ts` の正規化マッチ（大文字小文字・`_`無視）が維持される
- [x] 両リストの一致を検証する drift 検出テストが追加される
- [x] `npm run type-check` と関連テスト（storagePort / settingsMigration / recordingCache-redact）がパスする

## テスト戦略
- E2E: 該当なし（内部保守性、ユーザー操作なし）
- 統合: 新キーを SSOT に追加した状態で redact→migration→export の一連が新キーに対応することを検証
- 単体: 両リスト一致の drift 検出テスト、正規化マッチの境界値テスト、hoisting 回避の既存テスト維持

## 見積もり
0.2 人週（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
