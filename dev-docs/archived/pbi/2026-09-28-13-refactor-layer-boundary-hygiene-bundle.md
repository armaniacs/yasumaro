# PBI: レイヤー境界の衛生改善 4 件バンドル

## ユーザーストーリー

保守者として、境界違反の小型 4 件を 1 バンドルで解消したい。なぜならどれも S 規模で相互にファイル非重複だが、放置すると layer 規約の実効性が下がるからだ。

## ビジネス価値

- 4 つの独立した境界違反をまとめて解消し、LAYERS に書かれた規約が実際のコード形態と一致する状態に戻す。
- (a) の composition root 迂回を解消して「両経路が同一インスタンスを観測する」singleton 契約が dashboard 経路でも維持されるようにする。
- (b) の純 core 分離により、dashboard から offscreen への無検査な runtime edge を 1 本減らす。
- (c) の配置解消により、utils から background への逆辺を 1 本減らし、lint 対象外のまま残る構造を future proof にする。
- (d) の偽 union 解消により、型が実態と一致し、後続のリファクタで「型が嘘である」箇所が増えないようにする。

## 優先度

- 種別: refactor
- 順位: 13 / 17
- RICEスコア: 4.5（Reach=3 / Impact=1.5 / Confidence=100% / Effort=1 SP）

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: dashboard からの runtime クラス直接構築が composition root を迂回しない
  Given dashboard から background の runtime クラスを直接 new する経路が検出された
  And 同一インスタンスを観測するための正規の singleton 経路が存在する
  When 接続テスト用の依存受け渡し seam を適用する
  Then dashboard は background の runtime クラスを構築せず、正規の singleton 経路で接続テストを実行する
  And 両経路が同一インスタンスを観測する契約が維持される

Scenario: offscreen の live 判定が dashboard の runtime import を持たない
  Given 純関数のコアと live globals に依存するラッパーが同一モジュールに同居している
  When 純コアを共通層へ移し、live ラッパーを offscreen 側に残す
  Then dashboard からの offscreen への runtime import が 0 件になる
  And 検出値・戦略の値と公開 API は移設前後で一致する

Scenario: utils から background への逆辺が lint 対象として機械化される
  Given utils 配下のモジュールが dynamic import で background を参照している
  When 配置を messaging 配下の gateway へ移し、LAYERS の分類と lint ルールを追記する
  Then utils から background への逆辺として扱われる経路が 0 件になる
  And 未分類 utils ファイルの検出または解消の記録が境界 linter 側にある

Scenario: 偽 union の cast が局所 union に置き換わる
  Given 設定値の取得失敗とログ件数の取得失敗が別々の型二重キャストで表現されている
  When 局所 union 型で表現し、手動の narrow を型付きの判定に置き換える
  Then DiagnosticsCollector の表示文言が現状のまま維持される
  And `as unknown as` による偽の型合意が解消される
