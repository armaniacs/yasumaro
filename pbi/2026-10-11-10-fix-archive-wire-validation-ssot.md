# PBI: archive wire の検証規則を 1 箇所に寄せ、上限超過メッセージを実態に合わせる

- 種別: fix
- RICE: 0.8（R2 × I1 × C0.8 / E2.0）
- 依存: なし（`src/messaging/validators.ts` / `src/messaging/archiveWireTable.ts` を触る唯一の PBI。他 PBI とファイル非重複で並列可）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）API & Contract Negotiator Medium 1件 + Low 1件

## ユーザーストーリー

保守者として、archive の wire 契約の検証規則が 2 箇所に手書きされている状態を解消したい。なぜなら片側だけを変更しても「固定テストの更新」だけで通ってしまい、エンベロープを通らない経路では検証が効かないまま出荷されるから。あわせて、上限超過時のエラーメッセージが実態と食い違わないようにしたい。

## 背景（現状・証拠）

- エンベロープ側: `src/messaging/validators.ts:336` の `DASHBOARD_SQLITE_SUBTYPE_SPECS`（MessageRouter が本番で先に評価。archive_export / query の行は `:388-410`）。
- ハンドラ側: `src/messaging/archiveWireTable.ts:221-229` / `:380-390`。
- 差分の中身:
  1. `includeDeleted` / `yasumaroVersion` の必須性
  2. `cutoffDate` と `cutoffMs` のペア整合検証
  3. `archive_query.query` の長さ上限
- 差分は本ブランチの新規テスト `src/messaging/__tests__/archivePayloadValidation-parity.test.ts:156-176` に「意図的に閉じない差分」として固定されている。
- エンベロープを通らない経路（`src/background/sqlite/offscreenGateway.ts:115` は archive op を wire table で解決する）ではこれらの検証が効かない。
- 境界値（`length` / `limit`）は本ブランチで SSOT 化されて一致した（`src/utils/limits.ts:31,147` ⇄ `validators.ts:388-410`）。残っているのは検証規則そのものの二重定義。
- 上限超過メッセージの食い違い: `src/messaging/archiveWireTable.ts:226-227` は `length` が 8MB 超でも `archive_export: length must be a positive number` を返す。比較対象の query 側 `:385-386` は `1..500` と範囲を明示している。この誤誘導文言は新規テスト `archivePayloadValidation-parity.test.ts:144-146` で固定されている。
- 参考（同じ契約面の潜在トラップ）: `MaskedItem.index` は WASM 経路では UTF-8 バイト、TS 経路では UTF-16 コード単位（`src/background/pipeline/piiSanitizeHybrid.ts:41-43`, `:114-120`）。現時点で読み手がいないことは確認済みだが、`includeIndices: true` の戻り値の意味が実行経路で変わる。

## BDD 受け入れシナリオ

```gherkin
Scenario: エンベロープ経路と wire table 経路で同じ入力が同じ判定になる
  Given archive_export の payload を用意する
  When エンベロープ検証と wire table 検証をそれぞれ通す
  Then 両者の accept / reject が一致する（既知の受容差分を除く）

Scenario: 検証規則を片側だけ変えるとテストが落ちる
  Given 検証規則が 1 箇所（単一の導出元）にある
  When spec 側の規則だけを変更する
  Then wire table 経路の挙動も同時に変わり、不一致を示すテストが fail する

Scenario: 上限超過メッセージが範囲を示す
  Given archive_export の length が 8MB を超えている
  When wire table の検証を実行する
  Then エラーメッセージが許容範囲（1..MAX_ARCHIVE_EXPORT_CHUNK_BYTES）を示す
```

## 受け入れ基準

- [ ] archive の検証規則（必須性・`cutoffDate`⇄`cutoffMs` のペア整合・`archive_query.query` 長上限）を 1 箇所から導出する形にする（wire table の `validate` を spec から導出、または spec を wire table の拡張として定義）
- [ ] エンベロープを通らない経路（`offscreenGateway.ts`）でも同じ検証が効く
- [ ] `archivePayloadValidation-parity.test.ts:156-176` の「意図的に閉じない差分」を解消する。**やむを得ず受容する差分が残る場合は、その理由を spec 側のコメントに明記し、新しい差分が増えたら fail するテストを追加する**
- [ ] `archiveWireTable.ts:226-227` のメッセージを `length must be 1..${MAX_ARCHIVE_EXPORT_CHUNK_BYTES}` に揃え、テストの期待値も同時に更新する
- [ ] `MaskedItem.index` の単位差（WASM = UTF-8 バイト / TS = UTF-16 コード単位）を JSDoc だけでなく型または名前で区別する（例: `indexUnit` を返す、または `byteIndex` / `charIndex` に分ける）。読み手が 0 件である現状を壊さない範囲で行う
- [ ] 既存の境界値テスト（8MB / 500 の実値、accept/reject 一致）が green のまま
- [ ] `npm run validate` が green

## テスト戦略

- unit: `archivePayloadValidation-parity.test.ts` を「差分を固定する」テストから「一致を検証する」テストへ書き換える
- unit: 必須フィールド欠落・`cutoffDate` 単独 / `cutoffMs` 単独・`query` 長超過の各ケースで、エンベロープ経路と wire table 経路が同じ判定を返すこと
- unit: `archive_export` の length 上限超過メッセージが範囲を示すこと
- 回帰: `archiveWireTable` / `validators` / `sqliteMessages` 系の既存テストが green
- 統合: `offscreenGateway` 経由の archive op で検証が効くこと

## 見積もり

2.0 SP（導出元の一本化 1.0 + メッセージ修正 0.25 + index 単位の型分離 0.5 + テスト 0.25）

## 技術的考慮事項

- **挙動を厳しくする方向の変更**（`includeDeleted` / `yasumaroVersion` の必須化、`query` 長上限の追加）は呼び出し元を壊しうる。`grep` で producer を洗い、全てが新しい規則を満たすことを確認してから締める
- 一本化の方法は「spec を SSOT にし、wire table の validate を spec から生成する」が最も安全（既存の検証関数を再利用する）
- `MaskedItem.index` の型分離は API 変更になりうる。読み手 0 件を確認したうえで、戻り値のフィールド名を変えるより JSDoc + 判別可能なフィールド追加に留めるのが安全
- `DASHBOARD_SQLITE_SUBTYPE_SPECS` は MessageRouter が本番で先に評価するため、spec 側を SSOT にするとデグレが起きにくい

## 実装者向け注記

### 実装手順

1. `archivePayloadValidation-parity.test.ts` の現状の固定差分を読んで、どの規則がずれているかを列挙する
2. エンベロープ経路と wire table 経路の producer（送信元）を `grep` で洗い、厳しくしても壊れないことを確認する
3. spec を SSOT にし、wire table の validate をそこから導出する
4. パリティテストを「一致を検証する」形に書き換える
5. メッセージ修正 + `MaskedItem.index` の型/JSDoc 整備
6. `npm run validate`

### 落とし穴

- 受容差分を消すために検証を緩めるのは本末転倒。厳しい側（spec）に寄せる
- `cutoffDate` / `cutoffMs` のペア整合を追加すると、片方だけ送っている既存コードが落ちる。producer を必ず確認する
- テストで実時間待ちを入れない

## Definition of Done

- [ ] archive の検証規則が 1 箇所から導出されている
- [ ] エンベロープ経路と wire table 経路の accept/reject が一致することをテストで確認
- [ ] 上限超過メッセージが範囲を示す
- [ ] `npm run validate` が green
- [ ] 受容した残存差分がある場合は理由とトリガーが明記されている
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
