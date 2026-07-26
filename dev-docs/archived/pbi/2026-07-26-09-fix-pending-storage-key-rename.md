# PBI: osh_pending_pagesストレージキーを旧ブランド名から解放する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（ストレージキー名の変更のため、既存ユーザーの保留ページデータを失わないマイグレーションが必須）

## 実装メモ（2026-07-26）

フェーズ0確認で、`osh_`プレフィックスが`pendingStorage.ts`以外に`historyPanel.ts:115`（ストレージ変更
検知のハードコード文字列）にも残っていることを確認した。

`PENDING_PAGES_KEY`を`'osh_pending_pages'`から`'pending_pages'`に変更し、`export`して
`historyPanel.ts`から定数経由で参照する形に修正した（ハードコード文字列を排除）。

`migrateLegacyPendingPagesKey()`を新規実装し、レガシーキーにデータがあれば新キーの既存データと
URL重複を除いてマージしてから新キーに保存、レガシーキーを削除する（レガシーキーが空でも削除は行う）。
`service-worker.ts`の既存`runMigration()`（設定マイグレーション用の起動フック）にこの呼び出しを追加した。

`pendingStorage.test.ts`の既存22箇所の`osh_pending_pages`参照を`pending_pages`に一括置換し、
`migrateLegacyPendingPagesKey`の新規テスト4件（正常移行、重複排除マージ、レガシーキーなしの
no-op、空レガシーキーの削除のみ）を追加。`service-worker.test.ts`は`pendingStorage.js`を
`vi.mock()`で自動モック化しているため新規関数追加による影響はなく、既存150件パス。

全テストスイート（7368件）・型チェックともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Legacy Bridge Architect からの指摘。`src/utils/pendingStorage.ts:15`（現状）の `const PENDING_PAGES_KEY = 'osh_pending_pages';` に、旧プロジェクト名 "Obsidian Smart History" の頭文字 `osh` が残っている。プロジェクトは既に `yasumaro` にリブランドされており、命名規則に一貫性がない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "PENDING_PAGES_KEY\|osh_pending_pages" src/utils/pendingStorage.ts
grep -rn "osh_" src/ | grep -v "__tests__"
```

`osh_` プレフィックスが他のストレージキーにも残っていないか、プロジェクト全体で確認する（本PBIのスコープを `pendingStorage.ts` に限定するか拡大するかを判断するため）。

## 受け入れ基準（BDD）

```gherkin
Scenario: 新しいキー名でデータが保存される
  Given リネーム後のコード
  When 新しく保留ページが追加される
  Then chrome.storage.local に 'pending_pages' キーで保存される

Scenario: 既存の旧キーのデータが移行される
  Given 'osh_pending_pages' キーに既存の保留ページデータがある
  When 拡張機能が起動する
  Then 'pending_pages' キーにデータが移行され、旧キーは削除される

Scenario: 移行後もデータが失われない
  Given 移行前に3件の保留ページが存在する
  When 移行処理が完了する
  Then 移行後も同じ3件のデータが 'pending_pages' キーから取得できる
```

## 受け入れ基準
- [ ] `PENDING_PAGES_KEY` を `'osh_pending_pages'` から `'pending_pages'` に変更する
- [ ] 起動時に旧キー（`'osh_pending_pages'`）のデータが存在すれば新キーに移行するロジックを追加する
- [ ] 移行完了後、旧キーのデータを削除する
- [ ] 既存の `pendingStorage` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 旧キーにデータがある状態から起動した場合、新キーへの移行が正しく行われることを確認
- 旧キーにデータがない場合は移行処理が何もしないことを確認
- 新規保存が新キーに対して行われることを確認

### 統合テスト
- 拡張機能起動シーケンス全体で移行が実行されることを確認

## 実装アプローチ

1. `pendingStorage.ts` に移行関数（`migratePendingPagesKey()`）を追加
2. Service Worker起動時（`service-worker.ts` の `init()`）に移行処理を呼び出す
3. 新規キー名でのテストを追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/service-worker.ts` の起動シーケンスに移行呼び出しを追加
- テスタビリティ: `chrome.storage.local` のモックで新旧キーの移行をテスト可能
- 非機能要件: 保守性、データ整合性（移行時のデータ損失防止）

## Definition of Done
- [ ] ストレージキーがリネームされている
- [ ] 旧キーからの移行ロジックが実装されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Legacy Bridge Architect指摘）
- 対象コード: `src/utils/pendingStorage.ts:15`
