# PBI: 検索・tag-cluster の E2E spec 間重複を切り口ごとに一本化する

## ユーザーストーリー

E2E を保守する開発者として、検索・tag の spec を切り口ごとに 1 本にしたい。seed 行・操作・assertion が実質同一の spec が並立し、デバウンス修正や既定変更のたびに複数ファイルを同時更新する必要があるから。

## 優先度

- 順位: 23/23
- RICE: 1.2（R3 / I1 / C0.8 / E2）
- 根拠: 共通 seed・フロー寄せ＋残す切り口の明確化
- 依存: なし

## 背景（file:line 現状）

- 検索 seed 行の同一性: `dashboard-search-ui.spec.ts:18-24` vs `usability/dashboard-search-results.spec.ts:14-19` vs `usability/a11y-usability.spec.ts:83-86`（いずれも同一行）
- 検索フロー重複: `dashboard-search-ui:27-46` vs `dashboard-search-results:22-34` vs `a11y-usability:88-102`。クリア復元（`:48-70`）と空状態（`:36-52`）は残す価値あり
- tag-cluster 重複: `tag-cluster.spec.ts:22-56` vs `usability/dashboard-tag-cluster.spec.ts:24-52`（同一手順。コメントまで重複）
- 対象外: history-panel の API 版との役割分担は doc 宣言済み

## BDD受け入れシナリオ

```gherkin
Scenario: 検索 UI 駆動が一本化される
  Given 3 spec の検索フロー
  When dashboard-search-results に寄せる
  Then 件数＋空状態が検証され、dashboard-search-ui はデバウンス特化のみ残る

Scenario: tag-cluster が一本化される
  Given 2 spec の同一手順
  When usability 版に寄せる
  Then 件数一致＋ラベル照合が検証され、1500 行回帰ケースのみ旧 spec に残る
```

## 受け入れ基準

- [x] 共通 `makeRows`＋`clear→seed→open history panel` が fixture 側のオプションパラメータに寄っている
- [x] UI 駆動の検索が `dashboard-search-results` に一本化されている
- [x] tag-cluster が usability 版に一本化され、回帰ケースのみ旧 spec に残っている
- [x] 振る舞い不変。E2E 実行は CI 範囲
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- E2E 自体はブラウザ要のため CI 範囲。静的検証は validate で確認
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `seeded-history-panel.fixture.ts`（clearBeforeSeed 追加）、5 spec（所有分担の明記＋一本化。a11y はコメントのみ）
- ゲート: eslint 対象 PASS / type-check PASS（全体）/ lint 0 errors。E2E 実行は CI 範囲
