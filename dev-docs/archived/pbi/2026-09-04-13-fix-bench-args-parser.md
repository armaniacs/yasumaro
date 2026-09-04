# PBI 13: bench CLI の引数パーサを純関数モジュールに硬化

優先度: 3 位 / RICE 24 = (6 × 0.5 × 80%) / 0.1w / Strength: Worth exploring
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)

## ユーザーストーリー
ベンチを実行する開発者として、`--filter --check` のようなフラグ組み合わせが黙って誤動作せず、引数パースの仕様がテストで固定されてほしい。なぜなら NEXT センチネルの位置消費が `--check` を飲み込む潜在的バグだから。

## BDD受け入れシナリオ

```gherkin
Scenario: --filter= 形式は正規支持
  Given argv が ["micro", "--filter=c2,c7"] のとき
  When  parseArgs を実行する
  Then  filter は ["c2","c7"] で check は false

Scenario: --filter の次に別フラグが来たら飲み込まない
  Given argv が ["micro", "--filter", "--check"] のとき
  When  parseArgs を実行する
  Then  --check はフラグとして解釈される
  And   filter は null（または空）のまま
```

## 受け入れ基準
- [x] `bench/harness/args.mjs` に純関数 parseArgs が抽出される
- [x] 裸 `--filter` は次トークン 1 個のみ消費し、`--` で始まるトークンは消費しない
- [x] 既存の全 documented 用法（--filter= / --filter c2 / --filter c2,c7 / --check / --update-baseline / --quick / --no-open）が動作
- [x] args 単体テストで網羅
- [x] cli.mjs main() は parseArgs 呼び出しのみに縮小

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 各フラグ・組み合わせ・未知フラグ・filter の 3 形式（= 付き / 裸 + 値 / 裸 + フラグ衝突）
### 統合テスト
- `npm run bench:micro -- --filter c2 --quick --no-open` スモークが既存どおり動く

## 実装アプローチ
- **Outside-In**: args.mjs の単体テスト赤 → 実装 → cli.mjs 置換 → スモーク

## 見積もり
0.1w

## 技術的考慮事項
- 依存関係: PBI 14 は本 PBI 後に同一ファイルへ着手
- テスタビリティ: parseArgs は純関数（process 参照なし）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "parseArgs|NEXT" bench/harness/cli.mjs
```
:29-42 に parseArgs（'NEXT' センチネル）、:69 で loadDefinitions(opts.filter)。

### 実装手順
1. `args.mjs` を新設 + `args.test.ts` を先に書いて赤
2. cli.mjs から parseArgs を削除し import に置換
3. スモーク実行

### 落とし穴
- `--filter` 裸形式は「次トークンが -- で始まらない場合のみ」値として消費（後方互換）
- ヘッダコメント（cli.mjs:5-9）の用法記載と乖離させない

## Definition of Done
- [x] args 単体テスト green
- [x] bench スモーク green
- [x] コードレビュー完了
- [x] ドキュメント更新（cli ヘッダコメントの用法が正しいこと）
