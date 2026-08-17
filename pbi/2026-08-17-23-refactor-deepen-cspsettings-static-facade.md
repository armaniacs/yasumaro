# PBI: cspSettings 静的ファサードを深掘りする

## ユーザーストーリー
開発者として、`src/dashboard/cspSettings.ts` の誤解を招く静的クラスファサードをインスタンスコントローラーに変換したい。なぜなら、実装はグローバルDOMクエリを使用する手続き型であり、誤ったOOPパターンを使用しているから。さらに、重複したi18n関数とグローバルalert/confirm呼び出しが保守性を損なっている。

## ビジネス価値
- テスト容易性が向上し、DOM依存が明示的になる
- 重複コードが削減され、保守コストが軽減
- UIの一貫性が向上し、ユーザー体験が改善

## BDD受け入れシナリオ

```gherkin
Scenario: CSP設定の保存
  Given ユーザーがCSP設定を変更する
  When 保存ボタンをクリックする
  Then 設定が正しく保存される
  And 成功メッセージが表示される

Scenario: CSP設定のリセット
  Given ユーザーがCSP設定を変更している
  When リセットボタンをクリックする
  Then 確認ダイアログが表示される
  And 確認後設定がデフォルトに戻る

Scenario: CSP設定の検証
  Given ユーザーが無効なCSPパターンを入力する
  When 保存ボタンをクリックする
  Then エラーメッセージが表示される
  And 設定は保存されない
```

## 受け入れ基準
- [ ] `CspSettingsController` クラスが新規作成される
- [ ] DOM参照がコンストラクタ経由で注入される
- [ ] `escapeRegExp` が `src/utils/string.ts` に移動される
- [ ] 重複した `i18n` 関数が `src/utils/i18n.ts` に統合される
- [ ] グローバル `alert`/`confirm` がステータスヘルパーに置き換えられる
- [ ] 既存のテストがすべてパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードでCSP設定の変更・保存・リセットが正常に動作することを確認

### 統合テスト
- CspSettingsController のインターフェース検証
- DOM操作の統合テスト

### 単体テスト
- 各メソッドのロジック
- 検証ロジックの正確性
- エラーハンドリング

## 実装アプローチ
- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
5pt （要チームでの見積もり）

## 技術的考慮事項
- 依存関係: DOM要素のIDが固定されている
- テスタビリティ: インスタンス化によりテストが容易になる
- 非機能要件: UIの応答性を維持

## 実装者向け注記

### 現状コードの確認
```bash
# 重複した関数を検索
grep -rn "escapeRegExp" src/dashboard/cspSettings.ts
grep -rn "i18n\(" src/dashboard/cspSettings.ts
grep -rn "alert\(\|confirm\(" src/dashboard/cspSettings.ts
```

### 実装手順
1. `CspSettingsController` クラスを新規作成
2. DOM参照をコンストラクタ経由で注入
3. `escapeRegExp` を `src/utils/string.ts` に移動
4. 重複した `i18n` 関数を `src/utils/i18n.ts` に統合
5. グローバル `alert`/`confirm` をステータスヘルパーに置き換え
6. 既存テストを更新

### 落とし穴
- DOM要素のIDがハードコードされているため、HTMLの変更に追随する必要がある
- 既存のテストがDOM構造に依存しているため、テストの更新が必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
