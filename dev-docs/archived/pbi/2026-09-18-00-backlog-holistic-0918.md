# バックログ台帳: 大局的コード改善 0918（holistic-0918）

2026-09-18 の大局的レビュー（DRY / SoC / 拡張性 / 堅牢性の4観点・実コード裏取り）で抽出した6候補の RICE 表・実行順・依存マップを集約する。直近ラウンド（archloop-0917・arch-review-0917系・0918 01-04）で SSOT 化された領域の「仕上げの双子」が中心であり、既存 PBI との重複はないことを確認済み。

## 採点基準（既存ラウンドと同一）

```
Reach: 今後1年の保守作業での関与頻度（相対1-10）。10=ほぼ毎週・全記録経路 / 5=月次 / 3=四半期 / 1=年次以下
Impact: 3=実害解消 / 2=大きい（セキュリティ修正の波及構造化等） / 1=中（重複削減・規範化） / 0.5=小（混乱削減・文書化）
Confidence: 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

## RICE スコア表（全6候補・同基準）

| スコア順 | 候補 | R | I | C | E | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | validators 共有検査の helper 集約 | 7 | 2 | 1.0 | 1 | 14.0 | → PBI 05 |
| 2 | confirmToken silent catch 可視化 + console 直呼び統一 | 5 | 2 | 1.0 | 1 | 10.0 | → PBI 06 |
| 3 | visitAdmission retry/load 双子集約 | 4 | 1 | 1.0 | 0.5 | 8.0 | → PBI 07 |
| 4 | sqlite purge/query/id 双子集約 | 4 | 1 | 1.0 | 1 | 4.0 | → PBI 08 |
| 5 | AI extract guard/debug 基底集約 | 5 | 1 | 0.8 | 1 | 4.0 | → PBI 09 |
| 6 | dashboardGateway 送信の Transport 配線 | 4 | 1 | 0.8 | 2 | 1.6 | → PBI 10 |

## 実行順

```
05（validators）→ 06（confirmToken 可視化）→ 07（visitAdmission）→ 08（purge 双子）→ 09（AI extract）→ 10（Transport 配線）
```

純 RICE 降順からの逸脱なし。08→09 は同点（4.0）のためルール「リスク軽減効果→時間的緊急度」を適用し、破壊的操作の fail-closed 順序を守る 08 を上位とした。06→10 は RICE 順と依存順が一致する（同一ファイル `src/messaging/dashboardGateway.ts` を触るため 06 を先行させ直列化）。

## 依存マップ

- 05: 依存なし（`src/messaging/validators.ts` のみ）
- 06: なし。10 の前提（同一ファイル先行）。対象: `src/background/confirmTokenManager.ts` + `src/messaging/dashboardGateway.ts` の logging 箇所のみ
- 07: 依存なし（`src/content/visitAdmission.ts` のみ）
- 08: 依存なし（`src/offscreen/sqliteMessageHandlers.ts` のみ）
- 09: 依存なし（`src/background/ai/providers/ProviderStrategy.ts` + Gemini/OpenAI provider。05 とはファイル非重複）
- 10: 06 の後に直列（同一ファイル）。送信経路のみを変更し logging は 06 の成果を前提とする

## ファイル排他バッチ計画

- バッチ1（並列可）: 05・07・08・09（互いにファイル非重複、解も互いの前提にならない）
- バッチ2（直列）: 06（dashboardGateway の logging 部分 + confirmTokenManager）
- バッチ3（直列）: 10（dashboardGateway の送信部分。06 の後）

## 台帳送り候補

なし。全6候補を PBI 化する。将来の再検討トリガーも本ラウンドでは発生しなかった。

## 5 Whys サマリー

- 05: なぜ3箇所に分散したか → subtype 追加のたび validator ごと複写された。なぜ放置されたか → 拒否文言がテスト pin で守られ構造指摘が後回しになった。→ 解: assert 系 helper 3本に集約し文言 parity を pin
- 06: なぜ握りつぶしか → ベストエフォート保存の慣習で catch 空ブロックが定着した。なぜ今か → token 消失が不可視のまま再発行ループを生む実害構造が確定した。→ 解: logger 経由の可視化 + 失敗時テスト pin
- 07: なぜ双子か → e2e/通常経路の統合時に warn ラベル差だけ残し本体が複写された。→ 解: backoffOnce + loadExtractorBestEffort に集約
- 08: なぜ双子か → archive 以外の破壊操作が後から追加され fail-closed 順序ごと複写された。→ 解: runPlannedPurge/runById/runPlannedQuery に集約
- 09: なぜ双子か → testConnection テンプレ統合の対象外だった extract 側が残った。→ 解: 基底 helper 2本に集約
- 10: なぜ迂回か → gateway が Transport（PBI-22）より先に独自 retry/timeout を持っていた。→ 解: TransportPort 注入で配線し timeout 10s は維持
