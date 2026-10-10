# PBI: providersTried と attemptedProviders の wire 二重定義を 1 契約に統一する

- 種別: refactor
- RICE: 3.2（R4 × I1 × C0.8 / E1.0）
- 依存: なし
- バッチ: W3

## ユー�ーストーリー

保守担当者として、「AI 全滅時に試行したプロバイダーID」の wire 契約が 1 つであってほしい。なぜなら同一概念が 2 wire 名で存在し、sender 側の手動リネーム adapter が毎回維持コストを払っているから。

## 背景（現状）

- `src/messaging/types.ts:135` — `RecordingResult.attemptedProviders`（resultBuilder が流す名前）
- `src/messaging/types.ts:109` — `RegenerateSummaryResponse.providersTried`（dashboard が読む名前）
- `src/background/handlers/recordingHandlers.ts:417-418` — `attemptedProviders → providersTried` の手動リネーム spread（同一コメント付き）
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:205-209` — `providersTried` のみを読む
- `src/background/privacyPipeline.ts:69,306` — `attemptedProviders` を `aiResult` から RecordingResult へ流す

同一概念の wire フィールド名二重定義 + 手動リネーム変換層。deletion test: リネーム adapter を削除しても複雑さが再出現しない（契約統一で消える）。

## BDD 受け入れシナリオ

```gherkin
Scenario: dashboard の履歴表示は変更前と同一
  Given RegenerateSummaryResponse が attemptedProviders を保持する
  When AI 全滅後の履歴エントリを表示する
  Then 試行プロバイダーの表示は変更前と同一である（sqliteHistoryPanel が型により追従）

Scenario: 手動リネーム adapter が残らない
  Given wire 契約が 1 つに統一されている
  When recordingHandlers を検査する
  Then attemptedProviders → providersTried のリネーム spread は存在しない
```

## 受け入れ基準

- [x] `RegenerateSummaryResponse.providersTried` を削除し、`RecordingResult.attemptedProviders` に統一する（dashboard 消費側が型により追従）
- [x] `recordingHandlers.ts:417-418` のリネーム spread を削除する
- [x] dashboard 展開側（sqliteHistoryPanel.ts:205-209）の読み取り先を `attemptedProviders` に更新
- [x] 既存テストが green（wire 挙動は統一後も同一情報）
- [x] `providersTried` 参照が 0 件（rg 確認）

## テスト戦略

- unit: `src/dashboard/panels/asyncData/sqliteHistoryPanel` 関連テストの読み取り先更新
- integration: regenerate フロー wire 契約の既存テストが green
- 挙動不変: 展開される情報（試行プロバイダー ID 一覧）は不変

## 見積もり

1.0 SP

## 技術的考慮事項

- Confidence 0.8: dashboard API の互換維持意図（2 名前をわざと分けた経緯）が残る可能性 — 同一コメント（PBI 2026-09-22-04 follow-up）が同一概念を示すため統一と判断
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `messaging/types.ts` の RegenerateSummaryResponse から providersTried を削除、attemptedProviders を保持
2. `recordingHandlers.ts` のリネーム spread 削除（result.attemptedProviders をそのまま wire に）
3. `sqliteHistoryPanel.ts` の読み取り先更新
4. `rg -n "providersTried" src/` で 0 件確認
5. `npm run type-check` + `npx vitest run src/dashboard src/background` で検証

### 落とし穴

- dashboard 側の `Array.isArray(result.attemptedProviders)` ガードの形は維持（読み取り先変更のみ）
- regenerate レスポンスの既存テストが providersTried を期待している場合は attemptedProviders に張り替え

## Definition of Done

- [x] wire 契約が 1 つ（providersTried 消滅）
- [x] リネーム adapter 削除
- [x] `npm run type-check` が green
- [x] 既存テスト green
- [x] ロールバック不要（契約統一・情報不変）
