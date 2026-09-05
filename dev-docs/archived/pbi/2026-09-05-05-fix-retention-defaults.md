# PBI: レコード保持にデフォルト上限を設定

## ユーザーストーリー
利用者として、レコード保持に保守的なデフォルト上限が設定されていてほしい、なぜなら設定を変更しない限りパージが実行されずOPFS/IndexedDBが無制限に肥大化してディスクを圧迫するから

## 優先度
- 順位: 05 / 26
- RICEスコア: 3,600（Reach=1000 / Impact=2 / Confidence=0.9 / Effort=0.5日）
- 根拠: 全利用者に影響するディスク肥大化リスクを低工数で解消できるため

## BDD受け入れシナリオ
```gherkin
Scenario: 新規利用者にはレコード保持のデフォルト上限が適用される
  Given 初期設定のまま利用を開始した
  When  日次パージが実行される
  Then  デフォルト上限に従って古いレコードが削除される

Scenario: 利用者が上限を変更できる
  Given レコード保持の上限を変更した
  When  日次パージが実行される
  Then  変更後の上限に従ってパージされる

Scenario: 無制限を選択した場合は明示される
  Given 保持を無制限に設定した
  When  オプションページで設定を確認する
  Then  無制限である旨と推奨設定が表示される
```

## 受け入れ基準
- [x] 初期設定でレコード層のパージが実行される（無制限放置にならない）
- [x] 利用者が上限を変更・無制限化できる
- [x] 無制限を選択した場合はその旨と推奨設定がオプションページで明示される
- [x] 既存利用者の設定値が意図せず上書きされない

## テスト戦略
- 単体: デフォルト設定値が保守的な上限を持つこと、日次パージがデフォルト状態で実行されることを検証する

## 実装アプローチ
レコード層の保持設定に保守的なデフォルト上限を設け、無制限選択時はオプションページに注意表示を行う

## 見積もり
0.5日

## 実装者向け注記
- 対象は`src/utils/storage/defaults.ts:156-157`のデフォルト値と`src/background/dailyPurgeHandler.ts:37`のパージ条件のみ
- コンテンツ層（`CONTENT_RETENTION_DAYS`等）の挙動変更は含まない

## 実装メモ
- 2026-09-05 完了: `defaults.ts` の `SQLITE_RETENTION_DAYS` を `null` → `365`（UI 選択肢と一致する最も緩い有限値。`SQLITE_MAX_RECORDS` は null のまま利用者 opt-in）。`settingsForm.ts` に `updateRetentionUnlimitedWarning` / `setupRetentionUnlimitedWarning` を新設し、両境界が無制限のときのみ `#retentionUnlimitedWarning`（既存 `.warning-banner` 流用・i18n キー en/ja 追加）を表示。既存利用者は明示保存値が優先され、未設定者のみデフォルト 365 日が適用される（getAll のデフォルトフォールバック経由）。
- テスト: storage-defaults 2 件新設（365 日デフォルト・UI 選択肢整合）、retention-settings 3 件新設（警告表示/非表示/change 連動）。影響 6 スイート 72 tests green、type-check clean、lint 0 errors。

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了

## 実装メモ（2026-09-05・branch 0905c・続）
- 完了（commit `856fa3ab`、controller-direct）。storage-defaults 2 件・retention-settings 3 件新設、影響 6 スイート 72 tests green。
