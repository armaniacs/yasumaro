# PBI: research report の citation link-text に誤 sanitizer を使用している (CWE-79 Medium)

## ユーザーストーリー
拡張機能ユーザーとして、研究レポートの引用リンクのリンク先がレコード本来の URL に限定されたい、なぜなら攻撃者ページのタイトルが citation の link-text 位置を early-close して任意のリンク先 (`javascript:alert(1)` 等) をユーザーの Obsidian ノートとローカル .md に注入できるから (VulnHunter VULN-004、CWE-79 Medium)。

## ビジネス価値
- 攻撃者ページがレポート経由で任意リンク先を注入する脆弱性を解消する
- 測定方法: exploit test 004 の注入ペイロード (`x](javascript:alert(1))`) が sanitizeForMarkdownLinkText 適用後はエスケープされ、生成 markdown に攻撃者選択のリンク先が現れないこと

## BDD受け入れシナリオ

```gherkin
Scenario: 攻撃者タイトルはリンク先を注入できない
  Given 攻撃者ページのタイトルが "x](javascript:alert(1))" のレコードがある
  When EXPORT_RESEARCH_REPORT でレポートを生成する
  Then citations section のリンクテキストは [ ] ( ) がエスケープされ、
    リンク先は r.url (sanitizeUrlForMarkdownTarget 適用済み) のみである
  And 攻撃者選択のリンク先 (javascript: 等) は生成 markdown に現れない

Scenario: 正常なタイトルは従来どおり表示される
  Given 正常なタイトル (括弧を含まない) のレコードがある
  When citations section が生成される
  Then タイトルはそのまま表示される (over-escaping しない)
```

## 受け入れ基準
- [x] buildCitationsSection (researchReportGenerator.ts:123) の link-text 位置で sanitizeForMarkdownLinkText を使用している (markdownSanitizer.ts:116-141 契約、sibling callers と同一)
- [x] 既存の exploit test 004 (注入ペイロード) が fix 後の挙動 pin に更新され、エスケープを確認する
- [x] digest / timeline / holes セクション (sanitizeForObsidian が正しい位置) は無変更
- [x] `npm run validate` が通る
- [x] `npm run generate-notices` / export 系の byte-identical pin が壊れない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (research report E2E が経路を通る)

### 統合テスト
- exploit test 004 を新契約 (fix 後 pin) に更新: 注入ペイロードがエスケープされること

### 単体テスト
- buildCitationsSection の境界 (括弧含むタイトル、`[` 先頭タイトル) 追加

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md VULN-004 (CONFIRMED Medium)、phase3_output.md fix strategy
- 外部挙動: fix により生成 markdown の citation が変わる (脆弱挙動の解消) ― 既存バックアップ互換性は無関係 (生成物)
- 依存関係: なし (1 行修正 + import)
- ロールバック: 1 行リバートで戻る (挙動は元の脆弱状態に戻るが破壊的でない)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '116,126p' src/background/researchReportGenerator.ts
grep -n "sanitizeForMarkdownLinkText" src/utils/markdownSanitizer.ts
```

### 実装手順
1. researchReportGenerator.ts:123 の sanitizeForObsidian を sanitizeForMarkdownLinkText に差し替え (:28 の import に追加)
2. exploit test 004 (VULNHUNT_DIR/exploit_tests/test_vuln_004_markdown_link_injection.test.ts) を新契約 pin に更新
3. 境界試験追加

### 落とし穴
- sanitizeForObsidian を他の位置 (digest/timeline/holes ― :116,159,166,178) で差し替えない (plain-text 位置では正しい)
- import が :28 の既存 markdownSanitizer import に統合される (重複 import しない)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了 (セキュリティ変更のため For Security Review Agents 観点を PR 説明に明記)
- [x] リファクタリング完了 (グリーン後)
- [x] ロールバック手段: 1 行リバート (破壊的でない)
- [x] ドキュメント更新の要否判定: 生成物の変化は脆弱挙動の解消のみ、docs 更新は不要
