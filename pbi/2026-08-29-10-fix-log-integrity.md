# PBI: ログ完全性 — attribution と制御文字無害化（VULN-019/044, CWE-290/117）

## ユーザーストーリー
開発者として、拡張の永続ログの送信元属性が偽装できず、外部応答の本文が行構造を壊して書き込まれないようにしたい、なぜなら LOG_FORWARD が payload の `source` を鵜呑みにし、Obsidian エラー本文が改行/ANSI/制御文字を含んだまま永続化され、障害解析の一次証跡が信頼できなくなるから

## ビジネス価値
- VULN-019: `_source='service-worker'` が dashboard.html 送信から forge 可能（実証済み）→ sender 由来に固定
- VULN-044: Obsidian エラー本文の多行注入＋ANSI＋NUL が永続化（実証済み）→ logger 境界で無害化
- 測定方法: `_source` が sender.url から派生すること、永続ログに `\n\r`/制御文字/ANSI エスケープが存在しないこと

## 優先度
- 順位: 10 / 14
- RICEスコア: 713（Reach=300 / Impact=0.25 / Confidence=95% / Effort=0.1人月）
  - Reach 300: LOG_FORWARD は extension-only（offscreen 送信が想定）。Obsidian エラー経路は実運用で到達
  - Impact 0.25: ログ完全性（情報影響。実証の通り現行には dashboard log viewer sink は存在しない）
  - Confidence 95%: logger 永続化は単一 choke point。PII マスクは維持
  - Effort 0.1: handler 1 箇所＋logger 1 境界＋テスト
- 根拠: ログが障害解析・監査の一次証跡であるという位置づけを契約として明文化し、境界で無害化する

## BDD受け入れシナリオ

```gherkin
Scenario: LOG_FORWARD の attribution は sender 由来になる
  Given 拡張ページが payload { source: "service-worker" } で LOG_FORWARD を送る
  When handler がログを書く
  Then _source は sender.url から派生した値になり、payload の source は表示ヒントとしてのみ扱われる（または無視される）

Scenario: 多行本文は 1 行化されて永続化される
  Given Obsidian エラー本文に "\n[Logger:fake] forged" が含まれる
  When addLog が永続化する
  Then 改行は無害化（区切り置換または除去）され、偽エントリとして解釈できない

Scenario: 制御文字・ANSI エスケープは除去される
  Given エラー本文に "\u001b[31m" や NUL が含まれる
  When logger が永続化する
  Then エスケープシーケンスと制御文字が除去/可視化される

Scenario: PII マスクは現行どおり動作する（回帰防止）
  Given メッセージに API キー風文字列が含まれる
  When logger が永続化する
  Then 既存 sanitizeRegex のマスク結果と一致する
```

## 受け入れ基準
- [ ] `src/background/handlers/systemHandlers.ts:258-264` が `_source` を `sender.url`/`sender.origin` から派生させ、payload `source` を trusted として使わない
- [ ] logger 永続化経路（`src/utils/logger/*`）に `\n`/`\r`/制御文字/ANSI エスケープの無害化が実装されている（PII マスクの前後どちらかを明記）
- [ ] Obsidian の 2 エラー経路（`obsidianClient.ts:167,200`）が境界修正の恩恵で解消されることをテストで確認
- [ ] LOG_FORWARD の message/details も同一無害化を通る（VULN-044 の co-parameter）
- [ ] 新規テストで「attribution 派生」「多行注入」「ANSI/制御文字」「PII 回帰」が検証されている
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: attribution 偽装・多行注入の再現テストが失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（dashboard log viewer は現行不存在のため）

### 統合テスト
- `LOG_FORWARD` handler × logger モック: sender 由来 attribution の統合検証
- `ObsidianClient` エラー経路 × logger: 多行本文の 1 行化

### 単体テスト
- 新規: `src/utils/logger/__tests__/logNeutralization.test.ts`
  - ビジネスロジック: 無害化の結果（区切り置換の形式）
  - 境界値: 空文字、連続改行、混在 ANSI、絵文字（維持）
  - 例外: 巨大本文（長さ cap との相互作用）

## 実装アプローチ
- **Outside-In**: handler テストを Red（payload source が使われる）→ sender 派生で Green → logger 無害化を Red→Green
- **Red-Green-Refactor**: 無害化は 1 ヘルパーに集約し、PII マスクとの適用順を固定

## 見積もり
1pt（要チームでの見積もり — handler 1 箇所＋logger 1 境界＋テスト）

## 技術的考慮事項
- 依存関係: Wave 2。PBI 03 と `systemHandlers.ts` を共有 → マージ順に注意
- テスタビリティ: 無害化関数は純粋関数として抽出
- 非機能要件: 正常ログの可読性を損なわない（区切りは視認可能な文字列へ置換）
- 注意: payload `source` を UI 表示ヒントとして残す場合は untrusted として明示ラベルを付ける
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '250,270p' src/background/handlers/systemHandlers.ts
sed -n '160,205p' src/background/obsidianClient.ts
rg -n "sanitizeRegex|addLog" src/utils/logger --type ts
```

### 実装手順
1. LOG_FORWARD handler の `_source` を sender 派生に
2. logger 無害化ヘルパー（`\n\r` → 置換、`\u0000-\u001f` 除去、ANSI CSI 除去）を実装
3. 永続化経路に適用、テスト追加、`npm run validate`

### 落とし穴
- `_source` の sender.url は offscreen 等で同じ URL になる — コンテキスト判別が必要なら `context` 情報（既存 `_source` の使い方）と合わせて設計すること
- ANSI 除去で正当な本文中の `\u001b` 相当文字（esc キー）を過剰に壊さないこと — CSI シーケンスのみ対象
- PII マスクが無害化後に走るとマスク対象が変化する可能性 — 順序をテストで固定

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-019/044 が解消されること
