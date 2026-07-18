# PBI: CONSENT_STATE_CHANGED メッセージハンドラへの送信元検証追加

## ユーザーストーリー
拡張機能ユーザーとして、プライバシー同意状態の変更通知が拡張機能自身（popup）以外から偽装されないようにしてほしい、なぜなら他の同種メッセージハンドラ（DASHBOARD_SQLITE）には既に送信元検証があるのに、このハンドラだけ欠けているのは一貫性のないセキュリティ境界だから

## ビジネス価値
- 外部拡張機能や悪意あるcontent scriptからのメッセージ型偽装を防ぐ、防御的実装の一貫性確保
- 影響範囲自体は限定的（`updateConsentBadge()`の再実行のみ）だが、他ハンドラとの実装パターン統一によりレビュー・保守がしやすくなる

## 実装者向け注記（フェーズ0の既実装確認結果）

grepによる全ハンドラ横断調査済み。以下を確認済み:
- `src/background/service-worker.ts` に登録されているメッセージハンドラは16個（267〜405行目）
- `sender.id !== chrome.runtime.id` によるガードが存在するのは `DASHBOARD_SQLITE`（388-396行目）のみ
- `CONSENT_STATE_CHANGED`（登録: service-worker.ts:337-343、ハンドラ実体: `src/background/handlers/messageHandlers.ts:538-547`）にはガードがない
- 送信元は `src/popup/privacyConsentController.ts:156` の一箇所のみ（grep確認済み、content script等からの送信は現状ない）
- **スコープ注記**: 他15個のハンドラ（VALID_VISIT, FETCH_URL, MANUAL_RECORD, SAVE_RECORD等、影響度の高いものを含む）にも同様のガード欠落があるが、本PBIのスコープ外。別PBIとしてバックログ化すること（下記「関連バックログ」参照）

```bash
# 実装前の再確認コマンド
grep -n "registry.register(" src/background/service-worker.ts
grep -n "sender\." src/background/service-worker.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: 正規のpopupからの同意状態変更通知は従来通り処理される
  Given 拡張機能のpopup UIが開かれている
  When ユーザーがプライバシー同意設定を変更し、CONSENT_STATE_CHANGEDメッセージが送信される
  Then sender.id が chrome.runtime.id と一致するため処理が継続される
  And updateConsentBadge() が実行され、拡張機能アイコンのバッジが更新される

Scenario: 拡張機能自身以外からのCONSENT_STATE_CHANGEDメッセージは拒否される
  Given 外部拡張機能または偽装されたsenderを持つメッセージ送信元が存在する
  When CONSENT_STATE_CHANGED メッセージ型を推測して送信する
  Then sender.id が chrome.runtime.id と一致しないため、ハンドラは早期returnで処理を拒否する
  And updateConsentBadge() は実行されない
```

## 受け入れ基準
- [ ] `handleConsentStateChanged`（または登録直前のラッパー）に `sender.id !== chrome.runtime.id` チェックを追加し、不一致時は早期returnする
- [ ] 既存のガードパターン（`DASHBOARD_SQLITE`、service-worker.ts:393周辺）と同じスタイルを踏襲する
- [ ] popup経由の正規フロー（`privacyConsentController.ts:156`）は無変更で動作する
- [ ] 新規ユニットテストが追加され、正規sender/不正senderの両ケースをカバーする

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 追加不要。popup UIからの同意設定変更が既存のE2Eフローでカバーされていれば、そのまま回帰確認として機能する

### 統合テスト
- `src/background/__tests__/service-worker.test.ts`（または該当するメッセージハンドラ統合テストファイル）に、`chrome.runtime.onMessage` 経由で `CONSENT_STATE_CHANGED` を発火させ、正規sender/不正senderでの挙動差を検証するテストを追加

### 単体テスト
- `handleConsentStateChanged`（または新設するガード関数）に対して:
  - `sender.id === chrome.runtime.id` の場合に `updateConsentBadge` が呼ばれることを確認
  - `sender.id !== chrome.runtime.id` の場合に `updateConsentBadge` が呼ばれず、早期returnすることを確認
  - `sender.id === undefined` の境界値ケースも確認

## 実装アプローチ
- **Outside-In**: まず統合テスト（不正senderからのメッセージが拒否されること）をRedで書き、次に単体テストで境界値を詰め、最後に実装
- 実装は `DASHBOARD_SQLITE` の388-396行目パターンをそのまま踏襲し、`CONSENT_STATE_CHANGED` の登録直前（service-worker.ts:337付近）にガード付きラッパーを追加する形が既存コードとの一貫性が高い

## 見積もり
2pt（半日、テスト追加含む）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `chrome.runtime.MessageSender` はテスト内でモックオブジェクトとして容易に生成可能（既存の `DASHBOARD_SQLITE` テストがあれば参考にする）
- 非機能要件: セキュリティ（送信元検証）

## 落とし穴
- `sender.tab` チェック（`DASHBOARD_SQLITE`の389行目パターン）は「content scriptからの呼び出しを弾く」目的。`CONSENT_STATE_CHANGED` はpopupからのみ送信されるため、`sender.id`チェックのみで十分か、`sender.tab`チェックも踏襲すべきかは実装時に既存パターンとの整合性を見て判断すること
- ガードを追加しすぎて正規のpopupフローまで壊さないよう、実装後は必ず実機Chromeでpopupからの同意変更操作を確認する

## 関連バックログ（本PBIのスコープ外）
- 他15個のメッセージハンドラ（VALID_VISIT, FETCH_URL, MANUAL_RECORD, SAVE_RECORD等）にも `sender.id` 検証がない。特に `VALID_VISIT` や `SAVE_RECORD` は実害の大きいハンドラのため、影響度順に優先度をつけた別PBIとして今後検討すること

## Definition of Done
- [ ] `CONSENT_STATE_CHANGED` ハンドラに `sender.id` 検証が追加されている
- [ ] 単体テスト・統合テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] popup経由の正規のプライバシー同意変更フローを実機Chromeで動作確認
- [ ] コードレビュー完了
