# PBI: Permissionsページの日本語ハードコードをi18n対応化

## ユーザーストーリー
英語版拡張機能ユーザーとして、権限リクエストページ（Permissionsページ）が英語で表示されてほしい、なぜなら現状は `lang="ja"` 固定かつテキストが日本語ハードコードされており、i18nフックが一切適用されていないから

## ビジネス価値
- 英語圏ユーザーが権限リクエストの意図を理解できるようになる
- 他のentrypoint（popup, dashboard）と同一の確立されたi18nパターンへの統一

## 実装者向け注記（フェーズ0の既実装確認結果）

Read・grep で確認済み:
- `entrypoints/permissions/index.html:2` — `<html lang="ja">` 固定
- `entrypoints/permissions/index.html:11` — `読み込み中...` が直接ハードコード
- 他entrypoint（`src/popup/`, `entrypoints/options/`）には `data-i18n` 属性を使った確立されたi18nパターンが既に存在し、それに追従するだけで対応可能（side-effects.md M22判定で確認済み）

```bash
# 実装前の必須調査コマンド（既存i18nパターンの参照実装確認）
grep -n "data-i18n" entrypoints/options/index.html | head -5
cat entrypoints/permissions/index.html
grep -n "permissions" public/_locales/en/messages.json public/_locales/ja/messages.json
```

## BDD受け入れシナリオ

```gherkin
Scenario: 英語環境でPermissionsページが英語表示される
  Given ブラウザの言語設定が英語の環境
  When Permissionsページを開く
  Then "Loading..."のように英語のテキストが表示される
  And html要素のlang属性が動的に"en"に設定される

Scenario: 日本語環境では従来通り日本語表示される
  Given ブラウザの言語設定が日本語の環境
  When Permissionsページを開く
  Then "読み込み中..."のように日本語のテキストが表示される
  And html要素のlang属性が動的に"ja"に設定される
```

## 受け入れ基準
- [ ] `entrypoints/permissions/index.html` の日本語ハードコードテキストに `data-i18n` 属性を付与
- [ ] `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` に対応するメッセージキーを追加
- [ ] `lang` 属性を他entrypointと同様、i18n APIから動的に設定するよう変更（初期値は空文字ではなくデフォルト言語を設定 — M19と同様の注意点）
- [ ] Permissionsページのi18n初期化ロジック（他entrypointの `applyI18n` 相当関数）を追加または既存共通モジュールから流用

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- Playwright等でブラウザ言語設定を英語/日本語に切り替え、Permissionsページの表示テキストを確認

### 統合テスト
- 不要（他entrypointと同一パターンのため、既存のi18n統合テストパターンがあれば流用）

### 単体テスト
- 不要（既存のi18nヘルパー関数を再利用するため新規ロジックはほぼなし）

## 実装アプローチ
- 新規ロジックの実装ではなく、既存の確立されたi18nパターン（`data-i18n` 属性 + `applyI18n()`関数）への追従のため、TDDよりも「既存パターンの模倣→動作確認」の手順で進める

## 見積もり
2pt（半日、メッセージキー追加とi18n初期化ロジック統合含む）

## 技術的考慮事項
- 依存関係: `public/_locales/*/messages.json` への新規キー追加
- テスタビリティ: 既存のi18n適用パターンのE2E確認で十分
- 非機能要件: i18n完全対応

## 落とし穴
- `entrypoints/permissions/` が独自のTSエントリポイントを持たない場合（静的HTMLのみ）、i18n初期化用のスクリプトを新規に追加する必要がある。既存の `src/popup/i18n.ts` や `entrypoints/options/i18n.ts` の構造を確認し、コピーではなく可能であれば共通化を検討する（M20との連携も視野に入れる）

## Definition of Done
- [ ] `data-i18n` 属性が付与され、メッセージキーが翻訳ファイルに追加されている
- [ ] `lang` 属性が動的に設定される
- [ ] 英語/日本語両環境で実機Chrome動作確認完了
- [ ] コードレビュー完了
