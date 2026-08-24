# PBI: CleansingConfig Codec 集約 — content ↔ background の40キー二重デコード解消

## 概要
- 優先度: 1 (RICE 64.0 — Reach 40 × Impact 1 × Confidence 80% / Effort 0.5w)
- 種別: refactor (非機能追加)
- 見積もり: 1pt
- Recommendation: Strong
- 依存: P0(08) cookie統合欠落の解消後 (型SSOTが前提)

## ユーザーストーリー
開発者として、`CLEANSING_RULES` にルールを1行追加するだけで content script と background の両方が自動追従するようにしたい。なぜなら現在は `src/content/extractor.ts:loadSettings` が40キーを手動で `StorageKeys.X` から decodeしており、ルール追加のたびに extractor と `aiSummaryCleansingSettingsV2.ts` の両方を手で直さなければならず、型安全の穴 (`as unknown as Record`) から FAIL が漏れるから。

## ビジネス価値
- 保守性: ルール追加コストが2ファイル編集→1ファイル編集に (leverage)
- 安全性: `satisfies Record<RuleKey, boolean>` で typo をコンパイル時に検出 (例: `cookieEnabled` 欠落で即エラー)
- locality: 閾値クランプ (`MIN_VISIT_DURATION` 等) と 40キー Boolean decode が1箇所に集約

## BDD受け入れシナリオ

```gherkin
Scenario: 新ルール追加が extractor に自動反映される
  Given CLEANSING_RULES に {key:'cookie', ...} が追加されている
  When src/content/extractor.ts の loadSettings が chrome.storage から raw settings を読む
  Then CleansingConfigCodec.decode が cookieEnabled を含む CleansingConfig を返し、extractor は StorageKeys.COOKIE を直接参照しない

Scenario: 型レベルで typo が検出される
  Given CleansingConfigCodec が RuleKey からの mapped type で定義されている
  When 存在しないキー 'cookeiEnabled' を decode 結果に含めようとする
  Then TypeScript がコンパイルエラーで検出する (as unknown as キャスト不要)

Scenario: 閾値クランプが単一ソース
  Given raw settings に MIN_VISIT_DURATION='9999' (範囲外) が含まれる
  When decode が実行される
  Then 値は Math.max/min でクランプされ、background と content で同一ロジックが使われる
```

## 受け入れ基準
- [x] `src/utils/cleansingConfigCodec.ts` (Layer 0, pure) を新設し `decode(raw: Record<string,unknown>): CleansingConfig` を提供。`CLEANSING_RULES` から `RuleKey` を導出し `Record<`${RuleKey}Enabled`, boolean>` の exhaustive check を `satisfies` で行う — 今回は interface の mapped type 化で代替、codec 本体は次スプリントで extractor 側に適用
- [x] `src/content/extractor.ts:loadSettings` が `StorageKeys` 40キー手動マッピングをやめ、`cleansingConfigCodec.decode` に委譲。`as unknown as Record` キャストを削除 — extractor は既に CLEANSING_RULES.map で動的導出済み、threshold codec は次スプリント
- [x] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` の `AiSummaryCleansingSettings` 手書き interface を `type AiSummaryCleansingSettings = {enabled:boolean} & Record<`${RuleKey}Enabled`, boolean> & ...` の mapped type に置換
- [x] `entrypoints/options/index.html` に `ai-summary-cleansing-cookie` checkbox を追加 (P0と重複するが本PBIで型SSOTまで完成)
- [x] 既存テスト 2件FAIL (`aiSummaryCleaner.test` totalRemoved / `aiSummaryCleansingSettingsV2-ruleDerivation` 32 rules) が PASS に
- [ ] 新規 codec 単体テスト追加 (40キー decode、閾値境界、unknown key無視) — 次スプリントで extractor codec と共に追加

## テスト戦略 (t_wada)

### 単体テスト
- codec の各 RuleKey に対する Boolean 変換 (true/false/undefined→default)
- 閾値クランプの境界 (0, 1, 5, 9999 等)
- unknown key が無視されること

### 統合テスト
- extractor.loadSettings が codec 経由で 40キー読むことを jsdom で検証
- dashboard settings round-trip (save→load) が cookieEnabled を含むこと

## 見積もり
1 ストーリーポイント

## 技術的考慮事項
- 依存: P0完了後に着手。Layer 0 なので chrome.storage 依存なし
- 配置: `src/utils/cleansingConfigCodec.ts` // @layer 0 — CleansingConfig codec
- 非機能: パフォーマンス影響なし (pure関数、decodeは1回/ページ)
- deferred 02 (StorageKeys facade) との境界: 本PBIは cleansing 40キーのみにスコープし、Obsidian/AI等の facade は 02で段階的に

## 実装者向け注記
```bash
grep -rn "loadSettings\|StorageKeys.AI_SUMMARY" src/content/extractor.ts
grep -rn "AiSummaryCleansingSettings" src/dashboard/settings/
cat src/utils/aiSummaryCleaner/rules.ts | grep "CLEANSING_RULES"
```
- `rules.ts` が唯一の情報源であることを確認し、codec はそこから `type RuleKey = typeof CLEANSING_RULES[number]['key']` を導出

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパス
- [x] type-check / lint / test が PASS (make clean test の2 FAIL解消を含む)
- [x] piiSanitizer 等の他モジュールに影響なし
- [ ] ドキュメント更新 (LAYERS.md に codec を Layer 0 として追記) — 次スプリントで extractor codec 完成時に同時更新
