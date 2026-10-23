# PBI: 外部連携 ― 最小Webhookエクスポート

## ユーザーストーリー
Notion/Slack併用の人として、特定タグや高エンゲージメントの記録だけを外部に送りたい、なぜなら二重入力と見逃しをなくしたいから

## 優先度
- 順位: 05 / 6候補
- RICEスコア: 320 (Reach=200 / Impact=2 / Confidence=0.8 / Effort=1.0人週)
- 根拠: Bと同点だが到達範囲が狭い(パワーユーザー層)のため後に置く。E7相当。Effort小で早期に勝てる
- 依存: PBI 01のegress宣言パターンに従うこと。新規送信先はhost_permissions+CSPのSSOT経由で追加する

## 背景・制約
- 最小Webhookに限定し、双方向同期・BI直結は含めない
- 送信先は明示設定のみ。未宣言originはfail-closed(CSPで遮断)にする。6.9.52のGist 3pinを規範にする
- PIIマスキング・プライベート除外を送信前に適用する。マスターパスワード保護の流用はしない

## BDD受け入れシナリオ
Scenario: タグ付き記録が転送される
  Given 転送条件(タグ指定)に合う記録が新規保存された
  When Webhookが有効である
  Then 要約・タグ・URLが設定先に1件転送される

Scenario: 未宣言送信先は遮断される
  Given 送信先が未宣言originである
  When 転送しようとした
  Then ネットワークに出さず遮断し、設定画面に理由が表示される

## 受け入れ基準
- [ ] 転送条件(タグ/エンゲージメント)の設定ができる
- [ ] 転送履歴と再送ができる
- [ ] 未宣言originの遮断がe2e pinで固定される
- [ ] 送信前にPIIマスキングとプライベート除外が適用される

## テスト戦略
## 実装記録（2026-10-23・最小ペイロード経路）
- ペイロード整形: 完了。`src/background/webhookExport/webhookExportPayload.ts` の `buildWebhookExportPayload` が要約・タグ・URLのみの最小ペイロードを構築。raw ページコンテンツは持たない(PIIマスキングは永続後のクレンジング済み要約に乗る)。空URLは null(縮退の出口)
- 転送条件: 完了。`matchesWebhookExportCondition` がタグ(先頭#を剥離)+エンゲージメント(スクロール深度/滞在秒)しきい値を判定。未入力はfail-closed(欠落フィールドは設定済み条件を満たさない)
- 送信先ゲート: 完了。`isWebhookUrlAllowed` がhttpsのみ許可(非https/空/unknownは遮断)。origin取得は `webhookUrlOrigin`。未宣言originの遮断は送信経路で既存 `permissionManager.isHostPermitted`(chrome.permissions.contains)に従う(新規評価路は追加していない)
- stored shape 正規化: `normalizeWebhookExportTags` がCSV文字列/リスト両形態を正規化
- pin: `src/background/webhookExport/__tests__/webhookExportPayload.test.ts` 9テスト(最小ペイロード・条件テーブル・httpsゲート・正規化)
- 残: 転送条件の設定UI、転送履歴と再送、送信経路(SW fetch+通知)、未宣言origin遮断のe2e pin、コードレビュー、ドキュメント更新(PERMISSIONS送信先章・SECURITYのScope)
- E2E: 条件一致→転送→表示、未宣言origin遮断の2pin
- 統合: 再試行・重複抑止・順序のテスト
- 単体: 条件判定・ペイロード整形・マスク適用のテーブルテスト

## 見積もり
1.0人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(PERMISSIONSの送信先章・SECURITYのScope)
