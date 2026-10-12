# Backlog: code-review 指摘フォロー（review-followup2）

`/code-review`（2026-10-13、コミット 70d9754b〜49ca0c62 対象）の Suggestions 7 件を全件 PBI 化したラウンド。同日番号との衝突はない（2026-10-13 は新規日のため NN01-07 新規採番、NN 昇順＝優先降順）。

- 入力: code-review レポートの Suggestions 7 件（Critical Issues 0 件・Approve 判定の非ブロッキング指摘）
- 全候補が独立した指摘のため分割・統合なし。NN01 / NN07 はテストコード、NN02-NN06 は検証ゲートと lint ルールのドキュメント・堅牢化

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 今後1年の保守・利用での関与頻度（相対 1-10）
Impact: 3=実害解消 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小
Confidence: 1.0=コード・実測で確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| 01 | [manifest ゲートの失敗側を pin](2026-10-13-01-test-pin-manifest-gate-red-side.md) | test | 3 | 1.5 | 1.0 | 0.25 | **18.0** | 0.25 | なし |
| 02 | [check-manifest.mjs の JSON パース堅牢化](2026-10-13-02-refactor-check-manifest-json-parse-guard.md) | refactor | 2 | 0.5 | 1.0 | 0.25 | **4.0** | 0.25 | なし |
| 03 | [warResourceResolves の対応起源を明記](2026-10-13-03-refactor-war-resource-origins-doc.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | **2.0** | 0.25 | なし |
| 04 | [no-dead-test-skip のシャドーイング制限を併記](2026-10-13-04-refactor-no-dead-test-skip-shadowing-doc.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | **2.0** | 0.25 | なし |
| 05 | [wxt.config.ts の .ts import 逸脱理由を明記](2026-10-13-05-refactor-wxt-config-import-deviation-doc.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | **2.0** | 0.25 | なし |
| 06 | [getURL 抽出ルールの二層同期を pin](2026-10-13-06-refactor-sync-geturl-extraction-layers.md) | refactor | 2 | 0.5 | 0.8 | 0.5 | **1.6** | 0.5 | **NN02 の後**（pin 先の check-manifest.mjs が確定してから） |
| 07 | [RecordingPipeline モックを実契約型へ寄せる](2026-10-13-07-refactor-recording-pipeline-mock-typing.md) | refactor | 2 | 0.25 | 0.8 | 0.25 | **1.6** | 0.25 | なし |

RICE = R × I × C / E。同点（2.0 ×3 / 1.6 ×2）の裁定は「リスク軽減効果 → 時間的緊急性」: NN03（偽 fail の防止）> NN04（保護ツールのドキュメント）> NN05（規約逸脱の注記）、NN06（検証穴のリスク軽減）> NN07（スタイル改善）。

## 実行順（確定）とバッチ計画

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 / 02 / 04 / 07 | ゲート失敗側 pin テスト / JSON パース堅牢化 / シャドーイング併記 / モック型転換 | 4 者ともファイル非重複（manifest.test.ts / check-manifest.mjs / eslint/rules / RecordingPipeline.test.ts） |
| W2 | 03 / 06 | warResourceResolves 起源明記 / getURL 抽出 pin テスト（新規ファイル） | NN06 は新規ファイル、NN03 は manifest.test.ts（W1 の NN01 完了後）。NN06 は NN02 で確定した check-manifest.mjs を pin するため W1 の後 |
| W3 | 05 | wxtConfig import 逸脱理由コメント | NN03 と同ファイル（manifest.test.ts）のため NN03 の後 |

W1 は 4 件並列可。W2 は NN03 と NN06 が並列可。W3 は NN05 のみ。

## 台帳送り（見送り・トリガー管理）

なし（7 件すべて着手可能な指摘。Critical Issues は 0 件で、保留すべきトリガー待ち・ゲート待ちは無い）。

## 共通ファイル（統合側が更新）

- `pbi/00-INDEX.md`、本台帳。
