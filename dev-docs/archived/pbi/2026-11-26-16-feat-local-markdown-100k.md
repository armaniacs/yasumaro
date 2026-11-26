# PBI: ローカル Markdown 書き出しの上限を 100,000 件に緩和する (keyset ページング)

## ユーザーストーリー
大容量履歴の利用者として、ローカル Markdown 書き出し (MARKDOWN_DOWNLOAD) でも 10,000 件を超える日付範囲を出力したい、なぜなら現行は `markdownExport.ts:34` の `DATE_RANGE_QUERY_LIMIT = 10000` で 1 発 query が切れ、上限超過時は silently truncated になる。PBI 04 (JSON/CSV/MD エクスポート 100k) との一貫性が取れないから。

## ユーザーへの背景
- 現状: `exportDateRange` (markdownExport.ts:229-264) は queryLogs に limit 10,000 を 1 発で投げ、total を確認しない。保存ポリシー 100,000 件とエクスポート上限の 1 桁差は PBI 04 で解消済みだが、この経路だけ旧上限のまま
- keyset ページングの前例: exportLogsService.queryAllData (PBI 04 実装、until cursor 包含再読 + id dedup + stall 回避)

## ビジネス価値
- 日付範囲ローカル出力が 100,000 件まで対応し、PBI 04 のエクスポート上限と一貫する
- 上限超過時の silent truncation が消える (上限到達で明示)
- 測定方法: 15,000 件の日付範囲が全件出力され、上限ちょうどで成功すること

## BDD受け入れシナリオ

```gherkin
Scenario: 10,000 件超の日付範囲が全件出力される
  Given 15,000 件の閲覧履歴が 3 日間に分散している
  When その 3 日間をローカル Markdown に書き出す
  Then 15,000 件すべてが出力される (ページ境界の重複なし)

Scenario: 上限ちょうどは成功する
  Given 100,000 件ちょうどの閲覧履歴がある
  When ローカル Markdown に書き出す
  Then 100,000 件すべてが出力される
```

## 受け入れ基準
- [x] exportDateRange が keyset ページング (ASC 順、cursor は最終 created_at を since に包含再読、id dedup) に変更されている
- [x] 上限が MAX_EXPORT_ROWS (limits.ts SSOT) に統一され、DATE_RANGE_QUERY_LIMIT はページサイズとして維持される
- [x] 上限到達時は「部分出力で終わる」のではなく、到達した件数を返す (現行 totalRows 契約維持、上限超過の分は出力しない)
- [x] markdownExport.test.ts にページング境界試験 (10,000+ 件、dedup、上限) がある
- [x] MARKDOWN_DOWNLOAD 関連ドキュメント (docs/markdown-download.md など上限記載があれば) を更新する
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (統合 pin で裏取り)

### 統合テスト
- 既存 markdownExport 試験群 (挙動不変)

### 単体テスト
- queryLogs mock によるページング試験 (cursor 更新、dedup、上限停止、totalRows 集計)

## 見積もり
S (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: 台帳 00/07 の後続候補 (ローカル Markdown 書き出しの DATE_RANGE_QUERY_LIMIT = 10,000)
- 外部挙動: 上限緩和のみ (10,000 → 100,000)。ページングは新設だが出力形式は不変
- YAGNI: 100,000 超の対応はしない (.db エクスポートと PBI 04 の上限超過エラー UX が役割分担)
- 無限ループ防止: PBI 04 前例 (病理ケースの 1ms ステップバック、同時刻 > 上限の限界を pin) を踏襲

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "DATE_RANGE_QUERY_LIMIT\|exportDateRange" src/dashboard/markdownExport.ts
grep -rn "DATE_RANGE_QUERY_LIMIT" src/ --include="*.ts" | grep -v markdownExport.ts | head -5
grep -n "until\|since" src/messaging/sqliteWireTable.ts | head -8
```

### 実装手順
1. ページング試験を先に (Red: 10,000+ 件 mock で部分出力を確認)
2. exportDateRange を keyset ページングに変更 (ASC cursor、dedup)
3. 上限を MAX_EXPORT_ROWS に統一 (limits.ts import)
4. 境界試験 Green、既存試験の pin 確認

### 落とし穴
- ASC 順の keyset cursor は「包含再読」で境界行が 2 ページに現れるため id で dedup する (DESC 前例と cursor 方向が逆)
- 同一 created_at が大量 (> 上限) に並ぶ病理ケースは PBI 04 前例の 1ms ステップバックで stall を回避する
- groupEntriesByLocalDate は rows 全体が揃ってから呼ぶ (ページごとに日付ファイルを書かない)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了
- [x] リファクタリング完了 (グリーン後)
- [x] ドキュメント更新の要否判定: ユーザーに見える上限が変わるため docs 更新が必須 (本 PBI 内で対応)
