# PBI 05: cleanse flag の module cache 化

## ユーザーストーリー

コンテンツスクリプトでクレンジングを実行する利用者として、flag 読み取りがホットパスを塞がないことを知りたい。なぜなら default OFF の PoC flag なのに cleanse 呼び出し毎に chrome.storage.local を読んでいるから。

## 優先度

- 順位: 05 / 7
- RICE スコア: 4.0（Reach=1 / Impact=0.5 / Confidence=100% / Effort=0.05 人週）
- 根拠: `src/content/cleansingOffscreenDelegate.ts:12-25,47` — `isCleansingOffscreenEnabled` が cleanse 毎に storage get。round 6 PBI 09 から分離（wire-or-delete 台帳項目と同一 context だったが、単独で 10 行の修正として完結する）。

## BDD 受け入れシナリオ

```gherkin
Scenario: flag 読み取りが cache される
  Given isCleansingOffscreenEnabled が 2 回呼ばれる
  When 2 回目の呼び出しを確認する
  Then storage get は 1 回のみ

Scenario: 設定変更が反映される
  Given flag が cache 済み
  When chrome.storage で flag が変更される
  Then onChanged で cache が無効化され、次回読み取りで新値が返る
```

## 受け入れ基準

- [x] module-level cache + `chrome.storage.onChanged` 無効化（default false の try/catch 維持）
- [x] 単体テスト（cache 動作 + onChanged 無効化）

## テスト戦略

cleansingOffscreenDelegate 単体テスト新設/更新。

## 見積もり

XS（0.05 人週）。種別: fix（perf）。

## 実装メモ（2026-09-11 round 7）

- module-level cache（cleanse 毎の storage get を 1 回に）+ `chrome.storage.onChanged` 無効化（flag 変更を反映）。default false の try/catch 維持。
- テスト seam `__resetCleansingFlagCacheForTesting()` を export（module cache のため）— テストは file-level beforeEach で reset（describe 越しの cache 残留を解消）。cache 動作・onChanged 無効化のテスト 2 件新設。
- content 全 445 tests green。