```

## 受け入れ基準

- [x] (a) `src/dashboard/gistSettings.ts:9-10,55-56` の `GistSyncTarget` / `SqliteClient` の直接構築がなくなり、正規 singleton（`src/background/compositionManifest.ts:88` の `getSharedSqliteClient`）が利用されている。
- [x] (a) で導入した注入 seam が、dashboard からメッセージを送る経路または factory 注入のいずれかとして明示され、既存 singleton 契約（both-paths-one-instance）を壊さない。
- [x] (a) の副次目標として、`src/dashboard/gistSettings.ts` 内の 3 責務（DOM 処理 / settings 永続化 / 接続テスト）の分離方針が決められている。
- [x] (b) `src/offscreen/opfsCapabilities.ts:10-52` の純関数（`OpfsProbeGlobals` / `detectOpfsCapabilities` / `selectVfsStrategy` / `VfsStrategy`）が `src/utils/vfsCapabilities.ts` へ移っている。
- [x] (b) `src/offscreen/opfsCapabilities.ts:54-71` の `probeLiveEnv` / `detectLiveVfsStrategy` は offscreen 側に残り、`src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:21` から offscreen への runtime import が解消されている。
- [x] (b) の移設で値と公開 API が変化していない（純粋な移設である）。
- [x] (c) `src/utils/auditLog.ts:20-31` の dynamic import による background 参照が解消され、`src/messaging/` 配下の gateway（`pendingRecordGateway.ts` / `regenerateSummaryGateway.ts` と同形）へ移設されている。
- [x] (c) で client promise のキャッシュが `storageMaintenance.ts` のパターンと重複したまま残っていない。
- [x] (c) に伴い LAYERS.md の分類追記と、`eslint/rules/utils-layer-boundary.mjs` への未分類 utils ファイル検出の追加（または auditLog 移設により解消した旨の記録）のいずれかが完了している。
- [x] (d) `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:123,126` の `as unknown as` による偽 union が局所 union（`number | 'unavailable'` / `Pick<Settings, StorageKey> | null`）に置き換えられ、`:138-140` の手動 narrow が 型付きの判定に置き換わっている。
- [x] (d) の変更後も DiagnosticsCollector の「Unavailable」表示文言が変わっていない。
- [x] `npm run validate` が成功し、既存のビルド・テスト・ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「接続テストが正規経路で成功する」「診断パネルが vfs 戦略とログ件数を正しく表示する」という観測点を確認する。
- 新しいユーザー機能は追加せず、4 サブ項目いずれの変更による機能変更がないことを Outside-In の観測点とする。
- DiagnosticsCollector の「Unavailable」表示が変更前後で同一であることを観測する。

### 統合テスト

- (a) では、正規 singleton 経路（`src/background/compositionManifest.ts:88` の `getSharedSqliteClient`）と dashboard からの注入 seam の双方が同一インスタンスを観測することを検証する。`src/background/sqlite/offscreenGateway.ts:213-218` の both-paths-one-instance 契約が維持されること。
- (b) では、`detectLiveVfsStrategy` の呼び出しが dashboard から messaging / utils 側の純 core 経由で解決され、offscreen への runtime edge がないことを検証する。
- (c) では、audit の client promise キャッシュが messaging gateway 側で 1 箇所に集約され、`storageMaintenance.ts` パターンのコピーが 2 つ以上ないことを検証する。
- (d) では、設定ロード失敗と接続テスト失敗の両経路で局所 union が正しく narrow され、既存の設定値が従来どおり復元されることを検証する。
- ESLint ルール側では、`eslint/rules/utils-layer-boundary.mjs` に未分類 utils ファイル検出を追加した場合、その検出が `src/utils/auditLog.ts` を解消済みとして正しく扱えることを確認する。

### 単体テスト

- (b) の純 core（`src/utils/vfsCapabilities.ts`）は、live globals に依存せず `OpfsProbeGlobals` を受け取る形で既存と同じ結果を返すことを検証する。移設で値が変わらないことを確認する pin とする。
- (d) の局所 union は、`number | 'unavailable'` と `Pick<Settings, StorageKey> | null` の各分岐で既存と同じ表示値になることを検証する。
- (a) の注入 seam は、接続テスト成功時・失敗時の両方で同じ結果とエラーを返すことを検証する。
- (c) の移設は、audit 記録の順序と内容が同一であることを検証する。

## 実装アプローチ

- **Outside-In**: まず「接続テストが正規 singleton で動く」「診断パネルの表示が変わらない」という外部観測点を failing / baseline として確認し、その後に各サブ項目へ入る。
- **1 サブ項目ごとに独立 commit 候補**: バンドルであっても 4 サブ項目は独立に検証可能な単位であるため、各サブ項目を独立 commit の候補として切り出す。1 コミットにまとめて squash しない。
- **純粋な移設を優先**: (b) と (c) は値の/API を変えず移設のみを行い、純粋 core 化によって境界違反を減らす。
- **依存注入で composition root を経由**: (a) は新しい singleton を作らず、既存の正規 singleton 経路へ依存を注入する。
- **型の嘘の解消**: (d) は機能変更を伴わない型レベルの是正であり、表示文言を変更しないことを DoD 条件に含める。

## 見積もり

**1 SP**

4 サブ項目はいずれも S 規模で、ファイルは相互に重複しない。(a) の注入 seam 設計と 3 責務の分離判断、(b) の純 core 移設、(c) の gateway 移設と LAYERS / lint の追記、(d) の局所 union 化が主体である。4 サブ項目の合計で 1 SP と見積もる。

## 技術的考慮事項

- LAYERS は `dev-docs/LAYERS.md:138` で dashboard → background を「純粋定数・型・カタログ表のみ」に制限している。dashboard から runtime クラスを構築する経路はこれに反する。
- 正規 singleton は `src/background/compositionManifest.ts:88` の `getSharedSqliteClient` であり、`src/background/sqlite/offscreenGateway.ts:213-218` に both-paths-one-instance 契約が明記されている。`gistSettings.ts` が 2 つめのインスタンスを作るのはこの契約の破壊にあたる。
- (a) の対象は `src/dashboard/gistSettings.ts:9-10`（`GistSyncTarget` と `SqliteClient` の import）と `:55-56`（`new SqliteClient()` と `new GistSyncTarget(...)`）。同ファイルの他 12 import は catalog / 定数 / type であり、正規の配置に従っている。
- (a) の接続テスト用注入 seam は、dashboard からメッセージを送る経路（messageTransport）または factory 注入のいずれかとする。どちらを選んでも既存 singleton 契約は維持しなければならない。
- (a) には副次目標として、`src/dashboard/gistSettings.ts` 内の 3 責務（DOM 処理 / settings 永続化 / 接続テスト）の分離がある。
- (b) の `src/offscreen/opfsCapabilities.ts:10-52` は純関数のみ（`OpfsProbeGlobals` / `detectOpfsCapabilities` / `selectVfsStrategy` / `VfsStrategy`）で、`:54-71` の `probeLiveEnv` / `detectLiveVfsStrategy` のみが live globals に依存する。
- (b) の `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:21` が `detectLiveVfsStrategy` を runtime import しており、dashboard → offscreen の無検査 edge になる。dashboard 内の他依存は注入済みであるのに、この 1 つだけ module-level 既定値（`:102`）を持つ。
- (b) の移設先は `src/utils/vfsCapabilities.ts`（純 core）とし、live wrapper は offscreen 側に残す。
- (c) の `src/utils/auditLog.ts:20-31` は dynamic import で background の sqlite / offscreenGateway を読む。これは utils → background への第 2 の逆辺である。第 1 は `dev-docs/LAYERS.md:89-91` に例外記録済みの `storageMaintenance.ts` である。
- (c) の auditLog は lint 対象外である（dynamic import かつ未分類ファイル）。移設先は `src/messaging/` 配下の gateway を推奨し、`pendingRecordGateway.ts` / `regenerateSummaryGateway.ts` と同形とする。
- (c) の client promise キャッシュは `storageMaintenance.ts` パターンの 2 コピー目になる。移設時に重複を解消すべきか存置するかを明示する。
- (c) には LAYERS.md の分類追記と、`eslint/rules/utils-layer-boundary.mjs` への未分類 utils ファイル検出の追加（あるいは auditLog 移設で解消した旨の記録）のいずれかが必要である。
- (d) の `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:123` は `DEFAULT_SETTINGS as unknown as Pick<Settings, StorageKey>`、`:126` は `.catch(() => ({ error: 'unavailable' } as unknown as Awaited<ReturnType<typeof getLogCount>>))` であり、どちらも型として嘘である。`:138-140` が手動 narrow で誤魔化している。
- (d) の修正は局所 union（`number | 'unavailable'` / `Pick<...> | null`）への置換であり、DiagnosticsCollector の「Unavailable」表示文言は変えない。

## 実装者向け注記

### 現状コードの確認

- `src/dashboard/gistSettings.ts:9-10` は `GistSyncTarget` と `SqliteClient` を import し、`:55-56` で `new SqliteClient()` と `new GistSyncTarget(...)` を直接構築する。他 12 import は catalog / 定数 / type であり正規。
- 正規 singleton は `src/background/compositionManifest.ts:88` の `getSharedSqliteClient`。契約の記述は `src/background/sqlite/offscreenGateway.ts:213-218`。
- `src/offscreen/opfsCapabilities.ts:10-52` は純関数、`:54-71` のみが live globals に依存する。
- `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:21` が `detectLiveVfsStrategy` を runtime import し、`:102` に module-level 既定値を持つ。dashboard 内の他依存は注入済みである。
- `src/utils/auditLog.ts:20-31` は dynamic import で background の sqlite / offscreenGateway を読む。lint 対象外（dynamic import かつ未分類）。
- `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:123,126` に `as unknown as` の偽 union があり、`:138-140` が手動 narrow で誤魔化している。
- 4 サブ項目の対象ファイルは相互に重複しないため、並列実装が可能である。

### 実装手順

1. `rg` で `src/dashboard` から background runtime クラスを `new` する経路を再確認し、本 PBI の対象が (a) のみであることを確定する。
2. **(a)**: `src/dashboard/gistSettings.ts` から runtime クラスの直接構築を 제거し、正規 singleton 経路（`getSharedSqliteClient`）かメッセージ経由の注入 seam で `testConnection` を実行する形に変える。3 責務の分離方針を決める。独立 commit 候補。
3. **(a) 検証**: 接続テストの成功・失敗の両経路で、正規 singleton と dashboard 経路が同一インスタンスを観測することを確認する。独立 commit 候補。
4. **(b)**: `src/offscreen/opfsCapabilities.ts:10-52` の純関数を `src/utils/vfsCapabilities.ts` へ移し、`:54-71` の live wrapper を offscreen 側に残す。`src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:21` の runtime import を純 core 経由へ置き換える。独立 commit 候補。
5. **(b) 検証**: 純 core が live globals なしで同じ検出値を返すことを pin し、dashboard から offscreen への runtime edge が 0 件であることを確認する。
6. **(c)**: `src/utils/auditLog.ts` を `src/messaging/` 配下の gateway へ移設し、client promise キャッシュの重複を解消するか存置するか決める。LAYERS.md の分類を追記し、`eslint/rules/utils-layer-boundary.mjs` に未分類 utils ファイル検出を追加するか、解消した旨を記録する。独立 commit 候補。
7. **(c) 検証**: utils から background への逆辺（dynamic import 含む）が 0 件であることを確認する。
8. **(d)**: `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:123,126` の偽 union を局所 union に置き換え、`:138-140` の手動 narrow を型付き判定に置き換える。独立 commit 候補。
9. **(d) 検証**: DiagnosticsCollector の「Unavailable」表示文言が変更前後で同一であることを確認する。
10. `npm run validate` を実行し、型とテストの正常を確認する。

### 落とし穴

- **(a)** dashboard から messaging へ動的 import する経路（messageTransport）を壊すと、既存の singleton 契約（both paths observe one instance）が失われる。注入は既存 singleton 経路の観測点を通るように行う。
- **(a)** 依存注入のために新しいインスタンスを作る injection seam を用意すると、singleton 契約が破られ、接続テストが本番と異なるインスタンスを検査する。seam は参照の受け渡しに留める。
- **(b)(c)** は移設のみであり、値と公開 API を変えてはいけない。移設と同時にロジックを整理すると、差分の切り分けができなくなる。
- **(b)** live wrapper を offscreen 側に残さないと、`src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:21` の edge が残る。純 core の移動と live wrapper の残置は対で適用する。
- **(c)** dynamic import を使うため、既存の lint は utils → background の逆辺を検出しない。移設だけでは検出が埋められないため、LAYERS の分類追記と linter の未分類検出のどちらかが必要である。
- **(d)** `as unknown as` を単純に外すと型エラーになるが、それは型が嘘であった証拠である。局所 union を明示して解決し、`:138-140` の手動 narrow も同時に型付き判定へ置き換える。
- **(d)** 局所 union 化に伴い DiagnosticsCollector の表示文言や「Unavailable」の表記を変更すると、観測される UI が変わり既存テストが落ちる。文言は不変とする。
- 4 サブ項目は独立 commit 候補だが、1 コミットにまとめると、1 サブ項目の検証失敗が他 3 つの検証を巻き込む。各サブ項目を独立に検証できる状態を保つ。

## 決定事項

1. 4 件を 1 バンドルに束ねる理由は、4 件とも S 規模で個別 PBI では DoD が希薄になり、ファイルも相互に重複しないためである。
2. (a) が composition root を迂回している理由は、`src/dashboard/gistSettings.ts:9-10,55-56` が dashboard から background の runtime クラスを直接 import して `new` するためである。LAYERS は dashboard → background を純粋定数・型・カタログ表に制限している（`dev-docs/LAYERS.md:138`）。
3. (a) の修正は新しい singleton を作らず、`src/background/compositionManifest.ts:88` の `getSharedSqliteClient` を参照する注入 seam（メッセージ経由または factory 注入）とする。
4. (b) の純 core を `src/utils/vfsCapabilities.ts` へ移すのは、`src/offscreen/opfsCapabilities.ts:10-52` が live globals に依存しない純関数であり、dashboard から参照すべき対象に offscreen を含める必要がないためである。live wrapper は offscreen 側に残す。
5. (c) の `src/utils/auditLog.ts` を `src/messaging/` 配下へ移すのは、utils → background への第 2 の逆辺を排除する必要があるためである。移設先は `pendingRecordGateway.ts` / `regenerateSummaryGateway.ts` と同形の gateway とする。
6. (c) は移設だけでは検出が埋まらないため、LAYERS.md の分類追記と `eslint/rules/utils-layer-boundary.mjs` の未分類 utils ファイル検出の追加（または解消記録）のいずれかを行う。
7. (d) の偽 union は局所 union（`number | 'unavailable'` / `Pick<Settings, StorageKey> | null`）に置き換え、型が実態と一致する状態にする。表示文言は変更しない。
8. 4 サブ項目はそれぞれ独立 commit の候補として実装し、1 コミットに squash しない。
9. 4 サブ項目のいずれも、観測される挙動（定数値・メッセージ・表示文言）は変更しない。値と公開 API の変更は本 PBI のスコープ外である。

## Definition of Done

- [x] (a) `src/dashboard/gistSettings.ts` から background runtime クラスの直接構築がなくなり、正規 singleton（`getSharedSqliteClient`）が利用されている。
- [x] (a) の注入 seam が方式（メッセージ経由 / factory 注入）として明示され、both-paths-one-instance 契約が維持されている。
- [x] (a) の 3 責務（DOM / settings 永続化 / 接続テスト）の分離方針が確定している。
- [x] (b) 純 core が `src/utils/vfsCapabilities.ts` に移られ、`src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:21` から offscreen への runtime import が解消されている。
- [x] (b) の live wrapper が offscreen 側に残り、値と公開 API が変更されていない。
- [x] (c) `src/utils/auditLog.ts` が `src/messaging/` 配下の gateway へ移され、utils から background への逆辺が 0 件になっている。
- [x] (c) の client promise キャッシュの重複の扱いが確定し、LAYERS.md の分類追記または linter の未分類検出の追加が完了している。
- [x] (d) `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:123,126` の `as unknown as` が局所 union に置き換えられ、手動 narrow が型付き判定に置き換わっている。
- [x] (d) の変更後も DiagnosticsCollector の「Unavailable」表示文言が同一である。
- [x] 4 サブ項目がそれぞれ独立 commit の候補として実装されている。
- [x] `npm run validate` が成功し、既存テストとビルドに回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
