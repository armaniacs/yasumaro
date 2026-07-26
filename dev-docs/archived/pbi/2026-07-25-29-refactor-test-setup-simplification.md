# PBI: vitest.setup.tsのchrome.i18nメッセージモックを_locales/ja/messages.jsonから自動生成する

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（既存テストのi18nメッセージ取得結果が変わらないことを確認する必要がある）

## 実装メモ（2026-07-26）

PBI記載では `_locales/ja/messages.json` ベースを想定していたが、実装中に以下を発見し `_locales/en/messages.json`
ベースに設計変更した:

- `getPluralKey()`（`src/utils/i18nPlural.ts`）は `chrome.i18n.getUILanguage()` が `'en'` の場合のみ
  `_one`/`_other` サフィックス付きキーを使う。既存モックの `getUILanguage` は `'en'` を返す実装になっており、
  複数形キー（`ruleCount_one` 等）は `en/messages.json` にのみ存在し `ja/messages.json` には存在しない
  （日本語は複数形区別がないため）。
- また、実コードの `chrome.i18n.getMessage` 呼び出しには2パターンが混在することを確認した:
  1. `chrome.i18n.getMessage(key, [array])` — Chrome標準の `$1`/`$2` 位置プレースホルダー
  2. `getMessage(key, {count: ...})`（`src/utils/i18n.ts` のラッパー経由）— ラッパー内部で
     `chrome.i18n.getMessage(key)`（引数なし）を呼んでから `{name}` 形式で独自に置換
  このため、モックの `chrome.i18n.getMessage` 自体は `{name}` 置換を行わず、`message` 文字列をそのまま返す
  必要がある（`placeholders` 定義がある場合のみ `$NAME$` を配列引数から位置置換）。

`testDir/vitest.setup.ts` に `buildGetMessageMock()` ヘルパーを追加し、`en/messages.json` を
`with { type: 'json' }` でimportして動的生成する方式に変更。393-656行のハードコードされたメッセージ
オブジェクト（80件超）を削除し、717行→530行に削減した。

回帰確認で12件のテスト失敗を発見したが、いずれも旧モックが「日本語文字列＋英語キー」の中途半端な混在状態
だったことに起因する壊れやすいテスト（モックの中身に依存し、実装のフォールバック文言と食い違っていた）
だったため、実際に返る英語文字列に合わせてテスト側を修正した（`errorMessages.test.ts` 5件、
`cleansingStatsView.test.ts` 5件、`confirmDialog.test.ts` 1件、`popup-xss.test.ts`/`i18n.test.ts` は
`global.chrome` を独自に上書きしており無関係と確認）。

最終的に全7359件パス（18件skip）、型チェックも通過。

---

## 背景

Checking Team レビュー（2026-07-25）の DX Advocate からの指摘。`testDir/vitest.setup.ts`（717行）が chrome.storage/runtime/tabs/notifications/offscreen/permissions/alarms/scripting/contextMenus/action/i18n の広範なモックを1ファイルに手動実装している。特に `chrome.i18n.getMessage`（393-620行付近）は80件超のメッセージキーをハードコードしたオブジェクトになっており、実際の `_locales/ja/messages.json` との二重管理状態になっている。

**注記**: レビューでは `jest.setup.ts` と記載されていたが、2026-07-25時点でプロジェクトはvitestへ移行済みであり、該当ファイルは `testDir/vitest.setup.ts` である（ファイル冒頭のコメントに移行済みの旨が明記されている）。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
head -5 testDir/vitest.setup.ts
grep -n "getMessage" testDir/vitest.setup.ts | wc -l
cat _locales/ja/messages.json | head -20
```

`_locales/ja/messages.json` のキー・値構造と、`vitest.setup.ts` 内のハードコードされたメッセージオブジェクトのキー構造が一致するか確認する。プレースホルダー（`$1` 等）を含むメッセージがある場合、モック側の実装がそれをどう扱っているかも確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: i18nメッセージモックが実際のmessages.jsonから生成される
  Given _locales/ja/messages.json にメッセージキー・値が定義されている
  When テストセットアップが chrome.i18n.getMessage をモックする
  Then messages.json の値がそのままモックの返り値として使われる（二重管理が解消される）

Scenario: messages.jsonに新しいキーが追加されてもテストが自動的に追従する
  Given messages.json に新しいメッセージキーが追加される
  When 既存のテストが chrome.i18n.getMessage(newKey) を呼ぶ
  Then vitest.setup.ts を手動更新しなくても正しい値が返る

Scenario: 既存のテストが全て回帰しない
  Given リファクタリング後の vitest.setup.ts
  When 既存の全テストスイートを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `vitest.setup.ts` の `chrome.i18n.getMessage` モックを、ビルド時またはテスト起動時に `_locales/ja/messages.json` を読み込んで動的に生成する方式に変更する
- [ ] プレースホルダー（`$1`, `$2` 等）を含むメッセージの置換ロジックが既存の挙動と一致することを確認する
- [ ] 既存の全テストスイートが回帰なくパスする
- [ ] ハードコードされたメッセージオブジェクト（393-620行付近）を削除する

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 動的生成されたモックが `_locales/ja/messages.json` の値と一致することを確認するメタテスト
- プレースホルダー置換が既存の挙動と一致することを確認

### 統合テスト
- 既存の全テストスイート（1105件超）を実行し、i18nメッセージ取得に起因する失敗がないことを確認

## 実装アプローチ

1. `_locales/ja/messages.json` を読み込み、`chrome.i18n.getMessage` のモック実装に変換するヘルパー関数を作成
2. `vitest.setup.ts` のハードコードされたオブジェクトをこのヘルパー呼び出しに置き換える
3. 全テストスイートを実行し回帰がないことを確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `_locales/ja/messages.json`
- テスタビリティ: 既存の全テストスイートが回帰確認の土台

## Definition of Done
- [ ] i18nメッセージモックが動的生成に置き換えられている
- [ ] ハードコードされたメッセージオブジェクトが削除されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（DX Advocate指摘、レポート記載の `jest.setup.ts` は `testDir/vitest.setup.ts` の誤り）
- 対象コード: `testDir/vitest.setup.ts:393-620`
