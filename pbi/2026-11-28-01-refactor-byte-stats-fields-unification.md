# PBI: byteStats フィールド集合の 2 定義を messaging 中立層に統一する

## ユーザーストーリー
保守担当者として、byte 統計のフィールド集合 (ByteStatsPayload と ContentResponse.byteStats) を 1 つの厳密型に統一したい、なぜなら同じフィールド集合が `src/messaging/types.ts:46-70` (ネスト、cleansedReason ユニオン) と `src/background/messageTypes.ts:26-41` (フラット、cleansedReason: string) に独立宣言されており、新フィールド追加時に 2 箇所更新が必要で、片側の cleansedReason は string のまま緩み続けるから (holistic レビュー テーマ 4、影響度: 低 | 難易度: 低、ロードマップ 1 位 Quick Win)。

## ビジネス価値
- byte 統計フィールドの追加コストが 2 箇所編集から 1 箇所 (中立層) になる
- 測定方法: `ByteStatsFields` が messaging/types.ts に定義され、messageTypes が extend に差し替えられ、cleansedReason がユニオン型であること

## BDD受け入れシナリオ

```gherkin
Scenario: 中立層の厳密型を両側が参照する
  Given src/messaging/types.ts に ByteStatsFields が定義されている
  When messageTypes.ts の ByteStatsPayload が extend に差し替えられる
  Then 両側のフィールド集合は単一実装を参照する (cleansedReason は 'hard'|'keyword'|'both'|'none' ユニオン)

Scenario: 緩い型は compile error になる
  Given cleansedReason に string 型の値が代入される
  When messageTypes.ts 経由で生成・消費される
  Then type-check が失敗する (ユニオン外の値が流入しない)
```

## 受け入れ基準
- [ ] `src/messaging/types.ts` に `ByteStatsFields` (現 12 フィールド、cleansedReason ユニオン統一) が定義されている
- [ ] `src/background/messageTypes.ts:26-41` の `ByteStatsPayload` が `ByteStatsFields` extend + fallback 系フィールドのみの差分宣言に置き換わっている
- [ ] `ContentResponse.byteStats` (messaging/types.ts:54-59) が同一 `ByteStatsFields` を参照する
- [ ] `cleansedReason` のユニオン外の値で type-check が失敗する pin (テスト) が存在する
- [ ] `npm run validate` が通る (byteStats を消費する pipeline/recording 系テスト含む)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (型統合、外部挙動不変)

### 統合テスト
- 既存 messaging / pipeline / recording 系テスト群 (無変更で緑)

### 単体テスト
- cleansedReason ユニオンの pin (許容値 4 種の確認、未知値の型エラーはコンパイル時担保)

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-28-0145-holistic-review-1128a.md テーマ 4、改善案スケッチ (types.ts:91-104、messageTypes.ts:107-112)
- 外部挙動: 完全に不変 (型の統合のみ。実行時の形状変更はしない)
- 依存関係: なし (2 ファイル + テスト)
- byte-identical 規律: ランタイム形状 (JSON 応答のフラット/ネスト) は現行どおり — 型定義の統合のみで、実行時構造を変更しない

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '46,70p' src/messaging/types.ts
sed -n '26,41p' src/background/messageTypes.ts
grep -rn "ByteStatsPayload\|byteStats" src/background/pipeline src/background/handlers --include="*.ts" | head -8
```

### 実装手順
1. messaging/types.ts に ByteStatsFields を定義 (AiSummaryCleansedReason ユニオン型も同時定義)
2. messageTypes.ts の ByteStatsPayload を extend に差し替え (fallback 系は差分)
3. ContentResponse.byteStats を ByteStatsFields に差し替え
4. type-check 確認 + messaging/pipeline 系テスト実行

### 落とし穴
- ContentResponse.byteStats はネスト形状、ByteStatsPayload はフラット形状 — ランタイムの JSON 形状を変えない (型の統合のみ)
- cleansedReason の値は validators 層経由で入る — ユニオン外の値が実行時に流入しないことを pin (テストで許容値を pin)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: 2 ファイルの型定義差し替えで戻る (1 コミット)
- [ ] ドキュメント更新の要否判定: 型統合のみで docs 更新は不要
