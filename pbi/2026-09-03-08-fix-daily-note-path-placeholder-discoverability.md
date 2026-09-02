# PBI: デイリーノートパスのプレースホルダー記法の発見可能性改善

## ユーザーストーリー
yasumaro拡張のユーザーとして、デイリーノートのパス設定に日付プレースホルダーを使いたい、なぜなら毎月手動でパスを書き換える手間をなくしたいから

## 調査結果（既実装確認）

**この機能はすでに実装済み。** `src/utils/dailyNotePathBuilder.ts` の `buildDailyNotePath()` が `YYYY` / `MM` / `DD` トークンを実行時の日付に置換する処理を持ち、`src/background/obsidianClient.ts` から呼ばれてノート保存時に実際に使われている（[dailyNotePathBuilder.ts:53-69](../src/utils/dailyNotePathBuilder.ts#L53-L69)、[obsidianClient.ts:133](../src/background/obsidianClient.ts#L133)）。

つまりユーザーは現時点でも `raw/YYYY-MM` と設定するだけで、`raw/2026-09` のような月次書き換えは不要になる。

**問題は機能の欠如ではなく、発見可能性（UI上に説明がない）。**
- `entrypoints/options/index.html:233` の入力欄は `data-i18n-input-placeholder="dailyNotePathPlaceholder"` を参照
- `public/_locales/ja/messages.json:92-94` の `dailyNotePathPlaceholder` は `"例: 092.Daily"` という静的パスの例のみで、プレースホルダー記法の存在に一切触れていない
- `public/_locales/en/messages.json` 側の同キーも同様に確認が必要

このためユーザーはプレースホルダー機能の存在に気づけず、毎月手動更新を続けてしまっていた。

よって本PBIは**新規機能追加ではなく、既存機能の説明不足を解消する調査・改善タスク**として書く。

## ビジネス価値
ユーザーが毎月発生させていた「デイリーノートパスの手動更新」という繰り返し作業をゼロにする。実装コストはUI文言修正のみで、リグレッションリスクも低い。

## BDD受け入れシナリオ

```gherkin
Scenario: プレースホルダー記法でパスを一度設定すれば毎月自動的に反映される
  Given ユーザーがOptions画面のデイリーノートパス欄に "raw/YYYY-MM" と入力して保存した
  When 翌月になってからノートが保存される
  Then 保存先パスはその月の年月（例: raw/2026-10）に自動的に解決される
  And ユーザーは設定を変更していない

Scenario: プレースホルダーを含まない静的パスは従来通り動作する
  Given ユーザーがデイリーノートパス欄に "092.Daily" と入力して保存した
  When ノートが保存される
  Then 保存先パスは "092.Daily" のまま変化しない（既存動作の後方互換を維持）
```

## 受け入れ基準
- [x] Options画面のデイリーノートパス入力欄のplaceholder文言に `YYYY` / `MM` / `DD` トークンが使える旨と具体例が明記されている
- [x] 入力欄の近くに簡潔な補足説明（例: 「YYYY/MM/DD は自動的に現在の日付に置換されます」）が表示される
- [x] 日本語・英語の両ロケールで文言が更新されている（`public/_locales/ja/messages.json` と `public/_locales/en/messages.json`）
- [x] 既存の `buildDailyNotePath()` の置換ロジック・テストに変更は不要であることを確認済み（振る舞いを変えない）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（UI文言のみの変更のため、既存のPlaywright E2Eスイートへの追加は不要）

### 統合テスト
- 対象外（`obsidianClient.ts` 側のロジックは変更しないため既存の統合テストで十分）

### 単体テスト
- `dailyNotePathBuilder.ts` の既存テスト（`dailyNotePathBuilder.test.ts` / `dailyNotePathBuilder-security.test.ts`）は変更なしでパスすることを確認する（回帰確認のみ、新規テスト追加は不要）

## 実装アプローチ
本PBIはロジック変更を伴わない文言・UI修正のため、Outside-In / Red-Green-Refactorのテスト駆動サイクルは適用しない。既存テストスイートを実行し、変更が振る舞いに影響しないことのみ確認する。

## 見積もり
1ストーリーポイント

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 文言変更のみのためユニットテスト不要。`npm run validate` で既存テストのグリーンを確認すれば十分
- 非機能要件: i18n整合性（ja/en 両方を更新すること）が唯一の注意点

## 実装者向け注記

### 現状コードの確認
（フェーズ0で実施済み。着手前に再確認する場合）
```bash
grep -rn "dailyNotePath" src/ entrypoints/ public/_locales/
```
`buildDailyNotePath()` の置換ロジックは実装済みで変更不要。触るのはUIの説明文言のみ。

### 実装手順
1. `public/_locales/ja/messages.json` の `dailyNotePathPlaceholder` を、プレースホルダー記法の例を含む文言に更新する（例: `"例: raw/YYYY-MM（年月は自動更新されます）"`）
2. 同ファイルに補足説明用のメッセージキーを追加する場合は、`entrypoints/options/index.html` 側にも対応する `data-i18n` 要素を追加する
3. `public/_locales/en/messages.json` の対応キーも同様に更新する
4. `npm run build` してから `dashboard/dashboard.html`（Options画面）を開き、入力欄のplaceholderと補足文言が正しく表示されることを目視確認する
5. 既存テスト（`npm run validate`）を実行し、`dailyNotePathBuilder` 関連テストが変更なしでパスすることを確認する

### 落とし穴
- `public/_locales/*/messages.json` を直接 `sed` 等で編集すると壊れやすい。Editツールでの文字列置換を使うこと（[JSON File Editing](../CLAUDE.local.md) 参照）
- `dist/` 配下にも同名の `messages.json` があるが、これはビルド生成物なので直接編集しないこと。`public/_locales/` のみを編集し、`npm run build` で反映する
- placeholder文言を長くしすぎるとUI上で見切れる。入力欄下の補足テキスト（別要素）に説明を分離する方が安全

## Definition of Done
- [x] ja/en 両ロケールのplaceholder・補足文言が更新されている
- [ ] Options画面で実際に表示を目視確認済み
- [x] `npm run validate`（type-check + test）がグリーン
- [ ] コードレビュー完了
