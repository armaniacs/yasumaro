# PBI: popup/dashboardのlang属性を実際のUI言語に動的設定する

**作成日**: 2026-07-26
**クローズ日**: 2026-07-26（既に実装済みと判明）
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（HTML属性の動的設定追加、既存表示内容には影響しない）

## クローズメモ（2026-07-26）

フェーズ0確認で `src/utils/i18n-dom.ts:125` に `setHtmlLangAndDir()` 関数が既に実装済みであることを
確認した（`getUserLocale()`から取得したロケールで`document.documentElement.lang`/`dir`を設定）。

呼び出し箇所を確認したところ、`entrypoints/popup/main.ts`（2箇所）と`entrypoints/options/main.ts`
（1箇所）の両方で既に呼ばれており、popup・dashboard双方でPBIの受け入れ基準は満たされていた。
静的HTML側の`lang="en"`（`entrypoints/popup/index.html:2`, `entrypoints/options/index.html:2`）は
JavaScript実行前の初期値として残っているが、これはPBIのシナリオ3
（「i18n適用前の初期表示でも極端な不整合がない」）が許容する設計であり、`main.ts`実行後に
`setHtmlLangAndDir()`で動的に上書きされる。

既存テストも `src/utils/__tests__/i18n.test.ts`（日本語・アラビア語ロケールでのlang/dir設定を検証）
と `src/privacy/__tests__/privacy.test.ts` に存在し、受け入れ基準を満たしている。コード変更・
テスト追加ともに不要と判断し、本PBIをクローズする。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Accessibility Advocate, i18n Expert からの指摘。`entrypoints/popup/index.html:2`, `entrypoints/options/index.html:2` の `<html lang="en" dir="ltr">` が静的に `en` 固定されている。フォールバックテキストは日本語であり、実際のUI言語（日本語/英語）と `lang` 属性が一致しない。スクリーンリーダー等の支援技術が誤った言語で読み上げるリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "<html" entrypoints/popup/index.html entrypoints/options/index.html
grep -n "applyI18n\|getUILanguage" src/popup/utils/i18n.ts src/dashboard/*.ts 2>/dev/null
```

既存の `applyI18n()` 関数（i18n適用処理）がどのタイミングで実行されるか確認し、その中で `document.documentElement.lang` を設定する処理を追加できるか検討する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 日本語UIの場合lang属性がjaになる
  Given ユーザーのブラウザUI言語が日本語である
  When popup/dashboardが読み込まれる
  Then document.documentElement.lang が "ja" に設定される

Scenario: 英語UIの場合lang属性がenのままになる
  Given ユーザーのブラウザUI言語が英語である
  When popup/dashboardが読み込まれる
  Then document.documentElement.lang が "en" のままである

Scenario: i18n適用前の初期表示でも極端な不整合がない
  Given HTMLの初期状態でlang="en"が静的に設定されている
  When JavaScript実行後にapplyI18n()が呼ばれる
  Then lang属性が実際の言語に更新される
```

## 受け入れ基準
- [ ] `applyI18n()`（または同等のi18n初期化処理）内で `document.documentElement.lang = chrome.i18n.getUILanguage()` 相当の設定を追加する
- [ ] popup・dashboard両方で同様の処理が適用される
- [ ] 既存のi18nテストが全てパスする

## テスト戦略

### 単体テスト
- `applyI18n()` 実行後に `document.documentElement.lang` が正しい言語コードに設定されることを確認するテストを追加

### 統合テスト（手動）
- 実ブラウザで日本語・英語それぞれの環境でpopup/dashboardを開き、`lang` 属性を確認

## 実装アプローチ

1. `applyI18n()` の実装箇所を特定
2. 関数冒頭または末尾で `document.documentElement.lang` を動的設定する処理を追加
3. popup・dashboard両方に適用されていることを確認

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: `chrome.i18n.getUILanguage()` API
- 非機能要件: アクセシビリティ（WCAG 2.1 Level AA）、i18n

## Definition of Done
- [ ] popup/dashboard双方でlang属性が動的に設定される
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Accessibility Advocate, i18n Expert指摘）
- 対象コード: `entrypoints/popup/index.html:2`, `entrypoints/options/index.html:2`
