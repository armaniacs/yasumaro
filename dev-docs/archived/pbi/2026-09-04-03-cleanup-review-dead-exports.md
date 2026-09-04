# PBI: レビュー由来 dead export の一括除去

## ユーザーストーリー
拡張機能の保守担当者として、今回の deepening で残留した未使用 export を除去したい、なぜなら将来の読み手が「使われている seam」と誤解して誤用・誤拡張するのを防ぐためだから

## 優先度
- 順位: 03 / 3
- RICEスコア: **低（chore 扱い、RICE 換算 ~5）**（Reach=1 / Impact=1 / Confidence=1.0 / Effort=0.2）
- 根拠: ランタイム影響ゼロの負債返済。ユーザー価値はないが削除は機械的でリスクが低く、PBI 01・02 とは独立のため並行着手可。`RedactingStoragePort` の sibling 関数だけは live のため残す

## 背景
stage-branding 実験の残骸（`RequiresPrivacy` / `RequiresMarkdown`、`InputSlice` 系4型）、DI に倒れた `domainFilter` singleton、未配線の `RedactingStoragePort` クラスが export されたまま残っている。いずれも `grep` で import 0 件を確認済み。`redactSettingsApiKeys` 関数は `recordingCache.ts:356` で現役のため残す。`RedactingStoragePort` は `DESIGN_SPECIFICATIONS.md` に言及があるため doc 同期が必要。

## BDD受け入れシナリオ
Scenario: 未使用 export を削除する
  Given 上記の dead export が存在する
  When 対象の export を削除する
  Then `npm run type-check` がパスし、関連テストが green のままである

Scenario: live の redact 関数を残す
  Given `redactSettingsApiKeys` が session 永続化の境界防御として使われている
  When dead export 除去を実施する
  Then `redactSettingsApiKeys` の import・呼び出し・テストが壊れていない

## 受け入れ基準
- [x] `RequiresPrivacy` / `RequiresMarkdown` が削除される
- [x] `InputSlice` / `PrivacySlice` / `ContentSlice` / `FormatSlice` が削除される（将来 seam 用コメント含む）
- [x] `domainFilter` singleton が削除される（`DomainFilter` class は残す）
- [x] `RedactingStoragePort` クラスが削除され、`redactSettingsApiKeys` 関数は残る
- [x] `DESIGN_SPECIFICATIONS.md` の `RedactingStoragePort` 言及が現状に合わせて更新される
- [x] `npm run type-check` と関連テスト（recordingCache-redact / recordingCache-session / domainFilter-mode）がパスする

## テスト戦略
- E2E: 該当なし（削除のみ、ユーザー操作なし）
- 統合: 該当なし
- 単体: 既存テストスイートの green 維持（特に redact 系と domainFilter-mode）

## 見積もり
0.2 人週（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
