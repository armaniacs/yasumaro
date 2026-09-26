# PBI: OffscreenGateway の archive 責務分割

種別: backlog
状態: 着手トリガー待ち（実害は未確認）

## ユーザーストーリー

保守者として、`OffscreenGateway` に query、getStatus、mutate、maintain と14種の archive operation が同じ class に集中している状態を解消したい。archive の routing を `ArchiveGateway` へ抽出することで、archive 固有の修正を query/mutate の経路と混ざらせず、既存の `SqliteClient` façade と呼び出し契約を維持したい。

## ビジネス価値

- `OffscreenGateway` の責務拡大を止め、archive routing の ownership を明確にする。
- archive 固有の修正を `ArchiveGateway` に局所化し、query、getStatus、mutate、maintain の変更との混在を減らす。
- 既存の `SqliteClient` façade を残すことで、14の production 入口、14の `SqliteRpcClient` archive overload、14の dashboard service public function を含む28個の caller を変更せず、内部だけを分離できる。
- 同じ `OffscreenTransport`、wire payload、型を維持するため、runtime の外部契約を変更しない。
- 実害が未確認の既知の ownership 負債について、着手条件と完了条件を先に定める。

## 優先度

順位: 29 / 30
RICEスコア: 0.25（Reach=1 / Impact=0.5 / Confidence=100% / Effort=2 SP）
見積もり: 2 SP
種別: backlog（着手トリガー待ち。実害は未確認）

## BDD受け入れシナリオ

```gherkin
Scenario: archive routing を ArchiveGateway が所有する
  Given OffscreenGateway が query、getStatus、mutate、maintain と14種の archive operation を同一 class に持つ
  When SqliteClient façade から archive operation を呼び出す
  Then archive routing は ArchiveGateway が所有する
  And OffscreenGateway は query、getStatus、mutate、maintain の責務を保持する
  And 既存 caller の呼び出し契約は変わらない

Scenario: archive と非 archive が同じ transport serialization を使う
  Given OffscreenGateway と ArchiveGateway が同じ OffscreenTransport singleton を注入・共有する
  When archive operation を送信する
  Then 両 gateway は同じ mutex と message serialization を使う
  And wire payload と型は変わらない
  And archive 用の別 transport を作成しない

Scenario: archive dispatch と noRetry 契約を維持する
  Given archive dispatch と noRetry の既存契約がある
  When SqliteClient façade と ArchiveGateway の両方から archive operation を dispatch する
  Then dispatch 結果と noRetry の扱いは変わらない
  And archive 固有の routing と retry 契約が両方で確認できる
```

## 受け入れ基準

- [ ] 本 PBI は着手トリガー待ちであり、依存 PBI `pbi/2026-09-25-01-fix-transport-replay-safety.md` の完了と同一 archive noRetry 契約の確定を確認するまでは production code を変更しない。
- [ ] `ArchiveGateway` が14種の archive routing を所有し、`OffscreenGateway` に archive の routing 責務を残さない。
- [ ] `OffscreenGateway` は query、getStatus、mutate、maintain の責務を維持する。
- [ ] `ArchiveGateway` と `OffscreenGateway` は同じ `OffscreenTransport` を注入・共有する。
- [ ] archive 用の別 transport、mutex、message serialization を作らない。
- [ ] wire mapping、wire payload、型を変更しない。
- [ ] `SqliteClient` façade を維持し、既存の28個の caller を変更せずに内部 dispatch を分離する。
- [ ] archive routing の owner が `ArchiveGateway` であることを固定する構造テストを追加する。現状、この構造を固定するテストは存在しない。
- [ ] `src/messaging/__tests__/archiveWireTable.test.ts`、`src/offscreen/__tests__/archiveWireDispatch.test.ts`、`src/background/__tests__/sqliteMaintainWireDispatch.test.ts`、`src/background/handlers/dashboardSqlite/__tests__/archiveHandler.test.ts` の既存契約を維持する。
- [ ] archive dispatch と noRetry の契約を、`SqliteClient` façade と `ArchiveGateway` の両方で維持するテストを追加または更新する。
- [ ] 新しい class seam が archive routing の owner を深め、単なるファイル移動に終わらないことを確認する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 既存の production 入口から `SqliteClient` façade を経由して、archive operation と query/getStatus/mutate/maintain の代表的な呼び出しを同じ transport 上で実行し、既存 호출の観測可能な結果が変わらないことを確認する。
- archive operation の送信が `ArchiveGateway` を経由し、同じ transport の message serialization を使うことを production wiring で確認する。
- 別 transport を作っていないこと、archive dispatch の noRetry 契約が production wiring でも維持されることを確認する。

### 統合テスト

- `SqliteClient` façade、`ArchiveGateway`、`OffscreenGateway`、共有 `OffscreenTransport` を接続し、14種の archive routing が `ArchiveGateway` に所有されることを確認する。
- archive routing と query/getStatus/mutate/maintain routing の責務境界を構造テストで固定する。
- 既存の `archiveWireTable.test.ts`、`archiveWireDispatch.test.ts`、`sqliteMaintainWireDispatch.test.ts`、`archiveHandler.test.ts` と併せて、wire payload、型、dispatch 結果を維持する。
- façade と `ArchiveGateway` の両方で archive dispatch と noRetry 契約を確認する。
- 同じ transport singleton が archive と非 archive の両経路に共有されることを確認する。

