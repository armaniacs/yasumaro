# PBI: i18n・storage モックのファクトリ統合

## ユーザーストーリー

テストスイートの保守者として、i18n モックが 14 ファイルに同一コピーされ、`vitest.setup.ts` の storage モックが 3 重定義されている状態を解消したい。共通の `mockGetMessage` ファクトリと `createStorageAreaMock()` に統合することで、モック変更時に 14 ファイルを追いかけずに済む構造にしたい。

## 優先度

順位: 15 / 20
RICEスコア: 4.5（Reach=5 / Impact=1 / Confidence=0.9 / Effort=1.0 SP）
根拠: 同一モックの 14 コピーは DRY 違反の典型で、i18n セマンティクス変更時の更新漏れリスクが高い。storage モックの 3 重定義も同様。
依存: なし（logger モックは別 PBI rank 19 の担当 — 本 PBI では触れない）。

## 背景

- i18n モック: `getMessageOr` / `getMessageWithSubstitutions` の手作りコピーが 14 ファイル（例: `tabSeamNullPin.test.ts:35-45`、`statusPanel-extra.test.ts:60-70`）
- storage モック: `vitest.setup.ts` で 3 重定義 — `:183-224`（local）、`:225-264`（session）、`:326-347`（sync）で同じ get/set/remove/clear ボディ
- logger モックのファクトリ化は別 PBI（rank 19）の範囲 — 本 PBI では触れない

## BDD受け入れシナリオ

```gherkin
Scenario: i18n モックが 1 つのファクトリに統合される
  Given getMessageOr / getMessageWithSubstitutions の手作りコピーが 14 ファイルにある
  When mockGetMessage ファクトリを追加する
  Then 14 ファイルはファクトリを経由して i18n モックを取得する
  And ファイルごとのモック挙動は同一に保たれる

Scenario: storage モックが 1 つの createStorageAreaMock に統合される
  Given vitest.setup.ts の storage モックが get/set/remove/clear の同じボディで 3 重定義されている
  When createStorageAreaMock() を追加する
  Then local / session / sync の 3 定義はファクトリに統合される
  And 各エリアの既存挙動は変わらない

Scenario: logger モックには触れない
  Given logger モックのファクトリ化は別 PBI（rank 19）の範囲である
  When 本 PBI を実装する
  Then logger モックには変更を加えない
  And logger モックの既存テストは成功し続ける
```

## 受け入れ基準

- [x] 共通の `mockGetMessage` ファクトリを追加し、14 ファイルの手作り i18n モックを置き換える
- [x] `createStorageAreaMock()` を追加し、`vitest.setup.ts` の 3 重定義を統合する
- [x] ファイルごとのモック挙動を同一に保つ（テスト結果に変化を起こさない）
- [x] logger モックには一切変更を加えない
- [x] 置き換え後、旧手作りモックのコードを削除する
- [x] 全テストが置き換え前と同一の結果で成功する

## テスト戦略

- 置き換え前に既存テストのベースライン結果を記録する
- `mockGetMessage` の単体テスト: メッセージ解決・代替文字列の挙動を検証
- `createStorageAreaMock()` の単体テスト: get/set/remove/clear の挙動を検証
- 14 ファイルを段階的に置き換え、各段階で全テストがベースラインと一致することを確認

## 見積もり

- 1.0 SP（2 ファクトリの追加、14 ファイル置換、parity 確認を含む）

## DoD

- [x] `mockGetMessage` ファクトリが追加され、14 ファイルが置き換え済み
- [x] `createStorageAreaMock()` が追加され、storage モックの 3 重定義が統合済み
- [x] logger モックに変更がないことが確認されている
- [x] 全テストが置き換え前と同一の結果で成功している
- [x] `npm run validate` が成功している

## 実装記録

- ファクトリ 2 件: `testDir/i18nMock.ts`（新設。`mockGetMessage(getMessage)` が `getMessage` / `getMessageOr` / `getMessageWithSubstitutions` の同一挙動を返す。fallback 展開の `{name}` トークン挙動は旧手作りコピーと byte 等価）と `testDir/storageMock.ts`（新設。`createStorageAreaMock(store, { clone, remove, clear, getBytesInUse })`）
- 置換 14 ファイル: dashboard settings 4（contentSettings / customPromptManager-r3 / privacySettings / trustSettings-r3）+ popup 9（pendingPages-errorBoundary / privacyConsentController / privacyConsentController-r2 / privatePageDialog-recordRejection / recordOrchestrator / statusPanel / statusPanel-wireOnce-parity / tabSeamNullPin / trancoNotification）+ statusPanel-extra 1 — すべて `vi.mock('../../utils/i18n.js')` をファクトリ経由へ。旧手作りコピーのコードは削除済み（`getMessageWithSubstitutions: (` の手作り残存は `dashboardLegacyPanelFactories.test.ts` の 1 ファイルのみだが、これは `getMessageWithSubstitutions` が subs を無視する別変種 + getUserLocale/isRTL 拡張を持ち、ファクトリ置換では挙動が変わるため対象外 — 後続候補として記録）
- vitest.setup.ts: local / session / sync の 3 重 storage モック定義を `createStorageAreaMock` 1 本に統合（net -195 行）
- 単体テスト: `testDir/__tests__/i18nMock.test.ts` + `testDir/__tests__/storageMock.test.ts`（新設。モック挙動の契約 pin）
- ベースライン: 置換前後でテスト結果は同一（324 + 234 のスイープ、`npm test` 全体も同一結果 15583 passed・21 skipped）
- 統合時の追補: PBI 25 が作成した `trustPanel.test.ts`（未トラッキング）に旧手作り i18n モックのコピーが残っていたため、同一の `mockGetMessage` ファクトリ置換を本 PBI のコミットで適用（1 編集、focused vitest 15 tests green）。同ファイルは本 PBI のコミットに同梱。また `statusPanel-extra.test.ts` の本 PBI 分の置換は、PBI 25 の mainStatus ソース pin 更新と同一ファイルのため PBI 25 のコミットに同梱（ファイル単位の帰属 — 挙動は不変）。`storageMock.test.ts` の未使用 `vi` import は lint ゲートで検出し削除（統合時）
- ゲート: `npx tsc --noEmit` 0 エラー / `npm run lint` 0 エラー（119 warning は既存） / `npm test` 15583 passed・21 skipped / `npm run validate` PASS
