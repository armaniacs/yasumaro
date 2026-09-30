# PBI: messaging 層の background への runtime edge 解消

## ユーザーストーリー

保守者として、中立 wire 層 `src/messaging/` を background への runtime 依存ゼロにしたい。なぜなら 4 本の runtime edge と `CURRENT_PROTOCOL_VERSION` の 2 経路が drift の火種で、閉路も 1 本形成されているからだ。

## ビジネス価値

- 「中立 wire 層」という `src/messaging/` の位置づけを、実際に background へ依存しない構造として成立させる。
- `CURRENT_PROTOCOL_VERSION` の 2 経路（protocol 直参照と messageTypes 経由の re-export）を 1 本に収束させ、プロトコル版の drift を構造的に防ぐ。
- メッセージ種別の定数を messaging へ集約し、popup / dashboard / SessionAlarmService を含む約 14 ファイルの変更で「定数の所在」を単一にする。
- lint で `src/messaging/` から background および utils への runtime import を禁止し、将来の再侵入を機械的に検出できる状態にする。

## 優先度

- 種別: refactor
- 順位: 14 / 17
- RICEスコア: 3.6（Reach=4 / Impact=2 / Confidence=90% / Effort=2 SP）

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: 中立 wire 層から background への runtime edge が 0 件になる
  Given src/messaging/ が runtime 値を background から import している箇所が 4 件存在する
  And type-only import が 5 箇所存在する
  When メッセージ種別の runtime 定数を src/messaging/ へ移し、import を更新する
  Then src/messaging/ から src/background への runtime import が 0 件になる
  And type-only import は移設対象として扱わない

Scenario: 閉路が解消される
  Given messaging の validator が background の handler 実装を参照する設計上の逆転がある
  When wire 契約としての dashboardSqliteProtocol を messaging 配下へ移す
  Then messaging 内部で wire 契約と handler 実装の向きが正しくなる
  And 観測されるメッセージ契約と subtype 判定の値が不変である

Scenario: CURRENT_PROTOCOL_VERSION の参照経路が 1 本に収束する
  Given protocol.ts を SSOT とする直参照と、messageTypes の re-export 経由の参照が併存している
  When 全ての参照を protocol の直参照へ更新する
  And background/messageTypes.ts を re-export shim に降格する
  Then CURRENT_PROTOCOL_VERSION の参照が protocol 直参照の 1 経路に収束する
  And プロトコル版の値が不変である

Scenario: lint が messaging の runtime 境界を機械的に拒否する
  Given src/messaging/ から background または utils への runtime import を追加する
  When lint を実行する
  Then runtime import は no-restricted-imports によって拒否される
  And import type は許容される
