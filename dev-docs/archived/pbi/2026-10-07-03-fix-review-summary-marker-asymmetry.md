# PBI: reviewSummaryGenerator の生成済みマーカー読み書きを同じ seam に寄せる

## ユーザーストーリー

振り返り機能のユーザーとして、週次/月次ダイジェストが各期間で 1 回だけ生成されてほしい。マーカー読み（blob）と書き（生散在キー）が seam を跨ぎ、移行済みプロファイルで毎アラームが AI ダイジェストを再生成するから。

## 優先度

- 順位: 3/17
- RICE: 9.0（R3 / I3 / C1.0 / E1）
- 根拠: 有料 API トークンの重複消費が毎週/毎月発生する実害。コードで確定
- 依存: なし

## 背景（file:line 現状）

- 読み側: `src/background/reviewSummaryGenerator.ts:258`（`repo.getAll()` → blob のみ）+ `:266-267`（lastGenerated 比較）
- 書き側: `:317-319`（`chrome.storage.local.set({ [period.lastGeneratedKey]: ... })` → 散在トップレベル）
- キーは移行対象: `REVIEW_SUMMARY_LAST_GENERATED_WEEK/MONTH` は StorageKeys 値（`src/utils/storage/types.ts:280-281`）で TOP_LEVEL_ONLY_KEYS 未分類（`settingsMigration.ts:143-163`）
- 影響: 移行済みプロファイルでは生書き込みが blob 読みに見えず、`lastGenerated` が常に既定 '' → already-generated ガードが不発 → 毎期間 AI 呼び出し + ファイル再ダウンロード（`conflictAction: 'overwrite'` で症状が隠れる）
- テストの隙間: `src/background/__tests__/reviewSummaryGenerator-extra.test.ts:318,431-433` が生書き込みを pin し getAll を flat object で mock（往復が未検証）

## BDD受け入れシナリオ

```gherkin
Scenario: 移行済みプロファイルで既生成マーカーが読める
  Given settings blob 権威の移行済みストレージで 1 週分を生成済み
  When 同じ週のアラームが再び発火する
  Then already generated で skip し AI 呼び出しは発生しない

Scenario: マーカー書き込み先が読み取り側と同じ場所になる
  Given 週次サマリの生成に成功した
  When マーカーを書き込む
  Then repo（settings blob）側の読み取りでその値が見える
```

## 受け入れ基準

- [x] 注入型を SettingsReader（getMany/getAll）から `repo.set` まで広げ、マーカーを `repo.set(period.lastGeneratedKey, ...)` で書く
- [x] 生 `chrome.storage.local.set` のマーカー書き込みを削除
- [x] 実 InMemoryStoragePort リポジトリによる往復テストを 1 本追加（flat getAll mock を pin のまま残さない）
- [x] ローカル markdown 出力パス等の他の読みは不変
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/background/__tests__/reviewSummaryGenerator-extra.test.ts` に往復ケース追加
- fixture 先行: 移行済み（blob 権威）ストレージでマーカーが見えない現バグを再現してから直す
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [x] 手動確認: 実アラーム発火（週次待ち）は DoD の手動確認項目とせず自動 pin のみで閉じる

## 実装記録

- 変更ファイル: `src/background/reviewSummaryGenerator.ts`（マーカー書き込みを repo.set に統一）/ `src/background/__tests__/reviewSummaryGenerator-extra.test.ts`（実リポジトリ往復テスト）/ `src/background/__tests__/reviewSummaryGenerator-concurrency.test.ts`
- ゲート: type-check PASS / lint PASS / validate PASS
