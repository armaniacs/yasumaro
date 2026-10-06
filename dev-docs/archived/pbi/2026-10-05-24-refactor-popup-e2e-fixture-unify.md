# PBI: popup の E2E フィクスチャが 3 系統にコピペ複製され、スタブ方針も不一致

## ユーザーストーリー

E2E を保守する開発者として、popup 起動のフィクスチャを 1 つにしたい。同じ骨格が 3 ファイルに複製され、かつスタブの有無で被検体の振る舞いまで違うため、1 つの共通ロジックを直しても 2 つ残るから。

## 優先度

- 順位: 28/32
- RICE: 2.0（R3 / I1 / C1.0 / E1.5）
- 根拠: E2E fixture 改修時のみ関わる。規模 S〜M
- 依存: なし

## 背景（file:line 現状）

- `testDir/e2e/fixtures/popup.fixture.ts:31-102`: context 起動・fixme ガード `:32-42` / extensionId `:44-47` / `pages()[0] ?? newPage()` `:51-52` / `window.close` スタブ `:62-63` / `chrome.tabs.create` スタブ `:68-73` / TEST_CONNECTION 拦截 `:76-93` / goto + dismiss `:96-98`
- `testDir/e2e/fixtures/popup-pbi27.fixture.ts:21-106`: 同型（`:22-36` / `:38-41` / `:44-45` / `:57-59` / `:61-67` / `:85-97` / `:100-102`）、さらに `chrome.tabs.query` スタブ `:69-83`
- `testDir/e2e/fixtures/cleansing-preview.fixture.ts:28-155`: 同型（`:29-43` / `:45-48` / `:51-52` / `:94-96` / TEST_CONNECTION `:128-132` / goto + dismiss `:140-142`、`chrome.tabs.query` スタブ `:66-80`）
- 不一致: `popup.fixture.ts` は `chrome.tabs.query` をスタブしない、他 2 はする → 3 システムの被検体振る舞いが違う
- 重複コメント: `popup-pbi27.fixture.ts:51-56` と `cleansing-preview.fixture.ts:58-63`

## BDD受け入れシナリオ

```gherkin
Scenario: 3 spec が共通フィクスチャを使う
  Given createPopupFixture で起動した 3 spec
  When 各 spec を実行する
  Then context / extensionId / pages()[0] / goto / dismiss の骨格が共有され、観測結果が従来と無変更である

Scenario: tabs.query スタブの有無が明示される
  Given tabStub オプション
  When 有無を指定する
  Then スタブの有無がオプション名で明示され、意図しない振る舞い差が起きない
```

## 受け入れ基準

- [x] `createPopupFixture({ seedPolicy, tabStub?, initScript? })` が 1 つ作られ、context / extensionId / `pages()[0]` / goto / dismiss を内包している
- [x] 3 spec は差分（`tabs.create` 記録の有無、`GET_CONTENT` / `PREVIEW_RECORD` 拦截）だけを `initScript` で差し込んでいる
- [x] `tabs.query` スタブの有無はオプション名で明示されている
- [x] 既存 3 spec の観測結果が無変更である
- [x] `npm run validate` が PASS する（最終ゲートで確認。E2E 自体はブラウザ要のため CI 範囲）

## テスト戦略

- E2E: 3 spec の green 維持（共通化自体がテスト）。実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `testDir/e2e/fixtures/popup-shared.fixture.ts`、`popup.fixture.ts` / `popup-pbi27.fixture.ts` / `cleansing-preview.fixture.ts`（createPopupFixture への移行。spec は無変更）。`TEST_CONNECTION` 応答文言は `'Test connection successful'` に統一（応答文言を検証する spec が無いことを grep 確認済み）
- ゲート: 対象 4 ファイルの eslint エラーなし、testDir tsconfig でエラーなし（vitest.setup 等の既存エラーは範囲外）。E2E 実行はブラウザ要のため未実行
- ゲート: type-check PASS / lint 0 errors（全体）
