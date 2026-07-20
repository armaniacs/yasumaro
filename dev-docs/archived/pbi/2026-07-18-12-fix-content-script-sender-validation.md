# PBI: Content Script GET_CONTENT ハンドラへの sender.id 検証追加

## ユーザーストーリー
拡張機能ユーザーとして、content script が受信する GET_CONTENT メッセージが同一拡張機能内からの正規リクエストであることを保証してほしい、なぜなら現状は sender.id を検証しておらず、他のメッセージハンドラでは検証済みの防御がここだけ欠けているから

## ビジネス価値
- ページコンテンツ抽出結果を返す `GET_CONTENT` ハンドラへの偽装メッセージ送信を防ぐ、防御的実装の一貫性確保
- 影響範囲は限定的だが、抽出済みページ内容（本文テキスト）が想定外の送信元に渡るリスクを塞ぐ

## 実装者向け注記（フェーズ0の既実装確認結果）

grep・Read で該当箇所を実装まで確認済み:
- 対象ハンドラ: `src/content/extractor.ts:893-921`（`chrome.runtime.onMessage.addListener` 内の `GET_CONTENT` 分岐）
- 現状 `sender.id` の検証は一切なし。`message.type === 'GET_CONTENT'` の場合、無条件で `extractPageContent()` の結果を `sendResponse` で返却している
- 送信元はpopup想定（`popup`から `GET_CONTENT` を送信して手動コンテンツ取得を行うフロー）
- 参考となる既存パターン: `src/background/service-worker.ts:388-396`（`DASHBOARD_SQLITE` ハンドラ）の `sender.id !== chrome.runtime.id` チェック
- `src/background/messageTypes.ts:168` に `CONTENT_SCRIPT_ONLY_TYPES` があるが、これはcontent script宛てではなくcontent script発のメッセージ型リストであり、本件のガード対象とは無関係

```bash
# 実装前の再確認コマンド
grep -n "onMessage.addListener" src/content/extractor.ts
sed -n '890,925p' src/content/extractor.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: 拡張機能自身からのGET_CONTENTリクエストは従来通り処理される
  Given content scriptが読み込まれたWebページが開かれている
  When 拡張機能自身（sender.id === chrome.runtime.id）からGET_CONTENTメッセージが送信される
  Then extractPageContent()の結果が正常にsendResponseで返却される

Scenario: 拡張機能自身以外からのGET_CONTENTメッセージは拒否される
  Given content scriptが読み込まれたWebページが開かれている
  When 外部拡張機能または偽装されたsenderからGET_CONTENTメッセージ型を推測して送信される
  Then sender.idの不一致によりハンドラが早期returnし、ページコンテンツは返却されない
```

## 受け入れ基準
- [ ] `GET_CONTENT` ハンドラ先頭に `if (sender.id !== chrome.runtime.id) return;` 相当のガードを追加
- [ ] popup経由の正規フロー（手動コンテンツ取得）が無変更で動作する
- [ ] 新規ユニットテストが追加され、正規sender/不正senderの両ケースをカバーする

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 追加不要。popup UIからの「手動記録」操作が既存のE2Eフローでカバーされていれば、そのまま回帰確認として機能する

### 統合テスト
- `src/content/__tests__/extractor.test.ts`（存在すれば）に、`chrome.runtime.onMessage` 経由で `GET_CONTENT` を発火させ、正規sender/不正senderでの挙動差を検証するテストを追加

### 単体テスト
- ガード追加箇所に対して:
  - `sender.id === chrome.runtime.id` の場合に `extractPageContent()` が呼ばれ `sendResponse` が実行されることを確認
  - `sender.id !== chrome.runtime.id` の場合に `extractPageContent()` が呼ばれず、早期returnすることを確認

## 実装アプローチ
- **Outside-In**: 統合テスト（不正senderからのメッセージが拒否されること）をRedで書き、次に単体テストで境界値を詰め、最後に実装
- `DASHBOARD_SQLITE` ハンドラ（`service-worker.ts:388-396`）と同じガードスタイルを踏襲する

## 見積もり
1pt（1〜2時間、テスト追加含む）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `chrome.runtime.MessageSender` はテスト内でモックオブジェクトとして容易に生成可能
- 非機能要件: セキュリティ（送信元検証）

## 落とし穴
- `extractor.ts` はcontent script側のファイルであり、`typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage` のガード内でリスナー登録されている（テスト環境でのimport時にエラーにならないようにするため）。既存のこのガード構造を壊さないよう、新しいsender検証はリスナー内部（メッセージ受信時）に追加すること
- `GET_CONTENT` 以外の分岐が将来追加される可能性を考慮し、ガードはリスナーのトップ（`msg.type` 判定より前）に置くか、各分岐内に置くかは既存コード構造に合わせて判断する

## Definition of Done
- [ ] `GET_CONTENT` ハンドラに `sender.id` 検証が追加されている
- [ ] 単体テスト・統合テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] popup経由の「手動コンテンツ取得」フローを実機Chromeで動作確認
- [ ] コードレビュー完了
