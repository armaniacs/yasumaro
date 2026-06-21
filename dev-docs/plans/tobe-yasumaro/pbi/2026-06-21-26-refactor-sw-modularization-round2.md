# PBI-26: Service Worker モジュール分割（第 2 ラウンド）

## ユーザーストーリー

開発者として、`service-worker.ts` の行数を 1000 行以下に抑えたい。なぜなら、現在 ~1013 行で管理しやすくなく、テストの見通しも悪いため。

## ビジネス価値

- コードの保守性・テスト容易性の向上
- 新機能追加時のリスク低減
- チーム開発時の並行作業効率化

## BDD 受け入れシナリオ

```gherkin
Scenario: DASHBOARD_SQLITE ハンドラが分離されている
  Given service-worker.ts に DASHBOARD_SQLITE 関連のメッセージハンドラが存在する
  When リファクタリングを実施する
  Then ハンドラが `src/background/handlers/dashboardSqliteHandlers.ts` に分離される
  And service-worker.ts が 1000 行以下になる

Scenario: 既存テストがすべてパスする
  Given リファクタリング前の全テストがパスしている
  When モジュール分割を実施する
  Then 全テストがパスし続ける
  And テストカバレッジが低下しない
```

## 受け入れ基準

- [ ] `DASHBOARD_SQLITE` メッセージハンドラを `src/background/handlers/dashboardSqliteHandlers.ts` に抽出
- [ ] `service-worker.ts` が 1000 行以下になる
- [ ] 既存テストがすべてパスする
- [ ] 新規モジュールに.unit テストを追加
- [ ] インポート関係が循環参照にならない

## テスト戦略（t_wada スタイル）

### 単体テスト
- 分離したハンドラの動作確認
- service-worker.ts からのインポート確認

### 統合テスト
- メッセージングフローが壊れないことの確認

## 実装アプローチ

- `service-worker.ts` の `DASHBOARD_SQLITE` ケース分岐をエクスポート関数に抽出
- `src/background/handlers/dashboardSqliteHandlers.ts` に移動
- `service-worker.ts` からはインポートして呼び出し

## 見積もり

**3 ストーリーポイント**

## Definition of Done

- [ ] service-worker.ts が 1000 行以下
- [ ] 全テストパス
- [ ] 循環参照なし
