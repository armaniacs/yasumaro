# PBI: masterPassword モジュールレベルDOM状態を崩壊する

## ユーザーストーリー
開発者として、`src/dashboard/masterPassword.ts` のモジュールレベル変数状態（passwordTrapId, passwordModalMode, pendingPasswordAction）をインスタンスプロパティに置き換えたい。なぜなら、テストごとに `vi.resetModules()` + 動的importが必要で、テストファイルの70%がテストインフラに消費されているから。

## ビジネス価値
- テストの保守性が大幅に向上し、新しいテストの追加コストが軽減
- モジュールの状態が明示的になり、bug発見が容易になる
- テスト実行時間が短縮される

## BDD受け入れシナリオ

```gherkin
Scenario: テストでの独立したコントローラー
  Given テスト A でマスターパスワードモーダルを開く
  When 別のテスト B を新しいインスタンスで実行する
  Then テスト B はテスト A の状態を参照しない

Scenario: パスワード認証フロー
  Given ユーザーがマスターパスワードを設定している
  When ダッシュボードで暗号化設定を変更する
  Then パスワード認証モーダルが表示される
  And 認証後に設定が保存される

Scenario: パスワード未設定時の動作
  Given ユーザーがマスターパスワードを設定していない
  When ダッシュボードで暗号化設定を変更する
  Then パスワード設定モーダルが表示される
```

## 受け入れ基準
- [ ] `MasterPasswordController` クラスが新規作成される
- [ ] モジュールレベル変数がインスタンスプロパティに移動される
- [ ] DOM参照がコンストラクタ経由で注入される
- [ ] テストが `vi.resetModules()` 不要になる
- [ ] 既存のテストがすべてパスする
- [ ] テストファイルのサイズが70%削減される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードでパスワード認証フローが正常に動作することを確認

### 統合テスト
- MasterPasswordController のインターフェース検証
- DOM操作の統合テスト

### 単体テスト
- 各メソッドのロジック
- 状態遷移の正確性
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
# モジュールレベル変数を検索
grep -rn "passwordTrapId\|passwordModalMode\|pendingPasswordAction" src/dashboard/masterPassword.ts
grep -rn "vi.resetModules" src/dashboard/masterPassword-r2.test.ts
```

### 実装手順
1. `MasterPasswordController` クラスを新規作成
2. モジュールレベル変数をインスタンスプロパティに移動
3. DOM参照をコンストラクタ経由で注入
4. 既存の関数をクラスメソッドに変換
5. テストを更新して `vi.resetModules()` を削除
6. テストファイルのサイズを削減

### 落とし穴
- DOM要素のIDがハードコードされているため、HTMLの変更に追随する必要がある
- 既存のテストがDOM構造に依存しているため、テストの更新が必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
