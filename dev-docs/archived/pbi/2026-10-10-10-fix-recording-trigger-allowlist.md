# PBI: recordingTriggerManager の生キー × 移行 allowlist 不整合を基準どおりに閉じる

- 種別: fix
- RICE: 3.2（R4 × I1.5 × C0.8 / E1.5）
- 依存: なし
- バッチ: W3

## ユーザーストーリー

設定移行を司る保守担当者として、移行 allowlist が自基準（raw 直読書きオーナーは allowlist に入れる）と一致していてほしい。なぜなら基準から外れたキーが移行対象に含まれると、将来の移行仕様変更で raw 直読モジュールの状態がサイレントに失われる契約不整合が残るから。

## 背景（現状）

- `src/utils/storage/settingsMigration.ts:139-141` — allowlist の自基準: "Each entry is a key whose owning module reads or writes it directly through `chrome.storage.local`, so migrating it into the `settings` blob deletes the only copy the owner can see."
- `src/background/recordingTriggerManager.ts:76,155` — `recording_triggers` / `snapshot_interval_minutes` を `chrome.storage.local.get` で直接読む（blob-side reader なし）
- `src/utils/storage/settingsMigration.ts:143-163` — `TOP_LEVEL_ONLY_KEYS` に 2 キーが未収録 → `isMigratableStorageKey() === true` で移行対象になる
- `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts:239` — `isMigratableStorageKey(StorageKeys.RECORDING_TRIGGERS)` が true を固定する pin
- `src/background/recordingTriggerManager.ts:105,168` — `saveTriggers` / `saveSnapshotInterval` は本番呼び出し地点なしの死蔵 write API（裏取り済み）
- `settingsMigration.ts:99-113` — 完了ガードのコメント自体がこの状態喪失リスク（recordingTriggerManager 含む）を認め、監査を PBI 2026-09-25-18 として記録済み

allowlist の自基準に対する実装の不整合。現時点では本番 writer がないため実害は未発現だが、契約不整合は残る。

## BDD 受け入れシナリオ

```gherkin
Scenario: raw 直読オーナーのキーが移行対象にならない
  Given recordingTriggerManager が recording_triggers を chrome.storage.local から直接読む
  When isMigratableStorageKey(StorageKeys.RECORDING_TRIGGERS) を呼ぶ
  Then false を返す（allowlist 基準どおり）

Scenario: 死蔵 write API が残らない
  Given recordingTriggerManager の saveTriggers / saveSnapshotInterval
  When 本番呼び出し地点を検査する
  Then API は削除済みで、本番コードからの参照は 0 件
```

## 受け入れ基準

- [x] `RECORDING_TRIGGERS` / `SNAPSHOT_INTERVAL_MINUTES` を `TOP_LEVEL_ONLY_KEYS` に追加する（基準どおりの最小修正）
- [x] `saveTriggers` / `saveSnapshotInterval` 死蔵 write API を削除する（本番参照 0 件を rg で確認後）
- [x] pin テスト（settingsMigration-completion-state.test.ts:239）を false に更新する（意図的な分類変更 — 理由をコミットメッセージとテストコメントに記録）
- [x] 移行ステップマシンの既存テストが green（stage 意味論は変更しない）
- [x] `StorageKeys.RECORDING_TRIGGERS` / `SNAPSHOT_INTERVAL_MINUTES` の型定義は残す（listener 経路が参照）

## テスト戦略

- unit: `src/utils/storage/__tests__/settingsMigration*.test.ts` — pin 更新（true → false、意図的変更）
- unit: recordingTriggerManager の既存テスト — 死蔵 API 削除に追従
- 挙動変更の明示: 分類変更は移行対象からの除外のみ（現在の本番 writer なしのため実データの移行挙動は不変）

## 見積もり

1.5 SP

## 技術的考慮事項

- pin テスト更新は「期待値を黙って合わせない」規律の例外ではなく、allowlist 自基準との整合を意図した分類変更（理由をコメントに記録）
- 現時点で recording_triggers / snapshot_interval_minutes を本番が書かないため、実データの移行挙動は不変（許容の上、将来の writer 追加時に lost-copy リスクを構造的に排除）
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `settingsMigration.ts` の TOP_LEVEL_ONLY_KEYS に 2 キー追加
2. pin テスト更新（コメントに意図的理由を記録）
3. `recordingTriggerManager.ts` の死蔵 write API 削除
4. `npx vitest run src/utils/storage src/background` で検証

### 落とし穴

- `storage/types.ts` の Settings 型にある 2 キーは残す（listener 経路が参照、UI から書かれないキーとして将来の監査対象）
- settingsMigration の stage 意味論・完了ガードは変更しない

## Definition of Done

- [x] allowlist 基準と実装が一致（2 キー収録）
- [x] 死蔵 write API 削除（本番参照 0 件）
- [x] pin テスト更新（理由記録付き）
- [x] `npx vitest run src/utils/storage` が green
- [x] ロールバック: 分類は 1 行削除で元に戻せる（データ移行は不変）
