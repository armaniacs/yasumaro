# PBI: vitest.setup.tsのchrome.i18nメッセージモックを_locales/ja/messages.jsonから自動生成する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（既存テストのi18nメッセージ取得結果が変わらないことを確認する必要がある）

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
