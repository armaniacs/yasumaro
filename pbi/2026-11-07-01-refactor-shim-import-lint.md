# PBI 2026-11-07-01: shim 経由 import の lint 禁止と正規 import への移行

- Rank: 1/9
- RICE: 6.0 (Reach 6 / Impact 1 / Confidence 1.0 / Effort 1)
- 依存: なし
- Estimate: 1SP
- Status: 未着手

## ユーザーストーリー

開発者として、非推奨 shim 経由ではなく正規モジュールから import したい。shim が import 可能なままだと SSOT 移行が終わらないため、新規コードの shim 利用を lint で禁止し、既存利用を正規 import へ移行したい。

## 背景

互換維持のための再 export 層が残っており、新規コードでも誤って shim 経由で import できる状態である。SSOT への移行を完了させるには、新規利用の抑止と既存利用の付け替えが必要である。現状は以下で確認済みである。

- `src/utils/keySerializer.ts:1-3` - `storage/storageTransaction.ts` への再 export shim。後方互換のためだけに残存し、新規 import 禁止の旨がコメントにある。
- `src/utils/storage/savedUrlStore.ts:3-5` - `@deprecated`。再 export 層であり、正規先は `savedUrlRepository.ts` と `urlEntry.ts`。
- `src/utils/auditLog.ts:2` - `@deprecated` 再 export shim。正規先は `src/messaging/auditLogGateway.ts`。
- `src/utils/logMasker.ts:15-18` - `@deprecated` ラッパー。正規先は `sensitiveDataMask.ts` の `maskSensitiveData('partial')`。
- `src/utils/redaction.ts:18-41` - 複数の `@deprecated` ラッパー。正規先は `sensitiveDataMask.ts` の `maskSensitiveData('full')`、`redactHeaderValue`、`consoleSecureError`、`SENSITIVE_HEADER_REASONS`。
- `src/utils/storage/SettingsRepository.ts:36-41` - `@deprecated` の `StorageAdapter` 型別名と旧 `*Adapter` 名の再 export。正規先は `StoragePort` と `*Port` 実装。
- `src/background/ai/providers/ProviderStrategy.ts:189-195` - `@deprecated` の `ProviderStrategy` 型別名。削除予定日と lint 抑止の記載あり。正規名は `AIProviderStrategy`。
- 抑止の前例あり: `scripts/check-deprecated-aliases.mjs` が `ProviderStrategy` 別名などの新規利用を禁止し、`package.json` の `check-deprecated-aliases` と `validate` から実行される。

## BDD シナリオ

### Scenario 1: 新規コードが shim 経由で import するとゲートで失敗する

- Given 正規モジュールが存在し、shim が非推奨として残っている
- When 開発者が新規ファイルで shim 経由の import を書く
- Then `npm run check-deprecated-aliases` または `npm run lint` が失敗し、正規 import 先が案内される

### Scenario 2: 既存の shim 利用を正規 import に付け替えても振る舞いが変わらない

- Given 既存コードが shim 経由で import している
- When 正規モジュールからの直接 import に置き換える
- Then 公開 API の振る舞いと既存テスト結果が変わらない

### Scenario 3: grandfather 済み除外は縮小方向にだけ更新される

- Given `check-deprecated-aliases` の grandfather リストがある
- When shim 利用の付け替えが進む
- Then 除外リストへの追加は行わず、削減だけが行われる

## 受け入れ条件

1. shim 経由の新規 import が `npm run lint` または `npm run check-deprecated-aliases` で検出され、失敗すること。
2. 対象 shim の正規 import 先がエラーメッセージまたはドキュメントで案内されること。
3. 既存の grandfather 除外に新規ファイルを追加しないこと。付け替え完了分は除外から削除すること。
4. `ProviderStrategy` 別名の既存抑止 (`check-deprecated-aliases`) を壊さないこと。
5. 付け替え後の公開 API の振る舞いが変わらないこと。
6. docs の文字種規約 (Shift-JIS 安全、絵文字なし) に違反しないこと。

## テスト戦略

- 既存ゲートで確認する:
  - `npm run lint` - 新規 lint ルールまたは import 制限の違反検出に使う。
  - `npm run check-deprecated-aliases` (`node scripts/check-deprecated-aliases.mjs`) - 非推奨別名の新規利用がないことを確認する。
- 追加の単体テストは作らず、付け替え後に既存の関連テストが緑であることで回帰なしと判断する。
- 失敗系はゲートの終了コードが非ゼロになることで確認する。

## DoD

- [ ] shim 経由の新規 import が lint または alias check で失敗する
- [ ] 正規 import 先の案内が表示される
- [ ] 既存利用の付け替えが完了し grandfather 除外が削減されている
- [ ] `npm run lint` が緑である
- [ ] `npm run check-deprecated-aliases` が緑である
- [ ] 公開 API の振る舞いに差分がない
