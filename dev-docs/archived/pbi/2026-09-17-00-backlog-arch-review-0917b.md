# 台帳: 2026-09-17 コードレビュー追指摘の PBI 化（arch-review-0917b）

arch-review-0917（10件・全件完了）の実装後に行った大局的コードレビューで発見した残課題の台帳。レビューの結論は「新規の大型構造問題は発生していない。残る課題は新設 SSOT の採用が一部経路で止まっている第二次統合に集中」であり、本台帳の4件はその仕上げ。

---

## 採点基準（arch-review-0917 と同一）

- **Reach**: 今後1年間の保守作業での関与頻度（相対 1-10）
- **Impact**: 3=実害解消 / 2=大きい / 1=中 / 0.5=小（混乱削減・文書化）
- **Confidence**: 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=効果が不確か
- **Effort**: ストーリーポイント

## RICE 採点表（全5候補）

| 候補 | R | I | C | E | RICE | 扱い |
|---|---|---|---|---|---|---|
| 完了済み PBI 古いコピーの処分（housekeeping） | 5 | 0.5 | 1.0 | 0.25 | 10.0 | **ラウンド内清掃として実施済み**（PBI 化せず。下記記録） |
| `fetchErrorLabel` 廃止 + `parseAndMapFetchError` 第2テーブル統合 | 5 | 2 | 0.8 | 1 | 8.0 | PBI 化（順位1・NN 11） |
| 指数バックオフ5箇所の `backoffDelayMs` 移行 | 4 | 1 | 1.0 | 0.5 | 8.0 | PBI 化（順位2・NN 12） |
| markdownFormatter の死んだ export 削除 + 形式明示命名 | 6 | 0.5 | 1.0 | 0.5 | 6.0 | PBI 化（順位3・NN 13） |
| utils 層分類リストの一元化（または parity スクリプト）+ 暫定許可 ADR | 6 | 1 | 0.8 | 2 | 2.4 | PBI 化（順位4・NN 14） |

同点（11 と 12・RICE 8.0）は「リスク軽減効果」で決定: 11 は openai 互換系ユーザーに誤ラベルが表示される実害を含むため上位。

## 実行順（NN = ファイル番号）

| NN | ファイル | RICE |
|---|---|---|
| 11 | [2026-09-17-11-fix-ai-provider-error-labels.md](2026-09-17-11-fix-ai-provider-error-labels.md) | 8.0 |
| 12 | [2026-09-17-12-refactor-backoff-delay-adoption.md](2026-09-17-12-refactor-backoff-delay-adoption.md) | 8.0 |
| 13 | [2026-09-17-13-refactor-markdown-formatter-cleanup.md](2026-09-17-13-refactor-markdown-formatter-cleanup.md) | 6.0 |
| 14 | [2026-09-17-14-refactor-layer-list-single-source.md](2026-09-17-14-refactor-layer-list-single-source.md) | 2.4 |

採番の根拠: 同日先行ラウンド（arch-review-0917）が NN 01-10 を使用済み（アーカイブ済み）のため、本ラウンドは **NN 11 から継続採番**。日付内通し番号の一意性と「実行順の鍵」性質（11 > 10 = 前ラウンド後に着手）を両立する。

## ラウンド内清掃（PBI 化せず実施済み）

- **完了済み PBI 古いコピーの削除**: `pbi/2026-09-16-05-refactor-hash-url-locality.md` をユーザー同意のもと削除。理由: hashUrl は既に `src/utils/urlHash.ts` へ移動済み（PBI 2026-09-16-05 完了・コミット `6b341789`・アーカイブ済み）であり、pbi/ に戻されたコピーは「現状: crypto/primitives.ts にある」等の陳腐な記述を含んでいた（実測: crypto/primitives.ts に hashUrl なし、呼び出しは4ファイルに減少）
- 自律解決済みの判断: parse 経路の文言は **byte-identical 移行をデフォルト**とし、第1テーブルとの文言統一（"Invalid API key..." 系の揺れ）は PBI 11 の判断ポイントとして明記（parity pin → 意図的変更の順）。層リストの案A/B は PBI 14 の着手時判断ポイント

## 依存マップ

```
11（ProviderStrategy.ts を単独占有。mid-file import 整理を折り込み）
12 / 13 / 14 は互いに独立
全て arch-review-0917 の成果（backoff.ts / httpFailureMessages.ts / 層境界ルール）を前提にするが、着手順の依存はない
```

## レビューで確認済みの強み（本ラウンドでは着手しない）

- 10件の並列リファクタが1つの構造として成立: サニタイズ列は markdownFormatter.ts に完全集約、status→文言は接続テスト3呼び出し元が1テーブル経由、SettingsRepository 直生成ゼロ、境界 lint 活動中
- 3バッチが同一ファイル（gistSyncTarget.ts）に触れても整合
- parity 規律（"reproduce, not unify" の明示）が golden テストで pin されている
- providerCatalog の「宣言のみで未消費」病は解消（全フィールド実消費）
