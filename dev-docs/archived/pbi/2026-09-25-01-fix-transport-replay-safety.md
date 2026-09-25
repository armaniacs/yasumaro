# PBI: SQLite トランスポートの mutate 再実行安全性保証

## ユーザーストーリー
ユーザーとして、タイムアウト後にも変更処理が二重実行されないことを保証してほしい、なぜなら履歴のスターや監査ログなどの非冪等な変更が重複するのを防ぎ、データ整合性を保証できるからである。

## ビジネス価値
非冪等な mutate の二重実行を再試行ポリシーによって抑止し、履歴と監査ログの重複を防ぎ、全 32 経路と将来追加する経路を同一の安全側ポリシーで管理できる。

## 優先度
順位: 01 / 30
RICEスコア: 20.0（Reach=25 / Impact=2 / Confidence=80% / Effort=2 SP）
根拠: 32 経路の retry policy が未定義で、25 経路が既定の再試行対象になっている。データ重複を防ぐ修正で、新経路にも安全な既定を適用できるため、優先度 01 とする。

## BDD受け入れシナリオ
```gherkin
Scenario: 再実行安全な変更処理が一時的な送信失敗から完了する
  Given 再実行可能と判断された変更処理があり、初回送信後に応答だけが失われる
  When 利用者がその変更処理を実行する
  Then 処理は既存の方針に従って再送され、意図した変更が二重実行されない

Scenario: retry policy が未設定の新規経路が自動再試行されない
  Given retry policy が未設定の新規経路が利用可能な状態である
  When 利用者がその経路の変更処理を実行する
  Then トランスポートは安全側として一度だけ送信し、自動再試行しない

Scenario: 再実行禁止として明示された変更処理が再送されない
  Given 再実行禁止と明示された変更処理があり、送信結果がタイムアウトする
  When 利用者がその変更処理を実行する
  Then トランスポートは一度だけ送信し、同一処理を再度送信しない
```

## 受け入れ基準
- [x] 既存 32 経路すべてに retry policy の判定結果があり、テーブル化されていない `getStatus()` を含む。
- [x] retry policy が未設定または新規追加された経路は、一切の自動再試行を行わない fail-closed な動作になる。
- [x] 再実行安全と分類された変更処理は、既存の single retry として最大 2 回送信できる。
- [x] `toggleStar` と archive の 6 経路を含む既存 7 経路は、再実行禁止の 1 回送信を維持する。
- [x] 既存テストが要求する set 意味論の mutate は、single retry を維持する。
- [x] `insert`、`insertBatch`、`insertAuditLog` の分類は、指定された 5 Whys の検討に基づいて明示される。
- [x] retry policy の定義と判定は中立な messaging 層にあり、background と offscreen の片側だけに重複実装されない。
- [x] retry 判断は Worker 内の DB 状態に依存しない。
- [x] 既存 payload と message type は変更されない。
- [x] 既存テストと本 PBI で追加するテストが、3 項目の BDD シナリオと受け入れ基準を満たす。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Offscreen transport 境界を通じて、再実行安全な変更処理が single retry で完了し、意図した変更が二重実行されないことを検証する。
- retry policy 未設定の新規経路で、タイムアウト後に同一メッセージが再送されないことを検証する。
- 再実行禁止として明示された変更処理が一回だけ送信されることを検証する。

### 統合テスト
- 中立 messaging 層の wire table と Offscreen transport を接続し、32 経路すべての policy 判定を検証する。
- `toggleStar` と archive の 6 経路で 1 回送信を維持し、set 意味論の mutate で single retry を維持することを検証する。
- retry policy 未設定時に、安全側へ収束することを検証する。
- retry policy を追加しても payload と message type が変わらないことを検証する。
- retry 判断が Worker 内の DB 状態を参照しないことを検証する。

### 単体テスト
- retry-safe、retry-unsafe、未設定の判定を境界値として検証する。
- retry-safe の変更処理で最大 2 回送信し、retry-unsafe と未設定で 1 回送信することを検証する。
- 既存の wire table と archive の retry policy が、既知の pin を維持することを検証する。
- `insert`、`insertBatch`、`insertAuditLog` の決定された分類が、明示的な policy として保持されることを検証する。

## 実装アプローチ
- Outside-In で、Offscreen transport の境界テストから失敗を確認してから実装する。
- retry policy を中立な messaging 層で定義し、wire table の各 operation から同じ判定結果を利用する。
- 全 32 経路を漏らさず分類し、既存 7 経路の再実行禁止契約と set 意味論の mutate の再試行を維持する。
- 新規 operation や分類漏れは retry 対象外とする fail-closed な既定を設ける。
- 指定された 2 つの論点を 5 Whys で決め、明示的な policy へ反映する。
- payload、message type、既存 service 再起動契約を維持する。
- Green 後に重複定義を整理し、既存テストとの整合性を確認する。

## 見積もり
2 SP

## 技術的考慮事項
- 依存関係: なし。後続の `pbi/2026-09-25-29-backlog-offscreen-gateway-archive-split.md` は、本 PBI 完了後に実施する。
- retry policy の情報源は中立な messaging 層の wire table とし、background と offscreen に別々の判定表を持たない。
- タイムアウトは応答却不確実であり、retry-safe でない mutate を再送すると副作用が重複する。
- `insertAuditLog` は現在 auto-retry のままで、同じ `(provider,url,created_at)` を抑制する重複制約もない。
- `insert` と `insertBatch` は、UNIQUE 制約による収束性と backend 差を確認してから retry-safe と判定してよいか決める。
- Offscreen listener は messaging と Web API だけを使い、Worker 内の DB 状態で retry 判定を補完しない。
- Manifest V3、async/await のみ、ESM import の `.js` 拡張子を必須とする。
- 挙動変更の切り戻しでは、retry-unsafe 経路の自動再試行を復活させない。

