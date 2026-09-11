# PBI 2026-09-12-01 — PendingRecordGateway（popup 再記録 seam 新設・dead envelope 実バグ解消）

- **種別**: 🔧非機能追加（fix + refactor・実バグ解消を伴う内部改善）
- **優先度**: 1 位 / RICE **28.8**（R12 × I3 × C80% / E1.0人日）
- **出典**: round 9 診断（`/var/folders/.../architecture-review-20260912-0811-r9.html` 候補 01）・サブエージェント探索 + 直接検証

## 背景（なぜ）

「pending page を再記録する」操作の module が存在せず、3 call site が envelope・timeout・後処理を手書きしている。中でも `privatePageDialog.ts:92-100` は `type: 'record'` という wire に存在しない型を送る（`VALID_MESSAGE_TYPES` は MANUAL_RECORD/SAVE_RECORD のみ・直接検証済み）→ envelopePolicy が破棄し、dialog の全保存経路（save-once / save-domain / save-path / recording-failed-retry）が `undefined` を受け取り「Unknown error」を表示する。兄弟パス `pendingPages.ts` は PBI 2026-09-11-03 で MANUAL_RECORD 化済みだが、このコピーは取り残された。20s timeout は dashboard 側（sqliteHistoryPanel）にしかなく、popup 経路は無期限待ちになり得る。

## スコープ

- `src/popup/pendingRecordGateway.ts` 新設: `recordPendingPage({ title, url, content, force })` が MANUAL_RECORD envelope・timeout・送信後の pending 削除を単一所有する
- `privatePageDialog.ts` の `recordPendingSave`、`pendingPages.ts` の `saveSelectedPages`、`dashboard/panels/asyncData/sqliteHistoryPanel.ts` の `recordPending` を gateway 委譲に置換（dashboard は loadPending refresh のみ残す）
- dead `type:'record'` envelope を削除し、pin テストを MANUAL_RECORD 契約に更新

## 受け入れ基準（BDD）

### シナリオ 1: dialog からの保存が記録される（ハッピーパス）
```gherkin
Given private page dialog で currentPendingSave が設定されている
When ユーザーが dialog-save-once をクリックする
Then chrome.runtime.sendMessage に MANUAL_RECORD envelope（payload に title/url/content/force）が送られる
And 応答 success のとき saveSuccess が表示され auto-close timer が開始する
```

### シナリオ 2: 未知の型は送られない（エラー/境界）
```gherkin
Given 任意の popup 再記録経路
When 再記録を要求する
Then 送信される message type は VALID_MESSAGE_TYPES に含まれる（'record' は送信されない）
And gateway は timeout を強制し、timeout 時は saveError 表示で落ちる
```

## DoD

- [x] gateway 新設・3 call site 委譲
- [x] dead envelope 削除 + 契約テスト更新
- [x] popup / dashboard 関連テスト green
- [x] type-check / lint / build green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（死んでいた経路が正しく復活するのみ）

## 実装メモ（2026-09-12）

- 配置を `src/popup/` から `src/messaging/pendingRecordGateway.ts` に変更（dashboard からも使うため messaging 層が正しい seam 位置。PBI 記載からの逸脱）
- pending 削除は gateway に持たせず各 surface に残した（dialog は pending エントリ無し・pendingPages は一括削除・panel は成功時削除とライフサイクルが異なるため。gateway は envelope + timeout + 結果正規化のみ所有）
- 追加修正: `privatePageDialog.ts` の dialog-save-path ハンドラが await 後に `currentPendingSave.url` を再読する TOCTOU を入口スナップショットで解消（未処理 rejection の実バグ）
- 追加修正: sendMessage reject が dialog で未処理 rejection になる経路を gateway の catch で正規化（テストを新契約に更新）
- 検証: pendingRecordGateway 6 tests + privatePageDialog 29 + pendingPages + sqliteHistoryPanel-pending = 59 tests green・type-check green
