# PBI: Obsidian クライアントの堅牢性と整合性を向上する

## ユーザーストーリー
ユーザーとして、Obsidian Local REST API への接続がポート・プロトコル・IPv6 に関して一貫して動作し、タイムアウトやネットワーク断でもデータが失われたり重複したりしないようにしたい。

## ビジネス価値
- セットアップ時の混乱を減らす
- 書込欠落/重複を防ぐ
- 診断情報を正確に残す

## BDD受け入れシナリオ

```gherkin
Scenario: ポート既定値が一貫している
  Given 新規セットアップ
  When 既定のポートを確認する
  Then 27123（Obsidian Local REST API の実既定値）になる

Scenario: IPv6 ループバックを許可する
  Given ホストに "::1" を入力する
  When _validateHost を実行する
  Then 拒否されない

Scenario: レスポンスボディ読み込みにタイムアウトがある
  Given Obsidian がヘッダのみ返す
  When _fetchExistingContent を実行する
  Then タイムアウトして Mutex が解放される

Scenario: 書込失敗時のログが残る
  Given タイムアウトで書込に失敗する
  When _handleError を実行する
  Then ログに記録される
```

## 受け入れ基準
- [ ] ポート既定値を 27123 に統一
- [ ] `_validateHost` が IPv6 `::1` を許可
- [ ] `_fetchExistingContent` の `response.text()` にタイムアウト
- [ ] タイムアウト時もログを出力
- [ ] vault 名を URL/ヘッダに指定するか、書込後のパスを検証
- [ ] dailyPath の URL メタ文字（`#`, `?`）をエンコード

## テスト戦略（t_wadaスタイル）

### 統合テスト
- Obsidian クライアントのタイムアウト動作
- ポート/プロトコルデフォルトの一貫性

### 単体テスト
- `_validateHost` 各種入力
- `_validatePort` 境界値
- `_handleError` 分岐

## 実装アプローチ
- **Outside-In**: dashboard/popup の設定保存から整合性を取る
- **Red-Green-Refactor**: 各不整合のテストを追加

## 見積もり
2pt

## 技術的考慮事項
- Obsidian Local REST API は vault 名をどう指定するか公式ドキュメントを確認
- タイムアウトは `AbortController` を再利用

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "DEFAULT_PORT\|_validateHost\|_fetchExistingContent\|_handleError" src/background/obsidianClient.ts
```

### 実装手順
1. ポート既定値統一
2. `_validateHost` の IPv6 対応
3. `response.text()` にタイムアウト追加
4. タイムアウトログ追加
5. dailyPath エンコード

### 落とし穴
- vault 名指定は API バージョン依存
- 既定値変更は既存ユーザーの設定に影響しないよう注意

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/background/obsidianClient.ts`, `src/utils/fetch.ts`, `src/utils/urlUtils.ts`, `src/utils/dailyNotePathBuilder.ts`, `src/utils/storage/defaults.ts`
- **関連する過去PBI**:
  - `2026-07-22-01-fix-obsidian-markdown-injection-core`
  - `2026-07-22-02-fix-obsidian-markdown-injection-downstream`
  - `2026-07-25-27-refactor-obsidian-api-abstraction`
- **補足**: `_validateHost` の `[\s\/\\:]` は IPv6 `::1` を誤って拒否する。`fetch.ts` 側では `::1` を localhost として扱っており、定義が矛盾している。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
