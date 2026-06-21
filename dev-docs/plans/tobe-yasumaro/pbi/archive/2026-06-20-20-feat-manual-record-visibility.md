# PBI-20: 手動実行ボタンの視認性向上

## ユーザーストーリー

自動記録が不安なユーザーとして、拡張機能アイコンをクリックしたときに「今すぐ要約・保存」ボタンが一目でわかるようにしてほしい。なぜなら、「裏で勝手に動いている」感覚をコントロールしたいから。

## ビジネス価値

- 自動記録に抵抗のあるユーザーでも手動で価値を感じられる
- 手動実行回数を指標として測定できる
- コンテキストメニューからのアクセスで、ページを見ながらの実行が容易になる

## BDD 受け入れシナリオ

```gherkin
Scenario: ポップアップの「今すぐ記録」ボタンが目立つ
  Given ユーザーが拡張機能アイコンをクリックした
  When ポップアップが開く
  Then 「今すぐ記録」ボタンがプライマリーカラーで強調表示されている

Scenario: コンテキストメニューから手動記録する
  Given ユーザーが任意の Web ページを開いている
  When ページ上で右クリックし、「Yasumaro でこのページを記録」を選択する
  Then 手動記録が開始される
  And 完了時にツールバーバッジに青い「◎」が表示される

Scenario: 手動実行中に進捗が表示される
  Given ユーザーが「今すぐ記録」ボタンを押した
  When AI 要約処理が進行中である
  Then ポップアップに「要約中...」の進捗表示がされる
  And 完了後に「保存しました」のメッセージが表示される
```

## 受け入れ基準

- [ ] ポップアップのメイン画面で「今すぐ記録」ボタンを視覚的に強調（プライマリーカラー、サイズ拡大）
- [ ] コンテキストメニュー（右クリック）から「Yasumaro でこのページを記録」を実行可能にする
- [ ] 手動実行時の進捗状態（要約中 / 保存完了）をポップアップ内で表示する
- [ ] 完了時のトースト/バッジ通知を強化する
- [ ] i18n（ja/en）対応

## テスト戦略（t_wada スタイル）

### E2E テスト
- コンテキストメニューからの手動記録フロー

### 統合テスト
- `handleManualRecord` 拡張後の呼び出し
- 進捗状態のポップアップへの反映
- バッジ通知の更新

### 単体テスト
- ボタンのスタイル適用
- コンテキストメニューの登録/削除
- 進捗メッセージの状態遷移

## 実装アプローチ

- **Outside-In**: E2E テストでコンテキストメニュー経由の実行を定義
- 既存の `handleManualRecord` を拡張し、進捗通知を追加
- `chrome.contextMenus` API を使用

## 見積もり

**3 ストーリーポイント**

- UI 強調: 1 SP
- コンテキストメニュー追加: 1 SP
- 進捗表示・通知強化: 1 SP

## 技術的考慮事項

- 依存関係: `handleManualRecord`, `chrome.contextMenus`, バッジ通知ロジック
- テスタビリティ: `chrome.contextMenus` を vitest でモック
- 非機能要件: `contextMenus` 権限の追加と `PERMISSIONS.md` 更新

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "handleManualRecord" src/background/
grep -rn "chrome.contextMenus" src/
grep -rn "setBadge" src/background/
```

`handleManualRecord` は `src/background/service-worker.ts` に既存。コンテキストメニューは未使用。

### 実装手順

1. `wxt.config.ts` の `permissions` に `'contextMenus'` を追加
2. `PERMISSIONS.md` に `contextMenus` の正当化を追加
3. `src/background/service-worker.ts` に `chrome.contextMenus.create` を追加
4. `src/popup/main.ts` で「今すぐ記録」ボタンのスタイルを強調
5. ポップアップに進捗表示用の UI コンポーネントを追加

### 落とし穴

- `contextMenus` 権限は審査時に正当化が必要
- ポップアップが閉じている間の進捗通知は Service Worker 経由で行う必要がある
- 右クリックメニューが他の拡張機能と競合しないよう ID を適切に管理する

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] `contextMenus` 権限が manifest に追加されている
- [ ] `PERMISSIONS.md` が更新されている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
