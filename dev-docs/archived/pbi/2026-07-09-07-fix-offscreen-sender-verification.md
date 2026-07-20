# PBI: Offscreen メッセージハンドラの送信元検証を強化

## ユーザーストーリー
セキュリティ担当として、Offscreen Document の SQLite メッセージハンドラが信頼できる送信元（Service Worker）からのメッセージのみを処理することを保証したい。なぜなら `SQLITE_UPDATE` 等が送信元検証なしに任意の content 書き換えを許容すると、内部メッセージパスが汚染された際に悪意のあるコンテンツスクリプトから履歴 DB を改ざんできるから。

## ビジネス価値
- 内部メッセージ経路の改ざんに対する防御層を確実にする
- 特に `SQLITE_UPDATE` による content 改ざん・ストレージ枯渇攻撃を防ぐ

## 既実装確認（Phase 0）
- `grep -rn "isSqliteMessage\|SQLITE_" src/offscreen/offscreen.ts` → `isSqliteMessage` + `.startsWith('SQLITE_')` による既存検証を確認。`SQLITE_UPDATE` も含まれる
- **実装状態**: Checking Team Wave 3（2026-07-09）で送信元検証の欠落ではなく「テスト不足」と判定。テスト `offscreen-sqlite.test.ts` を追加済み（未コミット）。本 PBI は回帰仕様として記録

## BDD受け入れシナリオ

```gherkin
Scenario: コンテンツスクリプトからの SQLITE_UPDATE は拒否される
  Given メッセージの sender がタブ（content script）である
  When SQLITE_UPDATE メッセージが送信される
  Then 処理が拒否される（エラー応答）

Scenario: 不正な拡張機能 ID からの SQLITE メッセージは拒否される
  Given メッセージの sender.id が自身の拡張機能 ID ではない
  When SQLITE_SEARCH メッセージが送信される
  Then 処理が拒否される

Scenario: Service Worker からの SQLITE_UPDATE は許可される
  Given メッセージの sender が正しい Service Worker である
  When SQLITE_UPDATE メッセージが送信される
  Then 正常に処理される
```

## 受け入れ基準
- [ ] 送信元が `chrome-extension://<self-id>` ではない `SQLITE_*` メッセージは拒否される
- [ ] Service Worker からの `SQLITE_UPDATE` / `SQLITE_SEARCH` は許可される
- [ ] 回帰テスト `offscreen-sqlite.test.ts` がパスする（4 tests）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/offscreen/__tests__/offscreen-sqlite.test.ts`（既存追加）:
  - SQLITE_UPDATE が content script から reject
  - SQLITE_UPDATE が wrong extension id から reject
  - SQLITE_SEARCH が content script から reject
  - SQLITE_UPDATE が Service Worker（正しい sender）から許可

## 見積もり
1 pt（既実装、回帰テストのみ確認）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `chrome.runtime.MessageSender` をモックして各ケースを検証

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "isSqliteMessage\|startsWith('SQLITE_')" src/offscreen/offscreen.ts
# → 既存検証が SQLITE_UPDATE を含むことを確認
```
追加テスト: `src/offscreen/__tests__/offscreen-sqlite.test.ts`（4 tests）。

### 実装手順
- Wave 3 で適用済み（検証ロジックは既存、テストのみ追加）。未コミットのため完了時に該当差分をコミット対象に含める。

### 落とし穴
- 送信元検証は `sender.id` と `sender.url` の両方を確認するとより堅牢（`chrome-extension://<self-id>`）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載（セキュリティ改善）
