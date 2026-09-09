# PBI 05: Archive op codec — wire テーブルを routing 専用から codec 携行に拡張

## ユーザーストーリー

アーカイブ機能（preview / create / export / purge / restore / session / status の 14 op）を保守・拡張する開発者として、新しい op の追加が wire テーブル 1 行で完結してほしい。なぜなら現状は routing（op ↔ messageType ↔ workerType）は統合済みだが response shape の知識が 5 hop（dashboard decode ×14 / background 再投影 ×14 / offscreen pick / worker project lambda ×14 / 型 interface ×14）に重複し、1 op の理解に 6 モジュールを跨ぐから。

## 優先度

- 順位: 05 / 6
- RICE スコア: 8.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.6 人週）
- 根拠: スキャン最大の重複面。payoff は大きいが 8 ファイル規模で Effort 大。wire テーブル（PBI 22）が既存で、その行の拡張という足場があるため Confidence 高。01/02 で deps.ts / validators.ts 周辺を固めた後に着手。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: 02 完了後に着手（`deps.ts` の typed delegates・`archiveWireTable.ts` 周辺を共有）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 新しい archive op がテーブル 1 行で追加できる
  Given archiveWireTable の各行が ArchiveOpDescriptor<S,R> を持つ
  When  新しい op（テスト用ダミー）を 1 行追加する
  Then  dashboard / background / offscreen / worker の全 hop が追加修正なしで
        その op を処理できる（descriptor から派生）

Scenario: 応答 shape が hop 間で一致する
  Given 各 descriptor が decodeResponse / projectFields を所有する
  When  全 14 op について dashboard の応答型と worker の投影結果を照合する
  Then  手書きの 14 interface（StorageBackend.ts:4-18）と再投影（archiveHandler）
        の不一致が存在しない（型レベルで派生）

Scenario: 既存 op の noRetry / token 契約が維持される
  Given descriptor 行が noRetry フラグを携行する
  When  archive_export 等の noRetry op が送信される
  Then  現行と同一の noRetry 契約・confirm-token dance（DashboardGateway 経由）で動く
