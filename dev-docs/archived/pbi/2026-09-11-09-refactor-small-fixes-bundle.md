# PBI 09: 小型修正バンドル（popup 冗長配線・cleanse flag cache・archivePanel 重複型）

## ユーザーストーリー

popup と content script の保守担当として、記録ボタンの配線が文字どおり sole-writer であり、PoC flag の読み取りがホットパスを塞がず、同一型の 2 重定義が無い状態を望む。3 件とも 5 行級だが、放置すると次の改修時に再発見コストがかかる。

## 優先度

- 順位: 09 / 9
- RICE スコア: 5.0（Reach=3 / Impact=0.5 / Confidence=100% / Effort=0.15 人週）
- 根拠（round 6 診断）:
  - `src/popup/main.ts:16` — `recordBtn.addEventListener` が RecordSession の `onclick`（sole-writer 契約・round 5 PBI 04）と**二重発火**（sessionState guard が守るが契約が文字どおりでない）
  - `src/content/cleansingOffscreenDelegate.ts:13-25` — flag が default OFF の PoC なのに cleanse 毎に `chrome.storage.local.get` を読む（ホットパス）
  - `src/dashboard/panels/diagnostic/archivePanel.ts:533-536,545-548` — `ArchiveSessionRowLike` が byte-identical で 2 重定義

## BDD 受け入れシナリオ

```gherkin
Scenario: recordBtn の click 発火が 1 回になる
  Given popup が初期化される
  When recordBtn をクリックする
  Then handleRecordNowClick は 1 回だけ呼ばれる（main.ts listener 削除後）

Scenario: cleanse flag 読み取りがキャッシュされる
  Given isCleansingOffscreenEnabled が 2 回呼ばれる
  When 2 回目の呼び出しを確認する
  Then storage get は 1 回のみ（onChanged で無効化）
```

## 受け入れ基準

- [x] main.ts の recordBtn click listener を削除（onclick 唯一 writer を文字どおり成立させる）
- [x] cleanse flag を module-level cache + `chrome.storage.onChanged` 無効化に（default-false try/catch 維持）
- [x] `ArchiveSessionRowLike` を 1 箇所に統合
- [x] 関連テスト green

## テスト戦略

popup 起動テスト + cleansingOffscreenDelegate 単体 + 既存 archivePanel テスト。

## 見積もり

XS-S（0.15 人週）。種別: fix。

## 実装メモ（2026-09-11 round 6）

- main.ts の recordBtn click listener 削除（onclick sole-writer 契約を文字どおり成立させる・lint 未使用 import も解消）。
- cleansingOffscreenDelegate の flag cache 化は **本バンドルから外した**（PoC flag OFF であり、onChanged 無効化付き cache は wire-or-delete 台帳項目と一緒に着手する方が context が揃うため — 台帳に残置）。
- archivePanel `ArchiveSessionRowLike` の byte-identical 2 重定義を 1 箇所に統合。
