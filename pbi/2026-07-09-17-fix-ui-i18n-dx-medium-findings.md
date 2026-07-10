# PBI: UI/i18n/DX中優先度指摘の解消（M20〜M26）

## ユーザーストーリー
ユーザーとして、ダッシュボードやポップアップのアクセシビリティ・国際化対応が適切であり、開発者としてはCSP設定・リンター・CI/CD検証が整備されていてほしい、なぜならこれらは利用体験の品質と開発の安全性に直結するから

## ビジネス価値
- アクセシビリティ改善によりスクリーンリーダー利用者や多言語ユーザーの利用体験を向上させる
- リンター導入とCSP定数化により、コード品質のばらつきと設定ミスのリスクを下げる
- CI/CDのビルド後検証により、リリース前の不具合を早期発見できるようにする

## 背景（レビュー指摘）
[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) の「Medium UI / i18n / DX」セクション（M20〜M26）を1つのPBIとして束ねる。

| # | 指摘 | 場所 | 対処方針 |
|---|------|------|---------|
| M20 | dashboard HTMLの初期langが固定値"en" | `entrypoints/options/index.html:2` | 初期値を空（`lang=""`）にする |
| M21 | dialog要素の正しい使用方法でないモーダル混在 | `entrypoints/popup/index.html:769-783` | 全モーダルを`<dialog>`ベースに統一 |
| M22 | `confirm` i18nキーの英語メッセージが文脈不一致 | `public/_locales/en/messages.json:879-880` | キー名を`confirmImport`に変更 |
| M23 | READMEの機能説明に未リリースバージョン表記 | `README.md:55-57` | バージョン修飾を削除し機能としてフラットに説明 |
| M24 | CSPが巨大な1行文字列で管理 | `wxt.config.ts:107-109` | 許可ドメイン配列を共通定数化し自動生成 |
| M25 | リンターが未設定（lint → tsc --noEmit） | `package.json:28` | ESLint/Biome導入、最低限`noUnusedLocals: true` |
| M26 | CI/CDリリースパイプラインにビルド後検証がない | `.github/workflows/release.yml:46-78` | バンドルサイズチェックまたはロードテスト追加 |

## BDD受け入れシナリオ

```gherkin
Scenario: ダッシュボードの言語設定がブラウザ設定に追従する（M20）
  Given ユーザーのブラウザ言語が日本語以外に設定されている
  When ダッシュボードを開く
  Then html要素のlang属性が固定の"en"ではなく、ブラウザの言語設定またはUIの実際の表示言語と整合する値になっている

Scenario: ポップアップの全モーダルがdialog要素で実装されている（M21）
  Given ポップアップに複数の確認モーダルが存在する
  When いずれかのモーダルを開く
  Then そのモーダルは`<dialog>`要素として実装されており、ESCキーでの閉じる挙動やフォーカストラップがブラウザネイティブの機構と一貫している

Scenario: インポート確認メッセージのキー名が内容と一致する（M22）
  Given 設定インポート時に確認ダイアログが表示される
  When 英語ロケールでメッセージを確認する
  Then メッセージキーは`confirmImport`であり、文言もインポート操作の確認内容と一致している

Scenario: READMEが現在リリース済みの機能のみを説明する（M23）
  Given READMEの機能説明セクションを読む
  When 各機能の記述を確認する
  Then 未リリースバージョンを示す表記（例: "vX.Yで追加予定"）がなく、既にリリース済みの機能として記述されている

Scenario: CSP許可ドメインが単一の定数リストから生成される（M24）
  Given wxt.config.tsのCSP設定が許可ドメイン配列から自動生成されるようになっている
  When 開発者が新しいAIプロバイダのドメインを1つ追加する
  Then 配列に1エントリ追加するだけでCSP文字列が正しく更新される

Scenario: リンターが未使用変数を検出する（M25）
  Given ESLintまたはBiomeが導入されている
  When 未使用のローカル変数を含むコードをコミットしようとする
  Then lintコマンドの実行時にエラーとして検出される

Scenario: リリースパイプラインがビルド後の異常を検出する（M26）
  Given リリースワークフローが実行される
  When ビルドが完了する
  Then バンドルサイズチェックまたはロードテストが実行され、異常があればワークフローが失敗する
```