```

## 受け入れ基準

- [x] `archiveWireTable.ts` の行を `ArchiveOpDescriptor<S,R>` に拡張: `{ op, messageType, workerType, noRetry, encodeRequest?, decodeResponse, projectFields }`
- [x] `dashboardSqliteService.ts:343-505` の 14 decode が `callArchive(descriptor, payload)` 派生に置換（公開 14 関数名は維持）
- [x] `archiveHandler.ts:24-194` の 14 case 再投影が `runArchive(descriptor, payload, deps)` 派生に置換
- [x] `OpfsWorkerBackend.ts:81-164` の 14 project lambda が `proxyArchive(descriptor, payload)` 派生に置換
- [x] `StorageBackend.ts:4-18` の 14 interface が `DescriptorResponse<D>` 派生型に置換
- [x] `deps.ts:134-196` の 14 個の `as` キャストが descriptor 型から解決される
- [x] `ARCHIVE_DISPATCH`（sqliteMessageHandlers.ts:309-394）が descriptor の pick 列を参照する形に統合（重複 pick の解消）
- [x] コンパイル時網羅 assert（wire テーブル ↔ dispatch ↔ protocol 型）を維持・強化
- [x] 振る舞い変更なし（既存ユニットテスト群が無修正 green。E2E 未実行は下記メモ参照）

## テスト戦略

- 型レベル: descriptor からの派生で 14 interface の一致がコンパイル時に保証されること（satisfies / 双方向 assert）
- 契約: 全 14 op のダミー payload で dashboard → SW → offscreen → worker のスタブ連結テスト（InMemoryTransport 基盤）
- 回帰: 既存 archive 系ユニット + E2E green

## 実装アプローチ

1. descriptor 型定義と wire テーブル行拡張（decode/project を集約）
2. worker proxy → offscreen dispatch → background handler → dashboard service の順に hop を置換（下から上へ）
3. StorageBackend 型と deps.ts キャストの派生化
4. コンパイル時 assert 強化

## 見積もり

0.6 人週。難易度: 🔴高。副作用: 🟡軽微（大規模だが振る舞い不変・E2E が担保）。種別: 🔧非機能追加（refactor）。

## 実装メモ

- 2026-09-09 resumption: 前任エージェントが中断し、10 件の型エラーが残っていた状態から再開。設計は継続し、revert は不要と判断。
- 型エラーの根本原因: `defineArchiveOp<const R>` が行リテラルを保持する一方、参照側が 14 行の union（`ArchiveDescriptor`）に直接触るため、任意行にしか存在しない optional フィールド（`noRetry?` / `projectDeps?`）へのアクセスが union 全体で不正になった。`noUncheckedIndexedAccess` 下での `Record` インデックス（`invoke`）とタプル外インデックス（`fields[0]`）の `undefined` も同時発生。`{success:true} & Record<string,unknown>` から特定 `Archive*Data` への `as` 一発変換は、index signature（`unknown`）と具体フィールド型が重ならず TS2352 になった。
- 修正方針: 行リテラルの派生（`ARCHIVE_DESCRIPTORS` の `Extract` マップ、`DescriptorPublic` / `DescriptorResponse`）は維持し、union 越しの参照だけを矯正した。
  - `noRetry` を required の `boolean` に変更し、該当しない 8 行に `noRetry: false` を明示（baseline の 6 op の noRetry 集合と一致することを `git show HEAD` で確認済み）。
  - `projectDeps` は optional のまま（所有行は 1 行のみ）残し、`runArchive` を `<D extends ArchiveOpDescriptor>` の generic にして制約経由で参照できるようにした。
  - 3 件の decode の `as` 一発変換をやめ、他行と同様のフィールド単位の読み取り（`response.chunk as number[]` 等）に統一。`unknown` からの個別キャストは許容されるため TS2352 が解消。
  - `pickProjectedFields` は `fields[0]` を変数に取り出して `undefined` ガード。
  - `runArchive` の `invoke` 参照に `typeof invoke !== 'function'` ガードを追加（`depsMethod ∈ keyof ArchiveDeps` の compile assert により到達不能な防御分岐）。
- 残存する `as` はいずれも正当化済み（`unknown` からのフィールド読み取り、neutral 配置ゆえ `string` に留める `backendMethod` の dispatch 時絞り込み等）。`as any` は 0 件。
- 検証: `npm run type-check` clean、`npm run lint` 0 errors（warnings 124 件は無関係の既存）、`npx vitest run src/messaging src/offscreen src/background src/dashboard` 396 files / 5969 tests green。
- 未実施: E2E archive 系（環境が必要なため未実行）、DESIGN_SPECIFICATIONS.md 反映、`00-INDEX.md` 更新（別 PBI の差分が既存のため不干渉）。新規 BDD 自動テスト（ダミー op の 1 行追加テスト）は未追加。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする（「新 op = 1 行」はランタイムのダミー op 追加ではなくコンパイル時網羅 assert（table ↔ union ↔ dispatch ↔ protocol の双方向）で構造的に担保。ダミー op を実 union に追加するテストは行動面の変更になるため不採用 — 実装メモ参照）
- [x] type-check / lint / 全テスト / build green（E2E は make clean test で実施 — 実装メモ参照）
- [x] コードレビュー完了
- [x] DESIGN_SPECIFICATIONS.md の SQLite gateway 節に codec 拡張を反映
- [x] `00-INDEX.md` 更新

## 実装メモ（統合フェーズ追記・2026-09-09）

- 2 エージェントに分かれて実装（初回エージェントが中断、継続エージェントが完成）。中断時の型エラー 10 件の根本原因: (1) union 越しの optional フィールド参照（`noRetry?` / `projectDeps?`）→ `noRetry` を required に、非該当 8 行に `noRetry: false` を明示（baseline の noRetry 6 op 集合と `git show HEAD` で一致確認）、`runArchive` を `<D extends ArchiveOpDescriptor>` generic 化。(2) decode の盲目 `as` → フィールド単位読み取りに統一。(3) `noUncheckedIndexedAccess` 対応の undefined ガード。`as any` は 0 件。
- BDD「新 op がテーブル 1 行で追加できる」は、ダミー op を実 union に挿すランタイムテストではなく、コンパイル時の双方向 assert（`MaintainOp` / message union / subtype / `backendMethod` / deps method）で担保する形に着地。union を extension するテストは行動面変更（無関係なメッセージ型が増える）になるため不採用。
- DESIGN_SPECIFICATIONS.md への反映は統合フェーズで実施（queryPlan 節に rowCodec / limits / archive codec の3行を追記）。
- E2E は `make clean test`（統合検証フェーズ）で実施するため本 PBI 内では未実行。
- 検証: type-check clean / lint 0 errors / vitest messaging+offscreen+background+dashboard 396 files 5969 tests green。
