# PBI: sqliteHistoryPanel 875行クロージャから抽出する

## ユーザーストーリー
開発者として、`src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` の875行クロージャから純粋なレンダリング関数を抽出したい。なぜなら、HTMLテンプレート構築、イベント配線、ビジネスロジックが混在しており、DOMモックなしにはテストできないから。

## ビジネス価値
- レンダリングロジックがDOM不要でテスト可能になる
- パネルモジュールが薄いオーケストレーターになり保守性が向上
- テスト実行時間が短縮される

## BDD受け入れシナリオ

```gherkin
Scenario: エントリーリストのレンダリング
  Given データベースにブラウジングログが保存されている
  When SQLite履歴パネルを表示する
  Then エントリーリストが正しくレンダリングされる

Scenario: ソートコントロールの動作
  Given ユーザーがソートドロップダウンを操作する
  When ソート順を変更する
  Then リストが新しいソート順で再レンダリングされる
  And 選択が永続化される

Scenario: カレンダーナビゲーション
  Given ユーザーがカレンダーで日付を選択する
  When 日付を変更する
  Then 選択した日付のログが表示される
```

## 受け入れ基準
- [ ] 純粋レンダリング関数が `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts` に抽出される
- [ ] イベント配線がパネルモジュールに残る
- [ ] `chrome.notifications` が通知サービスに移動される
- [ ] レンダリング関数がDOM不要でテスト可能になる
- [ ] 既存のテストがすべてパスする
- [ ] 新しいユニットテストが追加される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- SQLite履歴パネルの表示・操作が正常に動作することを確認

### 統合テスト
- PanelView のインターフェース検証
- PanelController との連携テスト

### 単体テスト
- 各レンダリング関数の出力検証
- ソート・ページネーションロジック
- カレンダーナビゲーション

## 実装アプローチ
- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
8pt （要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 既存のPanelControllerとの連携
- テスタビリティ: 純粋関数としてテスト可能になる
- 非機能要件: UIの応答性を維持

## 実装者向け注記

### 現状コードの確認
```bash
# 875行クロージャを確認
wc -l src/dashboard/panels/asyncData/sqliteHistoryPanel.ts
# chrome.notifications呼び出しを検索
grep -rn "chrome.notifications" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts
```

### 実装手順
1. `sqliteHistoryPanelView.ts` を新規作成
2. 純粋レンダリング関数を抽出
3. イベント配線をパネルモジュールに残す
4. `chrome.notifications` を通知サービスに移動
5. 既存テストを更新
6. 新しいユニットテストを追加

### 落とし穴
- HTMLテンプレートの構造が複雑ため、正確な抽出が必要
- イベント配線がDOMに依存しているため、テストの更新が必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
