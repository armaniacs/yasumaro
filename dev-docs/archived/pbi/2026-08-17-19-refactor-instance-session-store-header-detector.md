# PBI: SessionStore と HeaderDetector をインスタンス化する

## ユーザーストーリー
開発者として、`SessionStore` と `HeaderDetector` が静的初期化パターンを使用している状態を解消したい。なぜなら、SessionStore.registerSuspendHandler は静的メソッドでグローバルハンドラを登録し、HeaderDetector.initialize() はグローバル状態を設定するため、テスト時にグローバル状態が漏洩するから。

## ビジネス価値
- 初期化が composition root で一元管理される
- テスト時に制御されたインスタンスを注入できる
- グローバル状態の漏洩が排除される

## BDD受け入れシナリオ

```gherkin
Scenario: 本番環境での初期化
  Given createBackgroundServices が SessionStore と HeaderDetector を作成する
  When Service Worker が起動する
  Then 作成されたインスタンスが使用される
  And グローバル初期化が行われない

Scenario: テスト環境での独立性
  Given テスト A が SessionStore のインスタンスを作成する
  When テスト B が別の SessionStore インスタンスを作成する
  Then テスト A と B が同じ状態を共有しない

Scenario: 既存動作の維持
  Given SessionStore.registerSuspendHandler が呼び出されている
  When インスタンス化に変更する
  Then 既存の動作がすべて維持される
```

## 受け入れ基準
- [ ] SessionStore がインスタンス化されている
- [ ] HeaderDetector がインスタンス化されている
- [ ] createBackgroundServices が両方のインスタンスを作成している
- [ ] テストが独立したインスタンスを使用している
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- SessionStore と HeaderDetector の統合テストを追加

### 単体テスト
- 独立したインスタンスでの単体テストを追加

## 実装アプローチ
- **Outside-In**: createBackgroundServices でインスタンスを作成し、呼び出し元に注入
- **Red-Green-Refactor**: 修正後に型エラーが発生する場合のみ修正

## 見積もり
2ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: 独立したインスタンスにより改善
- リスク: 中（静的初期化パターンを変更する）

## 実装者向け注記

### 現状コードの確認
```bash
# SessionStore の静的メソッドを確認
grep -n "static\|SessionStore\." src/background/sessionStore.ts | head -15
# HeaderDetector の静的メソッドを確認
grep -n "static\|HeaderDetector\." src/background/headerDetector.ts | head -15
# グローバル初期化の呼び出し箇所を確認
grep -n "SessionStore.registerSuspendHandler\|HeaderDetector.initialize" src/background/service-worker.ts
```

### 実装手順
1. SessionStore の静的メソッドをインスタンスメソッドに変更
2. HeaderDetector の静的メソッドをインスタンスメソッドに変更
3. createBackgroundServices で両方のインスタンスを作成
4. service-worker.ts で作成されたインスタンスを使用
5. テストを独立したインスタンス使用に更新

### 落とし穴
- SessionStore は chrome.storage.session にアクセスする。テスト時はモックが必要
- HeaderDetector は RecordingCache と連携する。依存関係を明確にすること

## Definition of Done
- [ ] SessionStore がインスタンス化されている
- [ ] HeaderDetector がインスタンス化されている
- [ ] グローバル初期化がない
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
