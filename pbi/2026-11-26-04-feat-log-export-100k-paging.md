# PBI: ログエクスポートを 100,000 件に緩和する (keyset ページング)

## ユーザーストーリー
履歴の多い利用者として、JSON・CSV・Markdown で 10,000 件を超える閲覧履歴をエクスポートしたい、なぜなら現行は 1 発の query が QUERY_CAPS.plain (10,000) で切れ、超過時はエラーで `.db` エクスポート (OPFS のみ) に誘導される。保持ポリシーは 100,000 まで設定できるのに、エクスポート上限が 1 桁小さく、可搬形式で全件を扱えないから。

## ビジネス価値
- 「保存できるものはすべてエクスポートできる」不変条件を成立させる (保持ポリシー最大 100,000 とエクスポート上限の一致)
- 他ツールでの分析・スプレッドシート処理 (CSV)、可読な手動エクスポート (Markdown) が全件対象になる
- 測定方法: 10,000 件超 (例: 15,000 件) の DB から JSON/CSV/Markdown が行欠けなく出力され、100,000 件ちょうどの軽量 DB で全件往復 (エクスポート → インポート) が成功すること

## BDD受け入れシナリオ

```gherkin
Scenario: 10,000 件超の DB が全件エクスポートされる
  Given 15,000 件の閲覧履歴がある
  When JSON としてエクスポートする
  Then 15,000 件すべてが 1 つのファイルに含まれる
  And 「.db エクスポートを使え」のエラーは出ない

Scenario: ページングの境界行は重複しない
  Given 12,000 件の閲覧履歴があり、ページ境界に同時刻の行がいる
  When CSV としてエクスポートする
  Then 12,000 行が出力される (境界行の二重計上がない)

Scenario: 100,000 件超は既存の案内に従う
  Given 150,000 件の閲覧履歴がある
  When JSON としてエクスポートする
  Then 上限超過のエラーが出て .db エクスポートが案内される

Scenario: エクスポートしたものはインポートできる
  Given 100,000 件の軽量行の DB からエクスポートした JSON がある
  When そのファイルをインポートする
  Then 全行が取り込まれる (重複スキップのみ)
```

## 受け入れ基準
- [x] exportLogsService.queryAllData が keyset ページング (1 ページ QUERY_CAPS.plain、cursor は until、境界行を id で dedup、新 → 旧の行順維持) に変更されている
- [x] エクスポート上限が 100,000 件に引き上げられ、定数が limits.ts に SSOT 化されている (MAX_EXPORT_ROWS、limits-parity テストに pin)
- [x] QUERY_CAPS.plain は据え置き (一覧 UI・集計パネルへの影響ゼロ)
- [x] 100,000 超のエラー文言は新上限を示す (既存 UX 継承、1 ページ目直後にエラーで追加 fetch なし)
- [x] 軽量行 x 100,000 のエクスポート往復試験が pin されている (本物 HMAC 署名経由、inserted 100,000 / skipped 0 / バッチ 500 回 (実装の BATCH_SIZE = 200 行)。実測: ファイル 8.0MB、export 80ms / import 97ms、RSS 増分 ~170MB)
- [x] `npm run validate` が通る (関連 17 ファイル 288 件緑、type-check / lint 通過。フル validate は統合側で最終実行)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (統合 pin で裏取り、実割当ては既存方針どおり避ける)

### 統合テスト
- 複数ページ fetch の連結 (ページ境界 dedup、行順、上限凍結)、軽量行 x 100,000 のエクスポート → インポート往復

### 単体テスト
- queryAllData のページング (cursor 更新、終端判定、上限到達)
- 3 形式の出力整合 (既存試験が変わらず通る)

## 見積もり
M-L (5 SP、要チームでの見積もり)

## 技術的考慮事項
- 依存関係: PBI 05 (インポート 30 MiB) と直列推奨 (往復不変条件の試験を PBI 05 で pin する。片側だけ緩めると不変条件が壊れる)
- keyset ページングの前例: domainAnalysisPanel / fetchPeriodRows (panels/asyncData 配下)。エクスポートはパネル外のサービス層なので、実装は exportLogsService 内に完結させ、パネル実装のライフサイクル結合を持ち込まない
- メモリ特性: 100,000 行オブジェクト配列 (~100-200MB) + JSON.stringify 2 回 (署名用 + 出力用、HMAC は stringify 全体に対するため部分連結は不可)。軽量行 x 100,000 の往復試験で実測を pin する
- 進捗表示: 既存のパネル表示が壊れないこと。ページ進行の反映は任意 (行わない場合は台帳に記録)
- ローカル Markdown 書き出し (markdownExport.ts の DATE_RANGE_QUERY_LIMIT = 10,000) は本 PBI の範囲外 (別機能、後続候補)
- なぜなぜ分析 30 回: エクスポートが 10,000 件で止まるのは、QUERY_CAPS.plain (一覧用 cap) を全件ダンプが再利用したから。keyset ページング (domainAnalysisPanel 前例) でグローバル cap を触らずに解く

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "EXPORT_ROW_LIMIT\|queryAllData" src/dashboard/exportLogsService.ts
grep -rn "QUERY_CAPS" src/utils/limits.ts src/offscreen/queryPlan.ts | head
grep -rn "until" src/dashboard/panels/asyncData/domainAnalysisPanel.ts | head -10
```
確認結果 (2026-11-26):
- queryAllData は 1 発 query (limit 10,000、created_at DESC)。total > rows でエラー (exportLogsService.ts:40-55)
- QUERY_CAPS.plain = 10,000 (limits.ts:86)。tagCluster hotfix 6.8.12 で 1,000 → 10,000 に引き上げた経緯がある
- keyset ページング前例: domainAnalysisPanel (until cursor 包含再読 + id dedup + fetch 時凍結上限)

### 実装手順
1. limits.ts に MAX_EXPORT_ROWS = 100_000 を追加 (limits-parity テストの EXPECTED も更新)
2. queryAllData を keyset ページングに変更 (1 ページ QUERY_CAPS.plain、until cursor、dedup、上限到達で停止)
3. 3 形式 (JSON/CSV/Markdown) の既存試験を通しつつ、境界試験を追加
4. 軽量行 x 100,000 往復試験 (Red → Green)

### 落とし穴
- JSON エクスポートの HMAC は JSON.stringify(body, null, 2) 全体に対する署名。部分連結での byte 一致は保証されないため、全行保持 + 一括 stringify を維持する
- until cursor は包含再読 (境界行が 2 ページに現れる)。id で dedup する
- queryLogs の total は最初のページで取得し、fetch 中の増加は凍結 (前例に倣う)
- ESM import は .js 拡張子必須。コメントは非自明な WHY のみ。絵文字禁止
- git 操作は一切しない (統合側が行う)

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新の要否判定: 本 PBI はユーザーに見える上限を変えるため docs 更新が必須。PBI 2026-11-26-06 で実施