## 実装者向け注記

### 現状コードの確認
- `src/background/OffscreenTransportBase.ts:63-80` は、`noRetry` がない限り必ず 2 回 send する。
- `src/messaging/sqliteWireTable.ts` には query 4 件と mutate 6 件の 10 operation がある。
- `SQLITE_MAINTAIN_WIRE_TABLE` には 7 operation がある。
- `src/messaging/archiveWireTable.ts` には 14 operation がある。
- テーブル化されていない `getStatus()` を含み、対象は合計 32 経路である。
- 明示的な `noRetry` は `toggleStar` 1 件と archive 6 件の計 7 件で、残る 25 件が既定の single retry 対象である。
- production の write-entry call site は 9 ファイル、36 件ある。主な入口は `src/background/handlers/dashboardSqlite/deps.ts`、`src/background/alarmRegistry.ts`、`src/background/pendingSqliteQueue.ts`、`src/background/pipeline/steps/saveSqliteStep.ts` である。
- `src/offscreen/IdbVfsBackend.ts:336-340` に `insertAuditLog` の重複制約はない。
- `src/background/__tests__/sqliteClient-unit.test.ts:263-301` は、`toggleStar` の noRetry と set 意味論 mutate の retry 維持を固定する。
- `src/background/__tests__/sqliteClient-queue.test.ts:121-130` は、既定 2 回送信と noRetry 1 回送信を固定する。
- `src/messaging/__tests__/archiveWireTable.test.ts:38-41`、`src/messaging/__tests__/sqliteWireTable.test.ts`、`src/messaging/__tests__/sqliteMaintainWireTable.test.ts` も既存 pin である。

### 実装手順
1. 5 Whys により、insert 系、監査ログ、maintain 系、archive 維持系の retry safety を決める。
2. 32 経路と policy 未設定経路を網羅する失敗テストを追加する。
3. 中立 messaging 層に fail-closed な retry policy の定義と判定を追加する。
4. 既存 7 経路を retry-unsafe、set 意味論の mutate と判定した経路を retry-safe として明示する。
5. `getStatus()` を含む全 operation が一貫して policy を利用できるよう接続する。
6. payload、message type、Offscreen listener の利用範囲を変更せずに、既存 pin と新規テストを Green にする。
7. 32 経路の分類、重複、既定動作を回帰確認する。

### 落とし穴
- 既存 archive 6 経路と `toggleStar` の noRetry 契約を変更しない。
- `getStatus()` をテーブル対象から漏らさない。
- 未分類を retry 可能と解釈して fail-open にしない。
- `insertAuditLog` に一意性制約がないと、auto-retry は監査ログを二重化する。
- `SqliteError` の「read-only だけが retry」というコメントは DashboardGateway の話であり、OffscreenTransport の既定 retry の根拠にしない。
- 既存の 2 回送信という回数を、retry-safe 以外の経路へ広げない。

## 決定事項
- 5 Whys を通じて、`insert` と `insertBatch` を retry-safe と判定してよいかを、UNIQUE 制約の収束性と backend 差に基づいて決める。
- 5 Whys を通じて、`insertAuditLog` を retry-unsafe と明示してよいかを決める。
- 5 Whys を通じて、`withAtomicKeys` を含む maintain 系 7 operation にも同じ retry policy を適用するかを決める。

## Definition of Done
- [x] 32 経路すべての retry policy が中立 messaging 層で明示され、未設定経路は retry しない。
- [x] 3 本の BDD シナリオを自動テストとして実装し、すべて Green になる。
- [x] 既存 7 経路の noRetry と set 意味論 mutate の single retry を維持する。
- [x] `insert`、`insertBatch`、`insertAuditLog`、maintain 系の分類を 5 Whys の結論に従って実装する。
- [x] payload、message type、既存 service 再起動契約に変更がない。
- [x] retry 判断が Worker 内の DB 状態に依存しない。
- [x] 既存テスト、型検査、lint が成功する。
- [x] コードレビューで中立 messaging 層の責務と fail-closed 動作が確認される。

## 実施記録（コードレビュー後の裁定改訂）

レビューで `insert` 系を retry-safe とした初版裁定が撤回され、最終分類は **retry-safe 18 経路 / retry-unsafe 14 経路**になった。撤回根拠と最終判断は次のとおり。

- `SQLITE_INSERT`: OPFS / IDB は通常の INSERT のため、1 回目が反映済みで応答だけ失われると 2 回目は UNIQUE 制約違反で `success: false` を返す。fallback は重複時に `id: -1` を返し後続 UPDATE の対象行を失う。`created_at` が欠落していると codec が再生成し UNIQUE キー自体が変わりうる。backend 間で最終状態が一致しないため retry-unsafe。
- `SQLITE_INSERT_BATCH`: retry すると 2 回目は全件 duplicate 扱いで `inserted` / `count` が 0 になり、`legacyMigration` が `count < batch.length` を部分失敗と判定して `failed_permanently` になりうる。retry-unsafe。
- 回復は外側の `pendingSqliteQueue` と migration retry に委ねる。transport 層で「安全に再送できないものを再送する」재를 만들さない。
- 3 backend の response contract 統一（重複時に既存行 ID を返す、inserted と processed を分離）は本 PBI のスコープ外であり、別 PBI を起こす候補。

また retry policy を唯一の判定源にするため、archive descriptor の冗長な `noRetry` フラグと gateway の toggleStar hardcode を撤去した。`opts.noRetry` は低レベル transport の明示 override として残す（production の gateway からは渡されない）。
