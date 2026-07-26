# PBI: applyI18nがdata-i18n-argsのcountからgetPluralKeyを自動呼び出しするようにする

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（既存の`data-i18n-args`を使ったUI要素の表示テキストが変わる可能性があるため回帰確認が必要）

## 実装メモ（2026-07-26）

`src/utils/i18n-dom.ts` に `resolvePluralKey(key, args)` ヘルパーを新規追加した。`args`に`count`
キーが含まれ、かつ数値変換できる場合のみ `getPluralKey(key, count)`（`i18nPlural.ts`）でキーを
解決し、それ以外は元のキーをそのまま使う。`applyI18n()`内の2箇所（`data-i18n`本文、
`data-i18n-input-placeholder`）に組み込んだ。

`en/messages.json`には`ruleCount_one`/`_other`等の複数形バリエーションが既に存在しており、
追加は不要だった（`ja/messages.json`にも同名キーが存在するが、`getPluralKey`は日本語ロケールでは
`selectPluralSuffix`が`null`を返すため常に元のキーを使い続ける設計であり、この既存キーは実質的に
未使用でも実害はない）。

`entrypoints/popup/index.html`・`entrypoints/options/index.html`の`ruleCount`/`exceptionCount`/
`errorCount`（`data-i18n-args='{"count": "0"}'`）が実際に対象箇所であることを確認した。

`i18n.test.ts`に4件のテストを追加（英語ロケールでの単数/複数キー解決、日本語ロケールでの
サフィックスなし動作、count以外のプレースホルダーのみの既存動作維持）。既存テスト（35件）と
合わせて全てパス。既存の`applyI18n`利用テスト（182件、5ファイル）にも回帰なし。
型チェック・全テストスイート（7371件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の i18n Expert からの指摘。`src/utils/i18nPlural.ts` の `getPluralKey()` 関数が、HTMLテンプレート側の複数形表示（`entrypoints/popup/index.html` の `data-i18n-args='{"count": "0"}'` 等）と連動しておらず、英語で "1 rules" のような不自然な複数形表示になる可能性がある。

**2026-07-26時点の調査で、`src/utils/i18n-dom.ts:57` の `applyI18n()` が `data-i18n-args` は読み取っている（66, 95行）が、`getPluralKey()` を呼び出していないことを確認した。** 現状は単純な文字列置換のみで、count値に応じたメッセージキーの切り替えが行われていない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "getPluralKey\|data-i18n-args" src/utils/i18n-dom.ts src/utils/i18nPlural.ts
grep -n "data-i18n-args" entrypoints/popup/index.html entrypoints/options/index.html | head -10
```

`getPluralKey()` の実装（引数・戻り値の型）を確認し、`applyI18n()` にどう組み込むかを設計する。既存の `_locales/*/messages.json` に複数形バリエーション（例: `ruleCount_one`, `ruleCount_other`）が定義されているか、それとも新規追加が必要かも確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: count=1のとき単数形メッセージが使われる
  Given <span data-i18n="ruleCount" data-i18n-args='{"count": "1"}'> のような要素
  When applyI18n() が実行される
  Then messages.json の単数形バリエーションが適用される（例: "1 rule"）

Scenario: count>1のとき複数形メッセージが使われる
  Given <span data-i18n="ruleCount" data-i18n-args='{"count": "5"}'> のような要素
  When applyI18n() が実行される
  Then messages.json の複数形バリエーションが適用される（例: "5 rules"）

Scenario: countを含まないdata-i18n-argsは従来通り動作する
  Given count以外のプレースホルダーのみを含むdata-i18n-args
  When applyI18n() が実行される
  Then 既存の単純な文字列置換ロジックがそのまま適用される
```

## 受け入れ基準
- [ ] `applyI18n()` 内で `data-i18n-args` に `count` キーが含まれる場合、`getPluralKey()` を呼び出してメッセージキーを解決する処理を追加する
- [ ] `_locales/ja/messages.json`, `_locales/en/messages.json` に必要な複数形バリエーションが不足していれば追加する
- [ ] 既存の `data-i18n-args`（count以外のプレースホルダー）を使う箇所の挙動が変わらないことを確認する
- [ ] 既存のi18n関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `applyI18n()` にcountを含むdata-i18n-args要素を渡し、正しい複数形メッセージが適用されることを確認
- count以外のプレースホルダーのみの要素で既存動作が変わらないことを確認
- 日本語（複数形の概念がない）と英語（単数/複数）両方でのテスト

## 実装アプローチ

1. `getPluralKey()` の現在の実装を確認
2. `applyI18n()` 内で `data-i18n-args` をパースする際、`count` キーが存在すれば `getPluralKey()` 経由でメッセージキーを解決するよう変更
3. `_locales/*/messages.json` の複数形バリエーションを確認・追加
4. テスト追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/i18nPlural.ts`, `_locales/*/messages.json`
- テスタビリティ: 既存のi18nテストが土台
- 非機能要件: i18n品質

## Definition of Done
- [ ] `applyI18n()` が `getPluralKey()` と連動している
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（i18n Expert指摘）
- 対象コード: `src/utils/i18n-dom.ts:57-95`, `src/utils/i18nPlural.ts`