### 単体テスト

- 14種の archive operation がそれぞれ `ArchiveGateway` の正しい routing へ渡ることを確認する。
- `OffscreenGateway` の query、getStatus、mutate、maintain の routing に archive の routing が混ざっていないことを確認する。
- `SqliteClient` façade が archive operation を `ArchiveGateway` に委譲し、既存の公開契約を保つことを確認する。
- 同じ `OffscreenTransport` の注入・共有と、archive 用の別 transport を作らないことを確認する。
- archive dispatch と noRetry の各契約が façade と新 gateway の両方で同じことをを確認する。

## 実装アプローチ

1. 依存 PBI `pbi/2026-09-25-01-fix-transport-replay-safety.md` の完了と、同一 archive noRetry 契約の変更がないことを確認する。着手トリガーが成立するまで実装を開始しない。
2. archive routing の owner が `ArchiveGateway` であることを示す構造テストを先に追加し、現状の `OffscreenGateway` に archive routing が残る状態を失敗として固定する。
3. 既存の `src/background/sqlite/offscreenGateway.ts` から archive の routing 部分と所有境界を切り出し、`ArchiveGateway` を追加する。
4. `ArchiveGateway` に既存と同じ `OffscreenTransport` を注入する。transport の生成、singleton、mutex、message serialization は変更しない。
5. `OffscreenGateway` は query、getStatus、mutate、maintain を保持し、archive の dispatch だけを `ArchiveGateway` へ委譲する。
6. `SqliteClient` façade、production 入口、`SqliteRpcClient` の archive overload、dashboard service の public function は変更せず、内部の gateway 境界だけを切り替える。
7. archive dispatch と noRetry の契約を façade と `ArchiveGateway` の両方で固定し、既存の4つの関連テストを維持する。
8. 構造テストと既存 wire/dispatch テストにより、単なるファイル移動ではなく ownership の分割であることを確認する。

## 見積もり

- 2 SP（14 overload の移設、transport 共有、facade 維持、archive dispatch と noRetry の contract test を含む）。
- 着手トリガー: 次の archive subtype 追加、transport replay safety 統一の完了、または `OffscreenGateway` の変更が計画された時点。

### 並行性

- 同じ `OffscreenTransport` instance を `OffscreenGateway` と `ArchiveGateway` に注入・共有する。
- `src/background/OffscreenTransportBase.ts:11` の mutex は transport ごとに持つため、archive 用の別 transport を作ると mutex と message serialization が分裂する。
- 現在の singleton は `src/background/sqlite/offscreenGateway.ts:199-203` にあるため、この singleton を維持する。
- archive と query/getStatus/mutate/maintain は同じ transport の serialization を使う。
- 新しい transport、lock、queue、restart state を追加しない。wire payload と型を変更しないため、同一の concurrent restart リスクも導入しない。
- archive noRetry の契約は依存 PBI の transport replay safety と同じものを維持する。

## 技術的考慮事項

- `OffscreenGateway` は現在1 class に query、getStatus、mutate、maintain と14種の archive operation を持ち、archive 分岐は `src/background/sqlite/offscreenGateway.ts:110-118` にある。
- archive の production 入口は `src/background/handlers/dashboardSqlite/deps.ts:214-233` に14件ある。
- `src/messaging/sqliteRpcClient.ts:182-195` には14の archive overload があり、`src/dashboard/dashboardSqliteService.ts:318-450` には14の public function がある。
- `SqliteClient` façade を残すことで、28個の caller を変更せずに内部だけを分離できる。
- archive の routing owner を `ArchiveGateway` へ移し、wire mapping の整理と ownership の分割を別の変更として扱う。
- 既存 scope の記録では、Offscreen/Dashboard の hop は分割対象だが、archive gateway 案は acceptance criteria に含まれない。本 PBI はその未決の ownership を対象にする。
- 同一 `OffscreenTransport` の共有を維持し、transport ごとの mutex を分離しない。
- wire payload と型を変えないため、archive dispatch の外部契約を変更しない。
- 新しい class seam は archive routing の owner を深めるものとし、ファイル配置だけを変更して委譲境界を残さない。
- 依存 PBI `pbi/2026-09-25-01-fix-transport-replay-safety.md` との同一ファイル・同一 archive noRetry 契約の競合を避けるため、本 PBI は依存 PBI を先に実施する。

## 実装者向け注記

### 現状コードの確認

