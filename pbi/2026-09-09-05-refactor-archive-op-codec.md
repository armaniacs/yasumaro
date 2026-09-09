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

- [ ] `archiveWireTable.ts` の行を `ArchiveOpDescriptor<S,R>` に拡張: `{ op, messageType, workerType, noRetry, encodeRequest?, decodeResponse, projectFields }`
- [ ] `dashboardSqliteService.ts:343-505` の 14 decode が `callArchive(descriptor, payload)` 派生に置換（公開 14 関数名は維持）
- [ ] `archiveHandler.ts:24-194` の 14 case 再投影が `runArchive(descriptor, payload, deps)` 派生に置換
- [ ] `OpfsWorkerBackend.ts:81-164` の 14 project lambda が `proxyArchive(descriptor, payload)` 派生に置換
- [ ] `StorageBackend.ts:4-18` の 14 interface が `DescriptorResponse<D>` 派生型に置換
- [ ] `deps.ts:134-196` の 14 個の `as` キャストが descriptor 型から解決される
- [ ] `ARCHIVE_DISPATCH`（sqliteMessageHandlers.ts:309-394）が descriptor の pick 列を参照する形に統合（重複 pick の解消）
- [ ] コンパイル時網羅 assert（wire テーブル ↔ dispatch ↔ protocol 型）を維持・強化
- [ ] 振る舞い変更なし（既存 E2E archive 系 35 spec とユニットテスト群が無修正 green）

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

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] type-check / lint / 全テスト / build green（E2E 含む）
- [ ] コードレビュー完了
- [ ] DESIGN_SPECIFICATIONS.md の SQLite gateway 節に codec 拡張を反映
- [ ] `00-INDEX.md` 更新