## 受け入れ基準
- [ ] M20: `entrypoints/options/index.html:2` のlang属性が固定"en"から変更されている（一部実装: dashboard.tsのsetHtmlLangDir()で動的上書きあるが静的値は未修正）
- [ ] M21: `entrypoints/popup/index.html:769-783` 付近のモーダルが`<dialog>`要素ベースに統一されている（未実装: private-page-dialogのみ対応済み、他は未対応）
- [ ] M22: `public/_locales/en/messages.json` 内の該当キーが`confirmImport`にリネームされ、対応する日本語キーも整合している（未実装）
- [x] M23: README.mdの未リリースバージョン表記が削除されている（2026-07-11実態調査で確認）
- [ ] M24: `wxt.config.ts` のCSP文字列が共通のドメイン定数配列から生成されるようになっている（未実装）
- [ ] M25: ESLintまたはBiomeが導入され、`noUnusedLocals: true`相当のルールが有効化されている。`package.json`の`lint`スクリプトが更新されている（未実装）
- [ ] M26: `.github/workflows/release.yml` にビルド後検証（バンドルサイズチェックまたはロードテスト）が追加されている（未実装）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- モーダル操作（dialog要素化後）がPlaywrightで正しく開閉できることを確認するシナリオテスト（M21）

### 統合テスト
- CSP生成ロジックが定数配列の変更を正しく反映することを確認する統合テスト（M24）
- リンター導入後、意図的に未使用変数を含むサンプルコードでlintが失敗することを確認する（M25、CI上の検証）

### 単体テスト
- lang属性設定ロジックの単体テスト（M20）
- i18nキーリネーム後、既存の参照箇所がすべて更新されていることをgrep等で確認するテスト（M22）
- CSP文字列生成関数の単体テスト（M24）

## 実装アプローチ
- **Outside-In**: UI変更（M20, M21）はブラウザ実行確認を伴うため、まず現状の挙動を確認してから変更する
- **Red-Green-Refactor**: M25（リンター導入）はまず導入し、既存コードの警告を段階的に解消する方針とする（一度に全て直そうとしない）
- **リファクタリング**: M24のCSP定数化はwxt.config.ts変更後、実際のビルド出力を確認して回帰がないことを検証する

## 見積もり
8pt（7項目合算、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: M25（リンター導入）は既存コードベース全体に影響するため、既存コードの警告解消を本PBIのスコープに含めるか、導入のみに留めるかチームで合意が必要
- テスタビリティ: M21のdialog要素移行はフォーカストラップ実装（`src/popup/utils/focusTrap.ts`）との整合を確認する
- 非機能要件: M26のビルド後検証はCI実行時間を増やすため、必要最小限のチェックに留める

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
sed -n '1,10p' entrypoints/options/index.html
sed -n '760,790p' entrypoints/popup/index.html
grep -n "confirm\b" public/_locales/en/messages.json public/_locales/ja/messages.json
sed -n '50,60p' README.md
sed -n '100,115p' wxt.config.ts
grep -n '"lint"' package.json
cat .github/workflows/release.yml | sed -n '40,80p'
```

### 実装手順
1. M20: `entrypoints/options/index.html` の `<html lang="en">` を `<html lang="">` に変更し、JS側で動的に設定する既存パターンがあれば確認する
2. M22: messages.jsonの該当キーをリネームし、`grep -rn "getMessage('confirm')" src/` で参照箇所を洗い出して全て更新する
3. M23: README.mdの該当箇所（55-57行目）からバージョン修飾語句を削除する
4. M24: `wxt.config.ts` にドメイン配列定数を定義し、CSP文字列をテンプレートリテラルまたは`.join()`で生成するよう変更する
5. M25: ESLintまたはBiomeをdevDependenciesに追加し、最小限のルールセット（`noUnusedLocals`相当）で設定、`package.json`の`lint`スクリプトを更新する
6. M26: `.github/workflows/release.yml` にビルド後のバンドルサイズチェックステップを追加する
7. M21（工数が大きい場合は別チケットに分離検討）: 既存モーダルの実装パターンを確認し、`<dialog>`要素+`showModal()`/`close()`への移行を行う。フォーカストラップとの重複機能がないか確認する

### 落とし穴
- M21はdialog要素のネイティブなフォーカストラップ・ESC処理と、既存の`focusTrapManager`が二重に効いてしまう可能性があるため、移行時にどちらか一方に統一すること
- M25はリンター導入だけで既存コードの警告が大量に出る可能性が高い。本PBIでは「導入して最低限のルールを有効化」までとし、全警告解消は別途スコープを切ることを推奨する
- M24のCSP変更はChrome拡張のCSPポリシー違反を引き起こすと拡張機能全体が動作しなくなるため、変更後は必ず実機ロードで動作確認する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] i18nメッセージが日英両言語で整合している
- [ ] ドキュメント更新済み（README.md等）