- `src/background/sqlite/offscreenGateway.ts:22-213` に class 定義が1つあり、archive 分岐は `:110-118` にある。
- `src/background/sqlite/offscreenGateway.ts:199-203` に現在の singleton がある。
- `src/background/handlers/dashboardSqlite/deps.ts:214-233` に14の archive production 入口がある。
- `src/messaging/sqliteRpcClient.ts:182-195` に14の archive overload がある。
- `src/dashboard/dashboardSqliteService.ts:318-450` に14の archive public function がある。
- `src/background/OffscreenTransportBase.ts:11` に transport ごとの mutex がある。
- `src/messaging/__tests__/archiveWireTable.test.ts`、`src/offscreen/__tests__/archiveWireDispatch.test.ts`、`src/background/__tests__/sqliteMaintainWireDispatch.test.ts`、`src/background/handlers/dashboardSqlite/__tests__/archiveHandler.test.ts` が既存テストである。
- archive routing が `OffscreenGateway` 由来であることを固定する構造テストは存在しない。
- `pbi/2026-09-25-01-fix-transport-replay-safety.md` が同一ファイル・同一 archive noRetry 契約で先行する。
- 既存 scope の記録では、Offscreen/Dashboard の hop は分割対象だが、archive gateway 案は acceptance criteria に含まれない（`dev-docs/archived/pbi/2026-09-03-07-refactor-sqlite-gateway-fidelity.md:14-17`）。

### 実装手順

1. 着手トリガーとして、依存 PBI の完了と archive noRetry 契約の維持を確認する。
2. 既存 archive dispatch と `OffscreenGateway` の routing 境界を、構造テストで先に固定する。
3. archive operation の routing と所有責務を `ArchiveGateway` へ移し、`OffscreenGateway` の非 archive 責務を維持する。
4. 既存の同一 `OffscreenTransport` singleton を `ArchiveGateway` に注入し、新しい transport や mutex を作らない。
5. `SqliteClient` façade を経由した内部 dispatch だけを新 gateway に接続し、14の production 入口、14の overload、14の public function は変更しない。
6. archive wire mapping、payload、型、dispatch、noRetry の契約を façade と `ArchiveGateway` の両方でテストする。
7. 既存の4つの関連テストと新しい構造テストが、archive routing owner と非 archive 責務の分離を確認する。
8. 実装後に、archive と非 archive が同じ transport serialization を使うこと、既存 caller が変更されていないことを確認する。

### 落とし穴

- `ArchiveGateway` に新しい `OffscreenTransport` を作ると、transport ごとの mutex が分裂し、message serialization が変わる。
- archive 分岐を別ファイルへ移すだけで `OffscreenGateway` に routing owner を残すと、単なるファイル移動になり、責務分割にならない。
- façade 側だけに archive routing を委譲すると、`ArchiveGateway` の所有境界と noRetry 契約が façade に埋もれる。
- 新 gateway 側だけで noRetry を維持すると、`SqliteClient` façade 経由の既存 dispatch 契約が検証できない。
- wire mapping、payload、型を変更すると、既存 caller と transport の契約を同時に変更してしまう。
- 14種の archive operation のどれかをroute 表から外すと、production 入口との対応が失われる。
- 既存4つの関連テストだけを変更して構造の境界を固定しないと、`OffscreenGateway` に archive routing が戻ったことを検出できない。

## 決定事項

5 Whys を通じて、archive gateway の owner と分割理由を次のように固定する。

1. gateway に集中した理由は、archive が既存の maintain API への追加として実装されたためである。
2. 同じ API にした理由は、transport、decode、retry の基盤を再利用したためである。
3. 責務を分けなかった理由は、機能追加時に route 追加を優先したためである。
4. wire table 化後も責務が残った理由は、wire mapping の整理と ownership の分割を別論点として扱ったためである。
5. 新しい class seam は、archive routing を所有する `ArchiveGateway` として採用する。`OffscreenGateway` は query、getStatus、mutate、maintain と archive への委譲だけを担当し、単なるファイル移動にはしない。
6. `ArchiveGateway` と `OffscreenGateway` は同じ `OffscreenTransport` singleton を共有し、別 transport、mutex、message serialization は作らない。
7. `SqliteClient` façade、wire payload、型、archive noRetry 契約は維持し、既存 caller の変更を分割作業に含めない。

## Definition of Done

- [ ] 依存 PBI `pbi/2026-09-25-01-fix-transport-replay-safety.md` が完了し、同一 archive noRetry 契約が維持されている。
- [ ] 着手トリガー待ちの条件と、実害未確認である backlog としての範囲が明記されている。
- [ ] `ArchiveGateway` が14種の archive routing を所有し、`OffscreenGateway` に archive routing 責務が残っていない。
- [ ] `OffscreenGateway` は query、getStatus、mutate、maintain の責務を維持している。
- [ ] 両 gateway は同じ `OffscreenTransport` singleton を共有し、mutex と message serialization が分裂していない。
- [ ] wire mapping、wire payload、型に変更がない。
- [ ] `SqliteClient` façade と28個の caller の呼び出し契約に変更がない。
- [ ] archive routing owner を固定する構造テストがある。
- [ ] archive dispatch と noRetry の契約を façade と `ArchiveGateway` の両方で確認するテストがある。
- [ ] 既存4つの関連テストと、追加した構造・契約テストが成功する。
- [ ] 実装が単なるファイル移動ではなく、archive routing の owner を深めた構造になっている。
