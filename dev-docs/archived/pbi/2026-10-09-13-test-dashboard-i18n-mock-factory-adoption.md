# dashboard 側テストの手作り i18n モックコピーを共有ファクトリへ移行（test）

## 1. タイトル + 種別

- **タイトル**: dashboard 側テスト 5 ファイルが `getMessageOr` / `getMessageWithSubstitutions` の意味論を手作りコピーしている状態を、共有ファクトリ `testDir/i18nMock.ts` の `mockGetMessage` へ移行する
- **種別**: test（テスト基盤の重複排除。production コードは変更しない）
- **見積もり**: 1.5 SP

## 2. 優先度

- **優先度**: 順位 13
- **RICE**: R4 / I1 / C1.0 / E1.5 → **2.7**
- **根拠**:
  - pbi-1005-21 で i18n モックの共有ファクトリが導入され popup 側は約 30 ファイルが移行済み（例: `src/popup/__tests__/main.test.ts:89`）。dashboard 側 5 ファイルだけが対象リストから漏れた統一の残骸
  - ファクトリ側の意味論修正（`testDir/i18nMock.ts:8` が文書化する「unknown token は verbatim 生存」等）が dashboard 側テストに波及せず、6 箇所の並行定義として将来のドリフト温床になる。Reach は高めだが Impact は test infra の規範化に留まるため順位は中位
- **依存**: **なし**

## 3. ユーザーストーリー

**dashboard テストの保守担当者として**、i18n モックが共有ファクトリ 1 系統に統一されていてほしい。なぜなら、意味論のコピーが dashboard 側テストに残っていると、ファクトリ側のモック挙動を直しても dashboard テストだけが古い意味論のまま green になり、i18n 契約の pin が二重基準になるから。

## 4. 背景

pbi-1005-21 で `testDir/i18nMock.ts` の共有ファクトリが導入され、popup 側テストは `mockGetMessage` 経由へ移行済み。しかし dashboard 側の 5 ファイルは `getMessageOr` / `getMessageWithSubstitutions` の意味論をファクトリとバイト単位で同型のコピーとして持ち続けている。

該当箇所（全 file:line 検証済み）:

- `testDir/i18nMock.ts:13-37`（共有ファクトリ本体）
- `src/dashboard/__tests__/settingsPipeline.test.ts:70-84`（手作りコピー）
- `src/dashboard/generalSettings/__tests__/connectionTests.test.ts:19-33`
- `src/dashboard/generalSettings/__tests__/settingsForm.coverage.test.ts:17-54`
- `src/dashboard/settings/__tests__/fieldValidation.test.ts:23-36`
- `src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts:6-20`

改善案: 各ファイルの `vi.mock('utils/i18n.js', ...)` 内で、手作りの 2 派生関数を `const { mockGetMessage } = await import('testDir/i18nMock.js'); ... mockGetMessage(vi.fn(...))` に差し替える。各ファイル固有の `getMessage` 実装（テスト対象モジュールの初期化に必要なもの）は保持するため挙動不変。popup 側と同一パターン。

## 5. BDD シナリオ

### シナリオ 1: 5 ファイルが共有ファクトリ経由になる

```gherkin
Given testDir/i18nMock.ts に mockGetMessage が公開されている
When dashboard 側 5 テストファイルの i18n モック定義を確認する
Then 各ファイルが mockGetMessage を import して使用していること
And getMessageOr / getMessageWithSubstitutions の手作りコピーが各ファイル内に残っていないこと
```

### シナリオ 2: ファクトリの意味論修正が 5 ファイルに波及する

```gherkin
Given ファクトリの unknown-token 意味論（verbatim 生存）が変更される
When 5 テストファイルを実行する
Then 5 ファイルすべてがファクトリの新しい意味論に従うこと（コピーが残っていれば旧意味論のままなので検出される）
```

### シナリオ 3: テストの断言は不変である

```gherkin
Given 移行前後で各ファイルの断言内容が同一である
When 5 テストファイルを実行する
Then 全テストが green であること
```

## 6. 受け入れ基準

- [x] 5 ファイルすべてで `getMessageOr` / `getMessageWithSubstitutions` の手作りコピーが削除され、`testDir/i18nMock.js` の `mockGetMessage` が使用されている
- [x] 各ファイル固有の `vi.mock('utils/i18n.js', ...)` のセットアップ（テスト対象モジュールに必要な `getMessage` 実装）は保持され、テストの断言は変更されていない
- [x] 移行後、5 ファイルの全テストが無変更の断言で green である
- [x] `testDir/i18nMock.ts`（ファクトリ本体）は無変更である
- [x] production コード（`src/**`）は一切変更されていない

## 7. テスト戦略

1. **移行対象 5 ファイルの全テスト green**: `settingsPipeline.test.ts` / `connectionTests.test.ts` / `settingsForm.coverage.test.ts` / `fieldValidation.test.ts` / `diagnosticsActions.test.ts` を実行し、断言不変で green を確認する
2. **ファクトリ意味論の一致確認**: 移行前にファクトリの意味論（unknown token の verbatim 生存等）と手作りコピーの意味論が同型であることを確認し、移行でテスト期待値が変わらないことを担保する
3. **安定性**: `npx vitest run <file> --repeats=20`（対象 5 ファイル）で、モック解決順に依存する揺らぎがないことを確認する
4. **validate green**: `npm run validate` で全体通過を確認する

## 8. 見積もり

**1.5 SP** — 5 ファイルの機械的な差し替えが中心だが、各ファイルの `vi.mock` セットアップが固有のため、import 追加と初期化順序の確認工数を含む。production 変更なし。

## 9. DoD

- [x] 受け入れ基準 5 件すべて充足
- [x] 移行対象 5 ファイルが無変更の断言で green
- [x] `npx vitest run <5 files> --repeats=20` が全 run green
- [x] `npm run validate`（type-check + test）が green
- [x] production コードへの変更ゼロ

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 13（R4 / I1 / C1.0 / E1.5 → 2.7）
- 依存: なし
