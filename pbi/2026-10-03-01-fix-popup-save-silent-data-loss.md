# PBI: pending 保存で失敗結果が握りつぶされ、データが静かに失われるのを修正する

種別: fix (adversarial-review, RICE #1)

## ユーザーストーリー

保存したページが確実に Obsidian 側へ記録され、失敗した場合はそのことが分かることを期待するユーザーとして、pending 保存の失敗が UI 上で無音に消えないでほしい。失敗が表示されなければ、ユーザーは消えたデータに気付けないから。

## 優先度

- 順位: 01/15
- RICE: 36.0 (R6 / I3 / C1.0 / E0.5)
- 根拠: 手動保存フロー (btn-save-selected / btn-save-whitelist) から常に到達し、失敗が何も表示されずにデータ損失へ直結するため R6。依存注記: 本 PBI 完了後に error-display-contract PBI (rank 10) が `src/popup/pendingPages.ts:20` に触れるため、本 PBI を先に着手する。

## 背景 (evidence, verified)

- `src/popup/pendingPages.ts:116-125` — `recordPendingPage` の戻り値を検査せず、`removePendingPages` を無条件実行。gateway (`src/messaging/pendingRecordGateway.ts:75-84`) は全失敗を `{success:false}` に正規化して reject しないため、外側 catch (`:127-129`) は reject 時にしか発火しない → データが消えたのに UI は成功扱い。
- `src/popup/pendingPages.ts:94,96` — `addDomainToWhitelist` / `addPathToWhitelist` の `{ok:false}` を無視 (`invalid-pattern` は本番到達可能 / `no-domain` はテスト限定、writer `src/popup/whitelistWriter.ts:46-58`)。
- 部分成功: バッチ内で reject すると `removePendingPages` が未実行のまま残り、記録済み URL が pending に残留 → 再試行で重複記録。
- バックグラウンドの再登録 fire-and-forget (`recordingOutcome.ts:64` の `void addPendingPage`) が `PENDING_PAGES_KEY` 上の last-write 競合になり得る。

## スコープ (file:line)

- `src/popup/pendingPages.ts:116-125`
- `src/popup/pendingPages.ts:94-97`
- `src/popup/pendingPages.ts:127-129`

## BDD 受け入れシナリオ

```gherkin
Scenario: 選択ページの保存が成功する
  Given 保存したいページが pending リストにある
  When ユーザーがページを選択して保存を実行する
  Then 選択したページが記録され pending リストから消える

Scenario: 記録に失敗した場合はエラーが表示され、ページは消えない
  Given 保存したいページが pending リストにある
  When 記録処理が失敗する
  Then エラーメッセージが表示される
  And 該当ページは pending リストに残る

Scenario: 白リスト追加に失敗したことが表示される
  Given 保存対象に白リストへ追加できない URL が含まれる
  When ユーザーが白リスト付き保存を実行する
  Then 追加できなかったことがエラーで表示される
```

## 受け入れ基準 (file-scoped)

- [ ] `src/popup/pendingPages.ts:116-123` — `recordPendingPage` の戻り値 `{success:false}` を検査し、失敗を `reportActionFailure` 経由で報告する (現在は無視)
- [ ] `src/popup/pendingPages.ts:125` — `removePendingPages` を記録結果に応じて実行し、失敗 URL が pending に残る仕様を明文化する
- [ ] `src/popup/pendingPages.ts:127-129` — reject 経由だけでなく result 経由の失敗でも報告が到達する
- [ ] `src/popup/pendingPages.ts:94,96` — `addDomainToWhitelist` / `addPathToWhitelist` の `{ok:false}` を検査して報告する (現在は無視)
- [ ] 一括保存で一部のみ成功した場合、未成功 URL が pending に残り、再試行で重複記録が起きないことがテストで固定される (`recordingOutcome.ts:64` の fire-and-forget 登録との last-write 競合を考慮)

## テスト戦略

- E2E: popup の btn-save-selected / btn-save-whitelist 手動フローで、失敗注入時にエラー表示と pending 残存を確認
- 統合: gateway 応答を `{success:false}` にした場合の `saveSelectedPages` 振る舞いテスト (部分成功 / 全失敗)
- 単体: `whitelistWriter` の `{ok:false}` (`invalid-pattern`) が pendingPages で報告されることのテスト

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
