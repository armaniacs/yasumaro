# PBI: denied_domains / permission_notify_threshold の単一 writer 化（実装）

種別: refactor（依存 investigate 完了済み: `dev-docs/archived/plans/2026-09-27-pbi18-settings-single-writer-policy.md`）

## ユーザーストーリー

設定利用者として、`permission_notify_threshold` を設定画面で変更した後に、その値が SettingsRepository の canonical writer 経由で一貫して保存・再読込されるようにする。`denied_domains` は閲覧履歴として専用 CAS writer を維持し、キー構造は一切変更しない。

## 優先度

- 順位: 後続（PBI 18 完了直後）
- RICEスコア: 1.5（Confidence 90% — 裁定済みのため Effort 2 SP → 1 SP に縮小）
- 見積もり: 1 SP

## BDD受け入れシナリオ

```gherkin
Scenario: 通知設定を変更して保存する
  Given 利用者の現在の通知設定が保存されている
  When 利用者が設定画面で permission_notify_threshold を変更して保存する
  Then SettingsRepository の delta write が 1 回呼ばれる
  And chrome.storage.local への単キー直接 set は 0 回である
  And 設定を再読み込んでも変更後の値が保持される

Scenario: 権限拒否を連続して記録する
  Given 権限拒否を連続して記録する利用状態がある
  When 複数の権限拒否が記録される
  Then denied_domains は専用 CAS（withOptimisticLock on DENIED_DOMAINS）で保存される
  And その経路は withLock('settings') を呼ばない
  And 通知設定の writer と履歴の writer が競合しない

Scenario: 既存契約の維持
  Given export/import と migration parity の既存契約がある
  When 実装を通す
  Then denied_domains は restorableSettings の意図的除外のまま変わらない
  And migration parity テストが green である
  And 既存 storage キー名は一切変更されない
```

## 受け入れ基準

- [x] `trustSettings.ts:565` の raw `chrome.storage.local.set` を `SettingsRepository.set(StorageKeys.PERMISSION_NOTIFY_THRESHOLD, clampedValue)`（delta write 契約）に置換する。クランプ 1-50 は呼び出し側で維持する
- [x] `permissionManager.ts:281` の raw get を `SettingsRepository.get(StorageKeys.PERMISSION_NOTIFY_THRESHOLD)` に置換する。クランプは permissionManager 内に保持する
- [x] `denied_domains` は production 変更なし（`updateDeniedDomains()` 専用 CAS を canonical writer として維持。nested 統合・export 対象化はしない — PBI 18 裁定）
- [x] `trustSettings.ts` 内の `chrome.storage.local.set` 直接呼び出しが 0 件であることを static test で pin する
- [x] denied_domains 経路が `withLock('settings')` を呼ばないことを spy で pin する
- [x] 既存テスト変更: `trustSettings.test.ts:434-437`（raw set pin → repository 呼び出し pin）。`trustSettings-r2` / `trustSettings-r3` の同系 pin
- [x] `permissionManager.test.ts` の top-level pin は denied_domains 分を維持、threshold raw get 分を repository 経由に更新
- [x] migration parity テスト（`settingsRepository-migration-parity.test.ts` / `restorableSettings.test.ts` / `restorableSettings-spec-table.test.ts`）を green 維持する
- [x] 既存 storage キー名を変更せず、ESM `.js`・async/await・型付き get/set + delta write 契約（cached full snapshot を `setAll()` に渡さない）を維持する
- [x] API key の restore 対象契約を変えない

## 技術的考慮事項

- policy の正（SSOT）は調査報告書 `dev-docs/archived/plans/2026-09-27-pbi18-settings-single-writer-policy.md` §2〜§3
- 移行順序: handler 差し替えのみ（storage キー構造・migration 不変）
- ロールバック条件: repository delta write が nested blob の既存値を壊す（再読込で threshold が変わる）場合は raw set へ戻す（revert は 1 ファイル）

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [x] Red/Green 検証: 実装前に期待動作テストを追加して失敗を確認する

## 実績（2026-09-27）

- Red: 新契約テスト（repository set 呼び出し + raw set 不呼び出し）が実装前に失敗を確認
- writer 置換: `trustSettings.ts:565` → `settingsRepository.set`（delta write）、`permissionManager.ts:281` → `settingsRepository.get`（`?? 3` で optional を吸収、クランプ維持）
- 新規 pin: `single-writer contract` describe（static sweep + repository 呼び出し + raw 不呼び出し）/ `withLock('settings')` 非接触 spy（専用キー CAS の実行も確認）
- 既存 pin 更新: `trustSettings.test.ts` の raw set pin → repository 契約 pin（blob 着陸待ちでテスト間漏れを防止）。r2/r3 は挙動 pin なし・green 維持
- ゲート: type-check 0 / lint 0 errors / test 929 files・14,414 passed / migration parity 3 ファイル 17 件 green
