# PBI: nav trail writer を VALID_VISIT 由来に再配線し、通常サイトでリファラー記録を復活させる

## ユーザーストーリー

nav trail を opt-in で有効化したユーザーとして、localhost 以外の通常サイトでもリファラーと検索語が記録されてほしい。現在の唯一の writer が `changeInfo.url` 依存で、`tabs` 権限なし・host_permissions 最小化のため通常サイトで一度も発火しないから（ADR 2026-10-07-tab-url-permission-decision 裁定）。

## 優先度

- 順位: 未割当（PBI 2026-10-07-07 裁定の後続 fix）
- RICE: 7.2（R3 / I3 / C0.8 / E1）
- 根拠: 実質死んでいる opt-in 機能の復活。manifest 権限変更（高リスク領域）を避ける再配線であり、語義変化（即時 → 記録時）を pin する必要がある
- 依存: なし（裁定は ADR 2026-10-07 で確定済み）

## 背景（file:line 現状）

- writer（通常サイトで no-op）: `src/background/service-worker.ts:268-281` — `chrome.tabs.onUpdated` リスナーの `if (changeInfo.url && !tab.incognito)`。`changeInfo.url` は `tabs` 権限か対象 URL の host permission があるときだけ配信され、manifest は通常サイトでどちらも持たない
- reader（記録時）: `src/background/handlers/recordingHandlers.ts:122-124` — VALID_VISIT が `sender.tab.url`（MessageSender 由来・全 http(s) ページで読める）で `resolveNavTrailFields` を呼ぶが、map が空のため `navSourceUrl` / `searchQuery` は常に空
- nav trail の実体: `src/background/navTrail/navTrailTracker.ts:69-93`（`onTabUrlChanged`）— consent ゲート・Mutex・reload/fragment 判定はここに既存
- 語義変化: `changeInfo.url` は遷移の即時点、VALID_VISIT は記録条件（同意・エンゲージメント閾値）成立後。現行 writer は通常サイトで一度も発火していないため、no-op → 遅延化であり実質的な退化ではない
- 裁定: ADR `dev-docs/ADR/2026-10-07-tab-url-permission-decision.md` — manifest 変更なし。badge URL 経路の no-op は受容済み（本 PBI の対象外）

## BDD受け入れシナリオ

```gherkin
Scenario: 通常サイトでの記録成立時にリファラーが入る
  Given nav trail が有効で content script が VALID_VISIT を送信する
  When 記録が処理される
  Then 同一タブの前回記録 URL が navSourceUrl に入り、検索エンジン由来なら searchQuery も入る

Scenario: 記録しない訪問では map が更新されない（語義 pin）
  Given nav trail が有効でも記録条件が成立していない訪問がある
  When その訪問が終わる
  Then nav trail の session map は更新されない（記録条件成立後のみ供給される）

Scenario: consent off の間は供給しない
  Given nav trail の consent が無効である
  When VALID_VISIT が処理される
  Then map への供給は行われず、既存の consent watcher の drop も維持される
```

## 受け入れ基準

- [ ] `src/background/service-worker.ts` の `changeInfo.url` writer を削除する（reader は `recordingHandlers.ts:122-124` に残す）
- [ ] VALID_VISIT ハンドラから nav trail map への供給を追加する（admit 後・記録成否に依存しない位置。consent ゲート `isNavTrailActive` は `navTrailTracker` 内で維持）
- [ ] 語義変化を pin: テストで「記録条件成立後のみ map 更新」を固定する
- [ ] 同一タブ連続記録で `previous` が前回の `current` になる pin を維持（`navTrailTracker` の reload/fragment 判定は現状のまま）
- [ ] badge URL 経路（`tabEventHandlers.ts` / `service-worker.ts`）は no-op のまま受容 — 既存の ADR 根拠コメントを維持し、挙動変更しない
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/background/navTrail/navTrailTracker.ts` と VALID_VISIT ハンドラの pin テスト（fixture 先行: 現状は map が空になることを固定してから再配線）
- 配置: `src/**/__tests__/`、実時間待ちは使わない（`testDir/waitPolicy.ts` の方針）
- 配線変更の parity テスト: `senderTrustCoverage.test.ts` の trust table は変更しない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] 手動確認: 実ブラウザで通常サイトの記録後に履歴診断行に navSourceUrl が表示される（ADR の no-op 一覧と矛盾しないこと）