```

## 受け入れ基準

- [ ] `src/background/messageTypes.ts` から runtime 定数 4 つ（`AI_TEST_PROGRESS_MESSAGE_TYPE` / `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ALLOWED_TYPES` / `NO_PAYLOAD_TYPES`）が `src/messaging/` へ移されている。
- [ ] `src/background/messageTypes.ts` は re-export shim に降格しており、`ExtensionMessage` union は `import type` のまま移設されていない。
- [ ] `src/messaging/` から `src/background/` への runtime import が 0 件になっている（type-only の 5 箇所は移設対象外）。
- [ ] `src/background/handlers/dashboardSqliteProtocol.ts` が messaging 配下へ移され、`messaging/sqliteMessages.ts` および `messaging/sqliteOperationSecurity.ts` と同列の wire 契約として配置されている。
- [ ] `CURRENT_PROTOCOL_VERSION` の参照が `src/messaging/protocol.ts` の直参照 1 経路に収束している。
- [ ] `src/messaging/` 配下から `src/background` および `src/utils` への runtime import を拒否する `no-restricted-imports` 設定が `files: ['src/messaging/**/*.ts']` で追加されている（`eslint/rules/utils-layer-boundary.mjs` ではなく `no-restricted-imports` 1 本とする）。
- [ ] 定数値、メッセージ契約、プロトコルバージョンの値が変更されていない。
- [ ] `npm run validate` が成功し、既存のビルド・テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「ダッシュボードと service worker のメッセージングが従来どおり往復する」という観測点を確認する。
- 新しいユーザー機能は追加せず、定数移設と shim 化による機能変更がないことを Outside-In の観測点とする。
- 接続テストと sqlite 操作の subtype 判定が従来どおりの結果を返すことを観測する。

### 統合テスト

- `src/background/handlers/dashboardSqliteProtocol.ts` を messaging 配下へ移した後も、dashboard → background の subtype 検証（`TOKEN_REQUIRED_SUBTYPES`）が同一の結果を返すことを一続きの経路として検証する。
- re-export shim 経由の参照（popup 2・dashboard 3・SessionAlarmService・messaging 3）が、移設後も同じ定数値を解決することを検証する。
- protocol 直参照へ更新した 4 経路（`src/messaging/messageTransport.ts:7`、`src/messaging/pendingRecordGateway.ts:18`、`src/messaging/regenerateSummaryGateway.ts:14`、`src/offscreen/offscreenLogger.ts:10`）が SSOT の値と一致することを検証する。
- ESLint の `no-restricted-imports` が `src/messaging/**/*.ts` に対して runtime import を拒否し、`import type` を許容することを検証する。
- `scripts/check-deprecated-aliases.mjs` が shim 化した `src/background/messageTypes.ts` を deprecated alias として誤検知しないことを確認する。

### 単体テスト

- `src/messaging/validators.ts` の subtype 述語が移設後も同一の結果を返すことを pin する。
- `src/messaging/types.ts` の `VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES` の値が不変であることを pin する。
- `AI_TEST_PROGRESS_MESSAGE_TYPE` と `CONTENT_SCRIPT_ALLOWED_TYPES` の参照側が移設後も同じ文字列を解決することを pin する。
- 既存の protocol-version 関連 pin テスト（2026-09-05-23 / 2026-08-23-08 の系譜）が import パスを mock していないかを確認し、必要なら更新する。

## 実装アプローチ

- **Outside-In**: まず「messaging から background への runtime import が 0 件」「lint がその境界を拒否する」という観測点を failing として用意し、定数移設で green にする。
- **SSOT への収束**: `CURRENT_PROTOCOL_VERSION` は `src/messaging/protocol.ts` の直参照だけに統一し、`src/background/messageTypes.ts` 経由の経路を段階的に減らす。
- **shim による段階移行**: `src/background/messageTypes.ts` は re-export shim として残し、import 更新は一度に行わない。shim 経由で移行し、完了後に shim の存置可否を再検討する。
- **lint による機械化**: `no-restricted-imports` を 1 本使い、`src/messaging/**/*.ts` から background と utils への runtime import を拒否する。`import type` は許可する。
- **閉路の解消**: `dashboardSqliteProtocol.ts` は wire 契約として messaging 配下へ移し、handler 実装から wire 契約へ依存する構造にする。

## 見積もり

**2 SP**

定数 4 つの移設と re-export shim 化（1 SP）、`CURRENT_PROTOCOL_VERSION` 参照の 14 ファイル更新と lint 設定追加（0.5 SP）、`dashboardSqliteProtocol.ts`（177 行）の messaging 配下移設と既存 pin テストの import パス確認（0.5 SP）が内訳である。

## 技術的考慮事項

- `src/messaging/` から `src/background/` への runtime edge は 4 本である: `src/messaging/dashboardGateway.ts:13`（`CURRENT_PROTOCOL_VERSION`）、`src/messaging/types.ts:156`（`VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES`）、`src/messaging/validators.ts:30`（`messageTypes` から export された `isHttpScheme` 系）、`src/messaging/messageTransport.ts:9`（`VALID_MESSAGE_TYPES`）。
- type-only import は 5 箇所（`src/messaging/dashboardGateway.ts:11,16`、`src/messaging/validators.ts:30-32` の一部、`src/messaging/messageTransport.ts:8`、`src/messaging/types.ts:157`）であり、移設不要である。
- 閉路は `src/messaging/validators.ts` → `src/background/handlers/dashboardSqliteProtocol.ts` → `src/messaging/sqliteMessages` の順である。type-only であるため runtime 閉路にはならないが、設計上の逆転になっている。
- `src/background/handlers/dashboardSqliteProtocol.ts` は 177 行で、runtime 値は `TOKEN_REQUIRED_SUBTYPES` の 1 つのみである。wire 契約として messaging 配置が自然であり、自身が `src/messaging/sqliteMessages.ts` と `src/messaging/sqliteOperationSecurity.ts` を `:14-15` で import している。
- `CURRENT_PROTOCOL_VERSION` の SSOT は `src/messaging/protocol.ts` である。正しく protocol を直参照しているのは `src/messaging/messageTransport.ts:7`、`src/messaging/pendingRecordGateway.ts:18`、`src/messaging/regenerateSummaryGateway.ts:14`、`src/offscreen/offscreenLogger.ts:10` である。
- background/messageTypes を経由する re-export 経路は `src/messaging/dashboardGateway.ts:13`、`src/popup/statusChecker.ts:11`、`src/popup/recordCurrentPage/recordSession.ts:10`、`src/dashboard/reviewSummaryHandler.ts:9`、`src/dashboard/settings/ublockImport/urlFetcher.ts:8`、`src/background/SessionAlarmService.ts:12`、`src/dashboard/generalSettings/connectionTests.ts:24` である。
- 移設対象は `src/background/messageTypes.ts`（321 行）の runtime 定数 4 つ（`AI_TEST_PROGRESS_MESSAGE_TYPE` / `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ALLOWED_TYPES` / `NO_PAYLOAD_TYPES`）である。`ExtensionMessage` union は `import type` のため移設不要である。
- 依存先として 2026-09-28-10（Layer 0 caps SSOT）がある。`src/messaging/validators.ts` と limits 領域が重なるため、10 の後に実装する。
- lint は `eslint/rules/utils-layer-boundary.mjs` ではなく `no-restricted-imports` 1 本とする。`files: ['src/messaging/**/*.ts']` ブロックで「background と utils への runtime import 禁止（`import type` は許可）」を宣言する。
- `src/messaging/validators.ts:22,31` の utils import（`archiveGuards` / `cleansesModeLadder`）は方向として許容される（utils は基盤）。完了条件には「messaging から background への runtime edge 0 件」のみを入れる。
- 観測される挙動は不変とする。定数値、メッセージ契約、プロトコルバージョンの値は変更しない。

## 実装者向け注記

### 現状コードの確認

- runtime edge 4 本: `src/messaging/dashboardGateway.ts:13`、`src/messaging/types.ts:156`、`src/messaging/validators.ts:30`、`src/messaging/messageTransport.ts:9`。
- type-only 5 箇所: `src/messaging/dashboardGateway.ts:11,16`、`src/messaging/validators.ts:30-32` の一部、`src/messaging/messageTransport.ts:8`、`src/messaging/types.ts:157`。これらは移設不要。
- `src/background/handlers/dashboardSqliteProtocol.ts` は 177 行で runtime 値は `TOKEN_REQUIRED_SUBTYPES` のみ。`:14-15` で `src/messaging/sqliteMessages.ts` と `src/messaging/sqliteOperationSecurity.ts` を import している。
- `CURRENT_PROTOCOL_VERSION` の SSOT は `src/messaging/protocol.ts`。直参照は 4 箇所、re-export 経由は 7 箇所である。
- `src/background/messageTypes.ts` は 321 行。runtime 定数 4 つと `ExtensionMessage` union を保持する。
- `scripts/check-deprecated-aliases.mjs` が存在するため、shim 化とその干渉を確認する。
- 依存 PBI 2026-09-28-10（Layer 0 caps SSOT）と `src/messaging/validators.ts` が重なるため、10 の後に着手する。

### 実装手順

1. `rg` で `src/background/messageTypes` を import している全ファイルを列挙し、runtime import と type-only import を分けて把握する。
2. `rg` で `CURRENT_PROTOCOL_VERSION` の全参照を列挙し、protocol 直参照 4 箇所と re-export 経由 7 箇所を確認する。
3. `src/messaging/types.ts:156` の `VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES`、`src/background/messageTypes.ts` の `AI_TEST_PROGRESS_MESSAGE_TYPE` と `CONTENT_SCRIPT_ALLOWED_TYPES` を `src/messaging/` 配下へ移す。
4. `src/background/messageTypes.ts` を re-export shim に降格させる。`ExtensionMessage` union は `import type` のまま残す。
5. re-export 経路 7 箇所のうち `src/messaging/dashboardGateway.ts:13` を `src/messaging/protocol.ts` の直参照へ切り替える。残りは shim 経由のまま段階移行する。
6. `src/background/handlers/dashboardSqliteProtocol.ts` を `src/messaging/` 配下へ移し、移動後の import を messaging 内の相対 import に更新する。
7. `src/messaging/validators.ts:30` の runtime import を移設後の messaging 定数へ向け、type-only 部分は残す。
8. `no-restricted-imports` に `files: ['src/messaging/**/*.ts']` ブロックを追加し、background と utils への runtime import を拒否し `import type` を許容する。
9. `npm run validate` で型とテストを確認し、既存の protocol-version 関連 pin テストが import パスを mock していれば更新する。
10. 観測される挙動（定数値、メッセージ契約、プロトコル版）が不変であることを確認する。

### 落とし穴

- `src/background/messageTypes.ts` を import しているファイル（popup 2・dashboard 3・SessionAlarmService・messaging 3）の更新漏れが最容易な誤りである。実装冒頭で `rg` による網羅リストを作る。
- 既存の protocol-version 関連 pin テスト（2026-09-05-23 / 2026-08-23-08 の系譜）が import パスを mock している可能性がある。shim 化により mock の解決先が変わるため、Red を確認する。
- shim 化した `src/background/messageTypes.ts` が `scripts/check-deprecated-aliases.mjs` に deprecated alias として誤検知される可能性がある。shim を残すか消すかの判断を明示する。
- re-export shim を残したまま shim 側を削除すると、import 更新漏れが一度に顕在化する。shim の存置期間を明示してから消す。
- `src/background/handlers/dashboardSqliteProtocol.ts` を移すと、handler から wire 契約への向きが変わる。handler 側の import 漏れを確認しないと messaging 内の runtime edge が増える。
- type-only import 5 箇所を runtime import に書き換えると、移設不要の領域まで変更範囲が広がる。`import type` を維持する。
- `src/messaging/validators.ts:22,31` の utils import を機械的に禁止すると、基盤層への正当な依存まで落ちる。完了条件は「background への runtime edge 0 件」のみとする。
- `CURRENT_PROTOCOL_VERSION` の値を変更して shim の動作を確認すると、プロトコル版の drift を検出するはずが誤検出になる。値は一切変更しない。
- 依存 PBI 2026-09-28-10 と `src/messaging/validators.ts` が重なるため、先に 10 を実装してから着手する。

## 決定事項

1. `src/messaging/` を中立 wire 層として成立させる理由は、runtime 定数が background に置かれたことで wire 層が background に依存する構造になったためである。
2. type-only import 5 箇所を移設対象から除外する理由は、type-only は実行時の依存を作らず、`ExtensionMessage` union も移設不要であるためである。
3. `src/background/handlers/dashboardSqliteProtocol.ts` を messaging 配下へ移す理由は、runtime 値が `TOKEN_REQUIRED_SUBTYPES` のみであり wire 契約として messaging 配置が自然で、自身が `:14-15` で `src/messaging/sqliteMessages.ts` と `src/messaging/sqliteOperationSecurity.ts` を import しているからである。
4. `CURRENT_PROTOCOL_VERSION` の SSOT は `src/messaging/protocol.ts` とし、参照を直参照 1 経路に収束させる。`src/background/messageTypes.ts` は re-export shim に降格する。
5. 移設対象は `src/background/messageTypes.ts`（321 行）の runtime 定数 4 つに限定する。`ExtensionMessage` union は移設しない。
6. lint は `eslint/rules/utils-layer-boundary.mjs` ではなく `no-restricted-imports` 1 本とし、`files: ['src/messaging/**/*.ts']` ブロックで background と utils への runtime import を拒否する（`import type` は許可）。
7. `src/messaging/validators.ts:22,31` の utils import（`archiveGuards` / `cleansesModeLadder`）は方向として許容されるため、完了条件には「messaging から background への runtime edge 0 件」のみを入れる。
8. import 更新は shim を介した段階移行とし、実装冒頭で `rg` による網羅リストを作成する。shim の存置期間を明示してから存置可否を再検討する。
9. 定数値、メッセージ契約、プロトコルバージョンの値は変更せず、観測される挙動を不変とする。依存先 2026-09-28-10（Layer 0 caps SSOT）の後に実装する。

## Definition of Done

- [ ] runtime 定数 4 つ（`AI_TEST_PROGRESS_MESSAGE_TYPE` / `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ALLOWED_TYPES` / `NO_PAYLOAD_TYPES`）が `src/messaging/` へ移されている。
- [ ] `src/background/messageTypes.ts` が re-export shim に降格し、`ExtensionMessage` union が `import type` のまま残されている。
- [ ] `src/messaging/` から `src/background/` への runtime import が 0 件になっている。
- [ ] type-only import 5 箇所が `import type` のまま維持されている。
- [ ] `src/background/handlers/dashboardSqliteProtocol.ts` が messaging 配下へ移され、wire 契約として配置されている。
- [ ] `CURRENT_PROTOCOL_VERSION` の参照が `src/messaging/protocol.ts` の直参照 1 経路に収束している。
- [ ] `no-restricted-imports` の `files: ['src/messaging/**/*.ts']` ブロックが background と utils への runtime import を拒否し、`import type` を許容する。
- [ ] re-export 経路 7 箇所の更新漏れがなく、`rg` による網羅リストと照合して確認している。
- [ ] `scripts/check-deprecated-aliases.mjs` との干渉（shim の誤検知）が確認・解消されている。
- [ ] 既存の protocol-version 関連 pin テストが import パスを mock していた場合の更新が完了している。
- [ ] 定数値、メッセージ契約、プロトコルバージョンの値が変更されていない。
- [ ] `npm run validate` が成功し、既存テストとビルドに回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
