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

- [x] archive の検証規則（必須性・`cutoffDate`⇄`cutoffMs` のペア整合・`archive_query.query` 長上限）を 1 箇所から導出する形にする（wire table の `validate` を spec から導出）
- [x] エンベロープを通らない経路（`offscreenGateway.ts`）でも同じ検証が効く
- [x] `archivePayloadValidation-parity.test.ts` の「意図的に閉じない差分」を**解消**（受容した残存差分なし。旧 pin は「両経路が一致する」テストへ置換）
- [x] `archiveWireTable.ts` のメッセージを `length must be 1..${MAX_ARCHIVE_EXPORT_CHUNK_BYTES}` に揃え、テストの期待値も同時に更新する
- [x] `MaskedItem.index` の単位差を JSDoc で明示（**型分離は保留**。理由は下記「設計判断」）
- [x] 既存の境界値テスト（8MB / 500 の実値、accept/reject 一致）が green のまま
- [x] `npm run validate` が green

## 設計判断

**採用: `evaluateSubtypeSpec(subtype, payload)` を validators.ts に公開し、wire table の
`validate` を全 archive サブタイプでこれに委譲する。** spec（`DASHBOARD_SQLITE_SUBTYPE_SPECS`）
が唯一の規則の所有者になり、エンベロープ側の validator クラスも同じ行を解釈する。
検証は非 throw（メッセージを返す）なので wire table の `validate: (p) => string | null`
契約をそのまま満たす。`subtype` は payload に注入する（guard とメッセージが読むため）。

これにより 3 つの差分が閉じた: (1) `includeDeleted` / `yasumaroVersion` の必須性、
(2) `cutoffDate`⇄`cutoffMs` のペア整合、(3) `archive_query.query` の長さ上限。
producer（`dashboardSqliteService.ts`）は 3 つとも既に満たしていたため、実運用の
accept 挙動は変わらない（BASE 全サブタイプが両ゲートで accept することをテストで固定）。

**保留: `MaskedItem.index` の型分離（`byteIndex` / `charIndex`）。** 実測の結果、
Rust 側 `masked_items[].index` も occurrence 単位（バイトオフセットではない）で
両実装は一致していた。読み手は 0 件、`index` を値として消費するコードも 0 件のため、
型を 2 つに割ると公開型（`messaging/types.ts`）と 3 つの実装（TS / WASM / Rust）を
同時に動かす必要があり、得られる安全が現状では空振りする。JSDoc で単位を
明示し、オフセットが必要になった時点で別フィールドを足す方針を記録した。

## 検証結果（2026-10-11）

| コマンド | 結果 |
|---|---|
| `npx vitest run src/messaging/__tests__/archivePayloadValidation-parity.test.ts` | 29 passed（一致テスト 3 件を追加、旧 pin 2 件を置換） |
| `npx vitest run src/messaging/__tests__/ src/offscreen/__tests__/` | 126 files 1630 passed |
| `npx vitest run src/wasm/pii-sanitizer/__tests__/parity.test.ts src/wasm/pii-sanitizer/__tests__/extended-patterns-parity.test.ts` | 282 passed |
| `npx eslint src/messaging/...` | 0 errors |
| `npm run type-check` | exit 0 |
| `npm run validate` | exit 0（1055 files / 15933 tests passed） |


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

- [x] archive の検証規則が 1 箇所から導出されている
- [x] エンベロープ経路と wire table 経路の accept/reject が一致することをテストで確認
- [x] 上限超過メッセージが範囲を示す
- [x] `npm run validate` が green
- [x] 受容した残存差分がある場合は理由とトリガーが明記されている
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
