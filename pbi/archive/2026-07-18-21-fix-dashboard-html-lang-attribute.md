# PBI: Dashboard HTML の初期lang属性を空文字から明示的な値に変更

## ユーザーストーリー
スクリーンリーダー利用者として、ダッシュボードページの読み込み初期段階から正しい言語が識別されてほしい、なぜなら現状は `<html lang="">` で初期化されており、JS読み込み前・失敗時に言語未確定となるから

## ビジネス価値
- HTML仕様準拠（`lang` 属性は空文字であるべきではない）
- スクリーンリーダーの言語識別精度向上（アクセシビリティ改善）
- UI Expert・Accessibility Advocate・i18n Expertの3観点が同時指摘した項目であり優先度が高い

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `entrypoints/options/index.html:2` — `<html lang="" dir="ltr">`
- JS実行後は必ず `setHtmlLangAndDir` で上書きされる（既存メモリ: opfs-fts5-coexistence等の記録にはないが、コード確認により該当関数の存在を確認要）
- 対処案: `<html lang="en" dir="ltr">` に変更し、JSで上書き

```bash
# 実装前の再確認コマンド
grep -n "lang=" entrypoints/options/index.html
grep -rn "setHtmlLangAndDir" src/dashboard/ --include="*.ts"
```

## BDD受け入れシナリオ

```gherkin
Scenario: JS読み込み前でも言語が明示されている
  Given ダッシュボードページのHTMLがまだJavaScriptを実行していない状態
  When HTMLソースのhtml要素を確認する
  Then lang属性が空文字ではなく"en"などの有効な言語コードが設定されている

Scenario: JS実行後は従来通りユーザーの言語設定で上書きされる
  Given ダッシュボードページが完全に読み込まれた状態
  When setHtmlLangAndDirが実行される
  Then 初期値"en"がユーザーの実際の言語設定（例: "ja"）で上書きされる
```

## 受け入れ基準
- [ ] `entrypoints/options/index.html:2` を `<html lang="en" dir="ltr">` に変更
- [ ] JS実行後の `setHtmlLangAndDir` によるオーバーライド処理が引き続き正常動作する
- [ ] 日本語環境・英語環境の両方で最終的な表示言語が変わらない（初期値上書きのみの変更のため）

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- Playwright等でダッシュボードを開き、JS実行前後の`lang`属性を確認（既存のi18n関連E2Eテストがあれば拡張）

### 統合テスト
- 不要（HTML静的属性の変更のみ）

### 単体テスト
- 不要

## 実装アプローチ
- HTML1行の変更のため通常のTDDは適用しない。変更後に実機Chrome（日本語/英語環境）で動作確認する

## 見積もり
1pt（15分程度）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 目視確認 + 既存i18nテストの回帰確認
- 非機能要件: アクセシビリティ（WCAG準拠）、i18n

## 落とし穴
- 他のentrypoint（popup, permissions）にも同様のlang属性初期値の問題がないか、ついでに確認する価値はあるが、本PBIのスコープは`entrypoints/options/index.html`のみ（M22は別PBIでpermissionsページを対応）

## Definition of Done
- [ ] `lang="en"` に変更されている
- [ ] 日本語/英語環境での実機Chrome動作確認完了
- [ ] コードレビュー完了
