# PBI: プライバシー同意撤回時に既存の記録データを削除する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🔴あり（ユーザーの既存記録データを削除する破壊的操作。誤動作時のデータ喪失リスクがあるため確認UI必須）

---

## 背景

Checking Team レビュー（2026-07-25）の Compliance & Privacy Guard からの指摘。`src/popup/privacyConsent.ts:181-198` の `withdrawPrivacyConsent()` は `chrome.storage.local` の同意フラグを `hasConsented: false` に更新するのみで、**既存のSQLite記録（要約・URL履歴等）の削除処理を一切呼び出していない**。GDPR Art.7（コメント179行に明記）に言及しているが、データ削除が伴わないため、同意撤回の実効性が不十分。

`src/background/dailyPurgeHandler.ts` にリテンション日数ベースのパージ機能は存在するが、これはアラーム駆動の独立した仕組みであり、同意撤回とは連携していない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "withdrawPrivacyConsent" src/popup/privacyConsent.ts
grep -n "purge\|delete" src/background/dailyPurgeHandler.ts
grep -rn "withdrawPrivacyConsent" src/
```

同意撤回のUIフロー（呼び出し元）を確認し、即時削除か「削除の確認ダイアログを出す」か、UXへの影響を踏まえて設計する。**即座に全データを消す実装は、誤操作によるデータ喪失リスクが高いため、確認ステップを必ず設ける。**

## 受け入れ基準（BDD）

```gherkin
Scenario: 同意撤回時に確認ダイアログが表示される
  Given ユーザーがプライバシー同意撤回ボタンをクリックする
  When withdrawPrivacyConsent フローが開始される
  Then 「記録データも削除されます」という確認ダイアログが表示される

Scenario: 確認後にSQLite記録データが削除される
  Given ユーザーが確認ダイアログで削除に同意する
  When withdrawPrivacyConsent() が実行される
  Then SQLite内の全記録（要約・URL履歴）が削除される
  And 同意状態が hasConsented=false として保存される

Scenario: 確認をキャンセルした場合はデータが保持される
  Given ユーザーが確認ダイアログでキャンセルを選択する
  When 同意撤回フローが中断される
  Then 同意状態・記録データともに変更されない
```

## 受け入れ基準
- [ ] 同意撤回のUIフローに、記録データも削除される旨の確認ダイアログを追加する
- [ ] 確認後、`withdrawPrivacyConsent()` から SQLite の全記録削除処理を呼び出す
- [ ] 削除処理が失敗した場合はエラーを記録し、同意フラグの更新前にユーザーに通知する（同意撤回だけ成功しデータが残る不整合を避ける）
- [ ] キャンセル時は同意状態・データともに変更されないことを確認する

## テスト戦略（t_wadaスタイル）

### E2Eテスト（最小限）
- 同意撤回 → 確認ダイアログ承認 → データ削除完了までのシナリオ（Playwright、既存の `test:e2e` 基盤を利用）

### 統合テスト
- `withdrawPrivacyConsent()` とSQLite削除処理の連携テスト（成功・失敗ケース）

### 単体テスト
- 確認ダイアログのキャンセル時にデータ削除処理が呼ばれないことを確認
- SQLite削除処理が正しい件数のレコードを削除することを確認

## 実装アプローチ

1. 同意撤回UIのトリガー箇所を特定し、確認ダイアログコンポーネントを追加
2. `withdrawPrivacyConsent()` にSQLite削除処理呼び出しを追加（`dailyPurgeHandler.ts` の削除ロジックを再利用可能か検討）
3. 削除失敗時のエラーハンドリングを実装
4. E2Eテストで一連のフローを検証

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/sqliteClient.ts` または `dailyPurgeHandler.ts` の削除ロジック
- テスタビリティ: SQLite操作のモックが必要
- 非機能要件: コンプライアンス（GDPR Art.7実効性）、UX（誤削除防止）

## Definition of Done
- [ ] 確認ダイアログが実装されている
- [ ] 同意撤回時にSQLite記録が削除される
- [ ] キャンセル時はデータが保持される
- [ ] E2Eテストが追加されパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Compliance & Privacy Guard指摘、「同意撤回後のデータ保持」Low項目と統合）
- 対象コード: `src/popup/privacyConsent.ts:181-198`, `src/background/dailyPurgeHandler.ts`
