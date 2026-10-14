# PBI: Release ジョブの timeout-minutes をポーリング最悪ケースに整合させる

## ユーザーストーリー
保守担当の開発者として、Release ジョブのタイムアウト予算をストア API のポーリング最悪ケースに合わせたい、なぜなら Edge/AMO ステップは `always()` で CWS 失敗から独立に設計されているのに、タイムアウト 15 分がポーリング最悪ケースを下回り、独立性の設計意図がタイムアウトで無効化されるから。

## 優先度
- 順位: 01 / 4
- RICEスコア: 24.0（Reach=5 / Impact=1.5 / Confidence=0.8 / Effort=0.25）
- 根拠: リリース毎に通る経路で、独立性設計の復旧。1 行変更。C=0.8 は最終値（90 分かジョブ分割か）に設計判断が残るため。
- 出所: holistic-code-review（2026-10-14、差分スコープ 49ca0c62..HEAD）テーマ2

## 背景（2026-10-14 時点の現状）
- `.github/workflows/release.yml:14` に `timeout-minutes: 15`。
- CWS ステップの最悪ケース: OAuth curl max-time 30 秒（:99-103）+ upload curl max-time 300 秒（:110-115）+ ポーリング 30 回 ×（sleep 10 秒 + curl max-time 30 秒）= 1200 秒（:125-132）+ publish curl max-time 60 秒 ≈ 26.5 分。
- Edge ステップの最悪ケース: upload curl max-time 300 秒（:194-198）+ `wait_for_operation` 2 ループ（各 30 回 × 40 秒 = 1200 秒、:172-188）+ publish 60 秒 ≈ 46 分。
- ビルド最悪 ~10 分（3 × wxt zip、通常は実測 96 秒: v6.9.43 の release ジョブ run 38525033887 は 06:55:02→06:56:38）。
- 合計最悪 ≈ 82.5 分 > 15 分。CWS ポーリングが伸びるだけで 15 分を消費し、`if: always() && hashFiles(...)` で独立に設計された Edge ステップ（:156）と AMO ステップ（:230）が途中で強制終了される。
- AMO ステップ（web-ext sign、`--approval-timeout 0`）は明示ループなしでもアップロード自体は無限待ち可能性があり、90 分でカバーされる。

## BDDシナリオ
Scenario: 正常なリリースは影響を受けない
  Given 通常のリリース実行（実測 96 秒）
  When ワークフローが完走する
  Then 全ステップが従来どおり実行され、タイムアウトで中断されない

Scenario: ストア API 遅延時も独立性が保たれる
  Given CWS ポーリングが最悪ケース（約 26.5 分）まで伸びた
  When Edge ステップが開始される
  Then ジョブタイムアウト（90 分）は Edge の完走（最悪約 46 分）を阻害しない

## 受け入れ基準
- [ ] `timeout-minutes` が 15 から 90 になり、根拠（ポーリング最悪ケースの計算: CWS 26.5 分 + Edge 46 分 + ビルド余裕 ≈ 82.5 分をカバー）が行コメントで記録されている
- [ ] ステップ順序・ステップ内容・他のフィールドは一切変更していない（diff は timeout-minutes 行のみ）
- [ ] ポーリング最悪ケースの計算内訳が本 PBI に記録されている
- [ ] release.yml の YAML 構文が有効である

## テスト戦略
- ワークフロー定義は単体テスト対象外のため、検証は YAML 構文パース（Node の js-yaml 等または actionlint 相当）と diff の目視確認で行う
- 統合: 実際の検証は次回タグ push の実行で行う（タイムアウトは異常時にのみ効く予算のため、通常実行は従来どおり 96 秒程度）

## 見積もり
0.25 SP（1 行変更）

## Definition of Done
- [ ] 受け入れ基準がすべて満たされている
- [ ] lint / type-check が通る（release.yml は eslint 対象外だがリポジトリ全体が green のこと）
- [ ] コードレビュー完了
