# PBI 14: bench CLI の成果物書き出しを writeArtifacts に抽出

優先度: 4 位 / RICE 20 = (4 × 1 × 100%) / 0.2w / Strength: Strong
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)
依存: PBI 13 に続いて同一ファイル（cli.mjs）へ着手

## ユーザーストーリー
ベンチハーネスを保守する開発者として、成果物（md/json/html/trend/prune）の書き出しポリシーが 1 つの深い関数にまとまってほしい。なぜなら main() が orchestration と DCI を混在させ、成果物変更のたびにエントリポイントを編集することになるから。

## BDD受け入れシナリオ

```gherkin
Scenario: 3 点セット + trend + prune が 1 呼び出しで書き出される
  Given results と comparison がある
  When  writeReportArtifacts を呼ぶ
  Then  micro-<stamp>.md / .json / .html が書き出される
  And   .json には当日実行が含まれ、html の Trend がその世代を参照する
  And   pruneReports が呼ばれる

Scenario: 成果物書き出しの失敗はベンチ実行を失敗させない
  Given 書き出し先ディレクトリが書き込み不可
  When  writeReportArtifacts を呼ぶ
  Then  stderr に警告が出る
  And   例外は外に漏れない
```

## 受け入れ基準
- [ ] `writeArtifacts.mjs` に writeReportArtifacts が抽出される
- [ ] cli.mjs main() は bench → compare → writeReportArtifacts → check/update-baseline に縮小
- [ ] 既存の smoke（3 点セット生成・trend 含有・prune）が green
- [ ] --check / --update-baseline モードも同一関数経由

## テスト戦略（t_wadaスタイル）
### 単体テスト
- writeArtifacts.test.ts: 3 点セット存在・trend 注入・prune 呼び出し・書き込み失敗時の advisory 挙動
### 統合テスト
- 既存スモーク（bench:micro --filter c2 --quick --no-open）

## 実装アプローチ
- **Outside-In**: smoke の成果物契約から逆算し writeArtifacts を設計

## 見積もり
0.2w

## 技術的考慮事項
- 依存関係: PBI 13 の後に着手（cli.mjs 競合回避）
- テスタビリティ: fs 注入は不要（mkdtemp で実 fs をテスト）

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '102,190p' bench/harness/cli.mjs
```
:114-159 に compare + 成果物ブロック、:161-184 に check/update-baseline 分岐。

### 実装手順
1. `writeArtifacts.mjs` を新設（stamp 生成・mkdirSync・md/json/html 書き出し・loadTrendHistory・pruneReports を移動、advisory catch 維持）
2. `writeArtifacts.test.ts` を先に書いて赤 → 実装 → green
3. cli.mjs main() を縮小

### 落とし穴
- `now`（ISO stamp）は cli で 1 回生成して注入（日付跨ぎの不整合防止）
- check モードの exit コード判定は成果物書き出しの後に来る — 順序を壊さない

## Definition of Done
- [ ] writeArtifacts 単体テスト green
- [ ] bench スモーク green（3 点セット + trend）
- [ ] コードレビュー完了
- [ ] ドキュメント更新（README Files ツリーに writeArtifacts.mjs を追加）
