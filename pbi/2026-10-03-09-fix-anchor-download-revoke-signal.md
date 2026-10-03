# PBI: exportLogsService の 60s 固定 revoke を完了シグナル化（または 3 箇所で一貫した成文化）

## ユーザーストーリー

遅い環境でログをエクスポートするユーザーとして、60 秒以上かかるダウンロードが勝手に切られないでほしい。anchor-click 経路の固定 60s タイマーは遅い環境で revoke が先行して静かに失敗させるから。

## 優先度

- 順位: 09/15
- RICE: 2.7（R3 / I0.5 / C0.9 / E0.5）
- 根拠: 60s 超 download の静かな失敗（R3）だが発生頻度は低い（I0.5）。完了シグナルの有無の調査と、コメント横展開かシグナル化の小変更（C0.9・E0.5）
- 依存: なし（`src/dashboard/exportLogsService.ts` のみ。対照ファイルへの変更なしを想定）

## 現状（証拠）

- `src/dashboard/exportLogsService.ts:145` に `DOWNLOAD_REVOKE_DELAY_MS = 60_000`
- `src/dashboard/exportLogsService.ts:155` で `setTimeout` revoke（downloadBlob `:147-156`、anchor-click 経路）
- 他経路は既に settle 駆動: `src/dashboard/panels/connectionTests.ts:465-469`、`src/dashboard/markdownExport.ts:290-294`（保持理由の justification コメント `:291-293` 付き）
- 60s 超（遅い環境）の download は静かに revoke される

## BDD受け入れシナリオ

```gherkin
Scenario: 60s 超のダウンロードでも revoke が先行しない（シグナル化の場合）
  Given download が 60 秒以上かかる
  When 完了シグナルが返る
  Then revoke は完了シグナル後に 1 回だけ実行され、固定タイマーに依存しない

Scenario: 60s 維持の場合は理由が 3 箇所で一貫して成文化される
  Given anchor-click 経路に await 可能な完了シグナルが存在しない
  When 60s を維持する裁定をする
  Then 3 箇所（exportLogsService.ts / connectionTests.ts / markdownExport.ts）に同一の WHY コメントが残り、無根拠の固定タイマーでないことが pin される
```

## 受け入れ基準

- [ ] `src/dashboard/exportLogsService.ts:147-156`（anchor-click 経路）に await 可能な完了シグナルが存在するかを調査した結果が実装記録に 1 行残されている
- [ ] シグナルが存在する場合: `src/dashboard/exportLogsService.ts:155` の setTimeout revoke が完了シグナル駆動に置換される
- [ ] シグナルが存在しない場合: `src/dashboard/exportLogsService.ts:145` の 60s 根拠が `src/dashboard/panels/connectionTests.ts:465-469` と `src/dashboard/markdownExport.ts:290-294` と一貫した単一 WHY コメントとして 3 箇所に成文化される
- [ ] 成功経路で revoke が 1 回だけ実行され、重複 revoke と URL 漏れがない
- [ ] 裁定（シグナル化 / codify 60s）と証拠が実装記録に残されている

## テスト戦略

- 単体: downloadBlob の revoke タイミングをテスト（シグナル化の場合は完了イベント駆動・固定タイマー不使用を pin、AGENTS.md の実時間待ち禁止に従う）
- 単体: 60s 維持の場合は 3 箇所のコメント一貫性を pin する軽量テストまたはレビュー確認
- 既存テスト green 維持 + `npm run validate` が通ること

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
