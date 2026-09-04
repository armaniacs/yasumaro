# PBI 05: サニタイズ順序を sanitizeForSummarization seam に集約

優先度: 5 位 / RICE 8.0 = (8 × 2 × 50%) / 1.0w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
プライバシーパイプラインを保守する開発者として、サニタイズの順序（PII マスク→injection フィルタ→テンプレート置換→長さ上限）と danger-level 政策が 1 つの seam に集約されてほしい。なぜなら現状は順序が生呼び出し側にあり、LOW/MEDIUM が無視され、二重評価と async/sync 不整合が呼び出し点に潜むから。安全寄りのため Impact は大だが、3 モジュール（計 1300 行超）に触れるため Confidence は 50%。

## BDD受け入れシナリオ

```gherkin
Scenario: 順序が1箇所で決まる
  Given 未サニタイズの本文
  When  sanitizeForSummarization を実行する
  Then  PII マスク→injection フィルタ→テンプレート→上限の順で処理される

Scenario: danger-level が政策どおりに扱われる
  Given high/low の各コンテンツ
  When  実行する
  Then  high は阻止、low は警告付き通過になる（呼び出し側の個別判断が不要）

Scenario: 二重評価がない
  Given 同一コンテンツ
  When  実行前後で sanitize 呼び出し回数を数える
  Then  各段が1回ずつになる
```

## 受け入れ基準
- [x] `sanitizeForSummarization`（仮名）seam が順序＋level 処理＋prompt 検証を所有する
- [x] `piiSanitizer` / `promptSanitizer` / `customPromptUtils` は内部 seam として残り、呼び出し側から直接呼ばれない（`privacyPipeline.ts:104/188/223/263` が seam 越しになる）
- [x] LOW/MEDIUM 無視・二重評価・async/sync 不整合の各箇所が解消される（または政策として明示化される）
- [x] パターンテーブル自体の再構築はしない（スコープ外。順序の所有者決めに限定）
- [x] 既存 sanitizer＋pipeline suite が green。順序＋level 行列テストが追加される

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 順序＋level 行列を seam 越しに駆動（呼び出し側モック不要）
- 二重評価の呼び出し回数アサーション
### 統合テスト
- 既存テストは無修正で green（文面・検出結果不変）
### 例外ハンドリング
- high 阻止・検証失敗・空入力の経路

## 実装アプローチ
- **Outside-In**: seam のシグネチャ（text→verdict）から設計 → pipeline 呼び出しを1箇所ずつ移行 → 内部 seam 化

## 見積もり
1.0w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 順序＋level を seam 越しに決定的検証
- 非機能要件: 検出文面・マスク結果・阻止条件は不変。PII 検出漏れの回帰は newsIntegration 級のテストで確認
- Worth exploring のため、seam 化で複雑さが増す場合は縮小して着地してよい（政策の明示化だけでも可）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "sanitizeRegex|sanitizePromptContent|validatePrompt|applyCustomPrompt" src/background/privacyPipeline.ts src/background/ai/providers/*.ts src/utils/logger/*.ts | grep -v __tests__ | head -20
```
2026-09-05 時点: pipeline 329 行が 4 箇所で直接呼び分け。`sanitizers` 注入 seam（:41）あり。3 モジュール計 1300 行超。

### 実装手順
1. seam 型（入力 text＋mode、出力 verdict＋sanitized＋warnings＋level）を定義
2. pipeline の 4 呼び出しを seam 越しに（1 箇所ずつ green 維持）
3. provider/logger 側の直接呼び出しを整理（必要な範囲のみ）
4. 行列テスト追加 → 全 green

### 落とし穴
- `validatePrompt` の再サニタイズは意図的二重評価の可能性 — 削除前に意図を確認し、政策として残すか決めること
- async（PII）/sync（prompt）の混在は seam 内で吸収し、呼び出し側に漏らさないこと
- マスク結果の文面・タグ付与は AI プロンプトに直結。変更は禁止（順序の所有者決めのみ）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] sanitizer＋pipeline 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS §7 の Privacy Pipeline 節に seam を追記）
