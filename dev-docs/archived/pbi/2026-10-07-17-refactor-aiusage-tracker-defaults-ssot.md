# PBI: aiUsageTracker の既定値と設定読みを canonical seam に寄せる

## ユーザーストーリー

AI レート制限の保守担当者として、`AI_RATE_LIMIT_MAX` / `MAX_MONTHLY_TOKENS` の既定値が defaults.ts 一意であってほしい。aiUsageTracker が既定値をローカル複製し、生 settings 読みが主経路で repo 語義（暗号化・移行権威・キャッシュ）を迂回しているから。

## 優先度

- 順位: 17/17
- RICE: 1.6（R3 / I1 / C0.8 / E1.5）
- 根拠: defaults.ts 一意源の回復。生読み先行は既存 fix（2026-09-22/09-28 の writer/reader mismatch 修正）の文脈があるため、その経路は計測済みフォールバックとして残す判断を含む → C 0.8
- 依存: なし

## 背景（file:line 現状）

- 既定複製: `src/utils/aiUsageTracker.ts:12`（`DEFAULT_RATE_LIMIT_MAX = 10`）/ `:293`（`DEFAULT_MAX = 1000000`）vs `src/utils/storage/defaults.ts:114-115`（canonical）
- 生読み主経路: `:74`（`chrome.storage.local.get('settings')`）/ `:303`（同様）/ legacy 読み `:87,317` / repo フォールバック `:98-104,327-334`（動的 import）
- 宣言: DESIGN_SPECIFICATIONS §5.1 — 「Settings access goes through the SettingsRepository deep module」「DEFAULT_SETTINGS is the only source of fallback values」
- 既存 fix の文脈: `:67-73,297-301` のコメント（生読み先行は writer/reader mismatch 修正として文書化済み）

## BDD受け入れシナリオ

```gherkin
Scenario: 既定値が defaults.ts 一意になる
  Given aiUsageTracker のローカル既定定数
  When defaults.ts の canonical 値から import する
  Then ローカル複製が消え defaults.ts 変更が伝播する

Scenario: 生読みの既存 fix 文脈が壊れない
  Given writer/reader mismatch 修正の生読み先行経路
  When defaults import を追加する
  Then 既存のレート制限テストと生読みの文書化された理由が維持される
```

## 受け入れ基準

- [x] 2 つのローカル既定定数を defaults.ts からの import に置き換える
- [x] 生読み経路と repo フォールバックの順序・文書化された理由（既存コメント）を維持する
- [x] 既存の aiUsageTracker / rate limit テストが green のまま（挙動不変）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: 実在する aiUsageTracker / rate limit テストを維持（既定値 import の pin は type-check 側）
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する

## 実装記録

- 変更ファイル: `src/utils/aiUsageTracker.ts`（ローカル既定複製を canonical DEFAULT_SETTINGS import に置換）
- ゲート: utils 5594 tests green / type-check PASS / lint PASS / validate PASS
