# PBI: popup/optionsに重複するi18n.tsを共通モジュールへ統合

## ユーザーストーリー
開発チームとして、popup と options（dashboard）に存在するほぼ同一のi18nヘルパーを1つの共通モジュールにまとめたい、なぜなら現状は2箇所に重複しており、片方を修正しても他方に反映されず動作が乖離するリスクがあるから

## ビジネス価値
- i18nロジックの修正・機能追加が1箇所で完結し、動作乖離のリスクを排除
- コードの保守性向上

## 実装者向け注記（フェーズ0の既実装確認結果）

Read・diff で確認済み:
- `src/popup/i18n.ts`（193行）と `entrypoints/options/i18n.ts`（189行）を比較
- **重要**: side-effects.md M20判定「3箇所に実質差分あり」とあるが、実地確認では2ファイル間で以下の実差分を確認:
  1. `getMessage` の型シグネチャ差: popup版は `string | Array<string | number> | Record<string, string | number> | null`、options版は `any`（型安全性に差がある）
  2. 置換処理の差: popup版は `String(substitutions[p1])` で明示的に文字列化、options版は `substitutions[p1]` のまま（暗黙の型変換）
  3. フォールバック挙動の差: popup版のみ「翻訳が空文字の場合は元のHTMLフォールバックテキストを保持する」ガード処理（106-109行目付近）が存在し、options版にはない
- 統合時はこの3点の挙動差を意図的に選択する必要がある（単純な機械的統合はできない）

```bash
# 実装前の必須確認コマンド
diff src/popup/i18n.ts entrypoints/options/i18n.ts
grep -rn "from.*i18n.js\|from.*i18n'" src/popup/*.ts entrypoints/options/*.ts --include="*.ts" | grep -v __tests__
```

## BDD受け入れシナリオ

```gherkin
Scenario: popup側の翻訳表示が統合後も従来通り動作する
  Given popup UIで翻訳キーに対応するメッセージが存在する
  When getMessageやapplyI18nを実行する
  Then 統合前と同じ翻訳結果が表示される（型安全性・フォールバック挙動を含む）

Scenario: options側の翻訳表示が統合後も従来通り動作する
  Given options（dashboard）UIで翻訳キーに対応するメッセージが存在する
  When getMessageやapplyI18nを実行する
  Then 統合前と同じ翻訳結果が表示される

Scenario: 翻訳キーが見つからない場合のフォールバック挙動が両方で一貫する
  Given messages.jsonに存在しない翻訳キーを指定する
  When getMessageを実行する
  Then popup・options両方で、意図的に選択された一貫した挙動（元のHTMLテキスト保持、または空文字）になる
```

## 受け入れ基準
- [ ] 共通のi18nモジュール（例: `src/utils/i18n.ts`）を新設し、両方の良い点を統合する:
  - 型シグネチャはpopup版（厳密な型）を採用
  - 置換処理は`String()`による明示的文字列化を採用
  - フォールバック挙動（空翻訳時の元テキスト保持）はpopup版の挙動を両方に適用
- [ ] `src/popup/i18n.ts` と `entrypoints/options/i18n.ts` を削除し、共通モジュールをimportするよう変更
- [ ] popup・options（dashboard）の両方で既存の翻訳表示が回帰なく動作する

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- popup・dashboard双方で日本語/英語表示を実機Chromeで目視確認

### 統合テスト
- 共通i18nモジュールに対して、popup由来・options由来それぞれの既存テストケースを統合したテストスイートを作成し、両方の挙動が保証されることを確認

### 単体テスト
- `getMessage`（型安全性、置換処理）と `applyI18n`（フォールバック挙動）を個別に検証
- 既存の `src/popup/__tests__/i18n.test.ts`・`entrypoints/options/__tests__/i18n.test.ts`（存在すれば）を統合先のテストへ移行

## 実装アプローチ
- **Outside-In**: まず「フォールバック挙動の統一」を含む受け入れシナリオをRedで書き、共通モジュールへの統合作業でGreenにする
- 既存の2つのテストファイルがあれば、統合後のテストファイルへマージする形でRed-Green-Refactorサイクルを回す

## 見積もり
3pt（半日〜1日。3点の挙動差の統一判断とimport元の全箇所更新を含む）

## 技術的考慮事項
- 依存関係: `src/popup/*.ts` と `entrypoints/options/*.ts` の両方から新しい共通モジュールへのimportパス変更が必要
- テスタビリティ: 既存テストの統合により、リグレッション検出力はむしろ向上する
- 非機能要件: なし

## 落とし穴
- popup版のフォールバック挙動（空翻訳時に元HTMLテキストを保持）をoptions側に適用すると、options側の既存表示が変わる可能性がある。この挙動変化が意図した改善かどうか、実装前にレビューで確認すること
- import元が複数箇所（popup内の複数ファイル、options内の複数ファイル）に分散している可能性が高いため、`grep`で全import箇所を洗い出してから一括更新すること

## Definition of Done
- [x] 共通i18nモジュールが新設され、両方の呼び出し元が移行している
- [x] 旧2ファイルが削除されている
- [x] 統合テストが追加されパスする
- [ ] popup・dashboard両方で実機Chrome動作確認完了（PRレビュー時に実施）
- [x] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
