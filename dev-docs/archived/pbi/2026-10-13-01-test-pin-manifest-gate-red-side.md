# PBI: manifest 最小権限ゲートの失敗側（Red 側）をスイートで pin する

code-review（2026-10-13、コミット 70d9754b〜49ca0c62 対象）の指摘1 から起票。

## ユーザーストーリー

保守担当者として、manifest 最小権限ゲートの「失敗側」が自動テストで pin されていることがほしい、なぜなら後続リファクタでゲートが静かに弱まった時に、スイートは緑のまま権限保護だけが失効して気づけないから（NN01-03 が閉じた「緑のまま消える」失敗モードのゲート版）。

## 優先度

- 順位: 01 / 全候補数 7（code-review 指摘 7 件中）
- RICEスコア: **18.0**（Reach=3 / Impact=1.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 権限は高リスク領域（AGENTS.md の high-risk areas）。ゲート自体は NN03（2026-10-12）で復旧したが、その失敗側の動作（改変入力 → throw）は手動 Red 確認のみで、スイートには存在しない。`src/__tests__/manifest.test.ts:152` の `assertLeastPrivilegePermissions` は export されているが import しているコードが無く、死にエクスポートになっている。本 PBI でテストから import すれば export に存在理由ができ、ゲートの失敗動作が pin される。候補間で最も価値が高く工数が最小。

## 背景

- `assertLeastPrivilegePermissions` の doc コメントは「Exported so the Red confirmation can run this exact gate against a tampered input」と記すが、Red 確認は 2026-10-12 の実装セッションで手動実施したのみで、コードとして残っていない。
- ゲートが `toEqual` を弱い判定に置き換える等のリファクタで壊れても、実 manifest では通るため緑のまま。失敗側のテストだけが「ゲートは本当に落ちる」を証明できる。

## BDD受け入れシナリオ

Scenario: SSOT 外ドメインの混入でゲートが落ちる
  Given host_permissions に SSOT 合成外のドメイン（例: https://tracker.example/*）を 1 つ足した改変 manifest
  When  assertLeastPrivilegePermissions を呼ぶ
  Then  throw する（エラーメッセージは SSOT 一致の失敗を示す）

Scenario: localhost サービス origin の欠落でゲートが落ちる
  Given buildLocalHostPermissions() の 1 つ（例: http://127.0.0.1:27123/*）を欠いた改変 manifest
  When  assertLeastPrivilegePermissions を呼ぶ
  Then  throw する

Scenario: 宣言された実 manifest では同一ゲートが通る
  Given wxt.config.ts が宣言する実 manifest
  When  assertLeastPrivilegePermissions を呼ぶ
  Then  throw しない（既存の gate テストで維持）

## 受け入れ基準

- [x] 改変入力 2 パターン（SSOT 外 +1 / localhost −1）で throw を期待するテストが `src/__tests__/manifest.test.ts` に追加されている
- [x] `assertLeastPrivilegePermissions` が新規テストから import され、死にエクスポートでなくなる（export の doc コメントを実態に合わせて更新）
- [x] 宣言された実 manifest では同一ゲートが通ることを維持する（既存 gate テストは変更しない）
- [x] `npx vitest run src/__tests__/manifest.test.ts` が green
- [x] `npm run validate` が green

## 検証結果（2026-10-13 実施）

- 実装: Red 側テスト 2 件を 'permission gate over the declared manifest' describe に追加（`.toThrow(/to deeply equal/)` — ゲートの SSOT 等価チェックの実測 AssertionError メッセージ断片を pin し、toEqual を弱い判定に置き換えるリファクタが黙って通るのを防止）+ localhost 欠落テストには前提ガード `expect(host).toContain(...)` 付き（SSOT が origin を生成しなくなった場合に tampering が no-op 化するのを防止）。
- 設計判断（受け入れ基準 2 との差分）: PBI 基準は「新規テストから import され」だったが、**同ファイル内テスト + de-export** を選択。根拠: (1) 実測（grep）で import するコードは repo 内に無い、(2) import 形だと export が残り knip 等の未使用 export 検出で再び指摘される余地が残る、(3) 同ファイル内テストは直接呼びで BDD シナリオと完全一致、(4) doc コメントは module-private・外部消費者無しを実態どおり更新。死にエクスポートの**完全**解消は de-export が正しい。
- Red 確認: ゲートの `toEqual` 2 行を一時コメントアウト → Red 側テスト 2 件が FAILED（expected [Function] to throw an error）、既存 gate テスト（実 manifest の .not.toThrow()）は green のまま＝**既存テストだけではゲートの弱体化を検出できないことの実証**。復元後全テスト green。
- 検証: `npx vitest run src/__tests__/manifest.test.ts` → 17 passed（元 15 + 新規 2）。`--repeats=20` → 17 × 20 = 340 実行全 green（実効性の裏取り: 一時失敗で FAIL 行 20 回出力を確認）。`npm run type-check` → exit 0。
- コードレビュー: マージ時にメインエージェントが全差分をレビュー済み。

## テスト戦略

- 単体: ゲート関数の境界（改変入力 → throw、実 manifest → pass）。E2E/統合は不要（ゲートはビルド不要の純関数）。

## 見積もり

0.25 SP（テスト 2 件追加 + コメント更新のみ）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る（`npm run validate` green）
- [x] 検証結果（コマンドと結果）を PBI に記録する
- [x] コードレビュー完了
