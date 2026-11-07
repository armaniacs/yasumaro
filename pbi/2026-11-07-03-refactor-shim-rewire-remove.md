# PBI: shim参照付け替えと参照ゼロshim削除

## 優先度ヘッダ

- 順位: 3 / 9
- RICE: 1.67 (R5 / I1 / C1.0 / E3)
- 依存: なし
- 種別: refactor
- 出所テーマ: PBI 01 と同一テーマの実行フェーズ (付け替え + 削除)

## ユーザーストーリー

保守者として、互換 shim への参照を正規モジュールへ付け替え、参照がゼロになった shim を削除したい。shim 経由の間接参照が残ると、実装の所在が分かりにくく、変更時の影響範囲の把握に時間がかかるからだ。

## 背景

対象は最初の 3 shim で、いずれも `src/utils/sensitiveDataMask.ts` へ委譲する薄い層である。確認済みの内容は次の通りである。

- `src/utils/keySerializer.ts:1-3`: Infrastructure shim である旨の注釈。正規の実装は `src/utils/storage/storageTransaction.ts` にあり、本ファイルは re-export のみである。
- `src/utils/logMasker.ts:15-18`: `maskSensitiveData` が `sensitiveDataMask.ts` の `maskSensitiveData(obj, 'partial')` へ委譲する。`@deprecated` 指定あり。
- `src/utils/redaction.ts:18-41`: `redactSensitiveData`、`SENSITIVE_HEADER_REASONS`、`redactHeaderValue`、`consoleSecureError` が `sensitiveDataMask.ts` へ委譲する。いずれも `@deprecated` 指定あり。
- 現時点の参照者 (Grep 確認済み): `src/utils/obsidianConfigBuilder.ts:13`、`src/utils/pendingStorage.ts:6`、`src/utils/__tests__/logMasker.test.ts:1`、`src/utils/__tests__/redaction.test.ts:5`、`src/utils/__tests__/optimisticLockSerialization.test.ts:10`。このため削除は参照ゼロ確認後とする。
- 後続で同型の手順を適用する広義の shim 群: `src/utils/storage/savedUrlStore.ts`、`src/utils/auditLog.ts`、`src/utils/storage/SettingsRepository.ts:39` (`StorageAdapter` 互換型)、`src/background/ai/providers/ProviderStrategy.ts:189-195` (`ProviderStrategy` 互換型)。本 PBI では手を付けず、対象外として記録する。

## BDD受け入れシナリオ

```gherkin
Scenario: shim経由の参照を正規モジュールへ付け替える
  Given shimファイルが正規モジュールへの委譲のみを行っている
  When 参照者が shim ではなく正規モジュールを直接 import するよう変更する
  Then 公開 API の振る舞いが変更前とバイト単位で同一である
  And 既存テストがすべて成功する

Scenario: 参照ゼロを確認してから shim を削除する
  Given 付け替え後のコードベースで shim への参照を検索する
  When 参照がゼロであることが確認できた場合に限り shim ファイルを削除する
  Then 参照が残っている shim は削除しない
  And 削除後に type-check と関連テストが成功する

Scenario: 広義のshim群には手を付けない
  Given savedUrlStore、auditLog、SettingsRepository、ProviderStrategy の互換層が存在する
  When 本 PBI の作業範囲を判定する
  Then それらのファイルは変更しない
  And 後続 PBI の対象として記録だけ残す
```

## 受け入れ基準

- [ ] 付け替え作業を先に行い、削除作業より前に正規モジュールへの直接参照へ変更している。
- [ ] 付け替え前後で公開 API の振る舞いがバイト単位で同一であり、出力差分がない。
- [ ] shim の削除は Grep 等で参照ゼロを確認できた場合に限り行い、参照が残る shim は削除していない。
- [ ] `src/utils/keySerializer.ts`、`src/utils/logMasker.ts`、`src/utils/redaction.ts` の 3 shim 以外の互換層に手を付けていない。
- [ ] 関連テストスイートと `npm run type-check` が成功している。
- [ ] 新規コードが shim を経由せず正規モジュールを直接参照している。

## テスト戦略

- 関連スイートを `npm test` で実行する。対象は `src/utils/__tests__/sensitiveDataMask.test.ts`、`src/utils/__tests__/logMasker.test.ts`、`src/utils/__tests__/redaction.test.ts`、`src/utils/__tests__/optimisticLockSerialization.test.ts`、および付け替え対象の参照者 (`obsidianConfigBuilder`、`pendingStorage`) を含むスイートである。
- `npm run type-check` を実行し、付け替え後と削除後の両方で型エラーがないことを確認する。
- 付け替え時は Outside-In の考え方で、公開関数の入出力が変わらないことをテストで確認してから削除段階へ進む。

## 見積もり

- 3 SP

## DoD

- [ ] 受け入れ基準をすべて満たしている。
- [ ] テスト戦略の全項目を実行し結果を記録している。
- [ ] 変更範囲が本 PBI の対象 3 shim とその参照者に限定されている。
- [ ] レビュー指摘に対応している。
