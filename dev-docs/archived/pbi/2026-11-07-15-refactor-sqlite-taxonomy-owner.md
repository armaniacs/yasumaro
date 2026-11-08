# PBI 2026-11-07-15: sqlite taxonomy 単一所有者化

## メタ情報

- ラウンド: arch-delivery-loop
- 順位: 1/5
- RICE: 2.4 (R6 / I2 / C1.0 / E5)
- 依存: なし
- 種別: refactor
- 規模: M
- プライバシー: 履歴の外部送信なし、鍵復号の移動なし
- 振る舞い変更: なし

## ユーザーストーリー

保守担当者として、`sqliteOperationSecurity.ts` に dashboard sqlite の分類集合を集約してほしい。なぜなら subtype の分類が複数ファイルに分散していると、追加や削除のたびに安全ゲートの抜け漏れが起きるから。

## 背景

DASHBOARD_SQLITE の subtype 分類は、現在は複数の所有者に分散している。正本は `sqliteOperationSecurity.ts` にあるが、`MODAL_REQUIRED_SUBTYPES` は protocol 側に残り、手書きの分岐が background と offscreen に残っている。初手の診断では、分類の移動と固定テストを先に行い、行単位化はその後という順序が示された。以下は Read で確認済み。要確認なし。

- `src/messaging/validators.ts:398`: `DASHBOARD_SQLITE_SUBTYPE_SPECS` が subtype ごとの wire field 定義を持つ。
- `src/messaging/sqliteOperationSecurity.ts:79`: `ALL_DASHBOARD_SQLITE_SUBTYPES` が全 subtype の正本。
- `src/messaging/sqliteOperationSecurity.ts:116`: `DashboardSqliteSubtype` 型定義。
- `src/messaging/sqliteOperationSecurity.ts:123`: `READ_ONLY_OPS` 読み取り専用集合。
- `src/messaging/sqliteOperationSecurity.ts:141`: `TOKEN_EXEMPT_OPS` トークン免除の一覧。
- `src/messaging/sqliteOperationSecurity.ts:154`: `tokenExempt` 集合。
- `src/messaging/sqliteOperationSecurity.ts:159`: `TOKEN_REQUIRED_SUBTYPES` 派生集合。
- `src/messaging/sqliteOperationSecurity.ts:179`: `ARCHIVE_SCOPE_BY_SUBTYPE` スコープ束縛マップ。
- `src/messaging/dashboardSqliteProtocol.ts:17-18`: `DashboardSqliteSubtype` と `TOKEN_REQUIRED_SUBTYPES` の再出力。
- `src/messaging/dashboardSqliteProtocol.ts:100`: `MODAL_REQUIRED_SUBTYPES` が protocol 側に残存。
- `src/messaging/sqliteWireTable.ts:1-100`: `SqliteDashboardHop` 行定義と、readOnly と import は手書きのままという注記。
- `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:147`: 読み取り経路の手書き分岐の末尾。
- `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts:233`: 保守バッチ経路の手書き分岐の末尾。
- `src/offscreen/sqliteMessageHandlers.ts:81`: `SQLITE_REPO_RUNNERS` が層固有の前処理を持つ。

目標は次である。`sqliteOperationSecurity.ts` が全分類集合を所有する。`MODAL_REQUIRED_SUBTYPES` と `ARCHIVE_SCOPE_BY_SUBTYPE` を残りの集合の隣へ移し、protocol 側の再出力はバイト同一に保つ。手書きの readOnly と import の方針は `SqliteDashboardHop` の行にするか、免除を一か所に固定するか、いずれかで重複をなくす。振る舞い変更はしない。初手は分類の移動と固定テストである。

## BDD受け入れシナリオ

```gherkin
Scenario: 分類の所有者が単一になる
  Given subtype の分類集合が複数ファイルに分散している
  When 保守担当者が sqliteOperationSecurity.ts を正本として参照する
  Then MODAL_REQUIRED_SUBTYPES と ARCHIVE_SCOPE_BY_SUBTYPE を含む全集合が同ファイルで定義される
  And dashboardSqliteProtocol.ts からの再出力はバイト同一である
```

```gherkin
Scenario: 新 subtype 追加時に分類漏れが検出される
  Given ALL_DASHBOARD_SQLITE_SUBTYPES に新しい subtype が追加された
  When 固定テストが全集合の分類 universe を検証する
  Then 未分類の subtype がある場合はテストが失敗する
  And 既存の wire-table 同期 assert と同じ方式で失敗箇所が分かる
```

```gherkin
Scenario: 手書き方針の重複がなくなる
  Given readOnly と import の方針が手書き分岐に残っている
  When 実装が SqliteDashboardHop の行に寄せられるか免除が一か所に固定される
  Then 同じ subtype の判定が二か所で食い違うことがない
  And 読み取り専用と書込みの境界は従来と同一である
```

## 受け入れ基準

- [x] `MODAL_REQUIRED_SUBTYPES` の定義が `sqliteOperationSecurity.ts` にあり、`dashboardSqliteProtocol.ts` は再出力のみである
- [x] `ARCHIVE_SCOPE_BY_SUBTYPE` が他の分類集合の隣に配置され、意味と値が変わらない
- [x] protocol 側の再出力の公開 API がバイト同一であり、利用側の import 変更が不要である
- [x] 全集合が同一の subtype universe を分類することを主張する固定テストが一つ追加される
- [x] readOnly と import の方針重複が解消される。行化か一か所固定かのいずれかである
- [x] 振る舞い変更がなく、既存の関連テストがすべて通る

## テスト戦略

t_wada 式の Outside-In で進める。E2E は追加しない。統合は既存の dashboard sqlite 経路に任せ、単体テストの固定で分類の一致を守る。

### 単体テスト

- 場所: `src/**/__tests__/` 配下。新規は `src/messaging/__tests__/` を推奨する。
- 内容: 全分類集合 (`ALL_DASHBOARD_SQLITE_SUBTYPES`, `READ_ONLY_OPS`, `TOKEN_EXEMPT_OPS` / `tokenExempt`, `TOKEN_REQUIRED_SUBTYPES`, `MODAL_REQUIRED_SUBTYPES`, `ARCHIVE_SCOPE_BY_SUBTYPE`, `DASHBOARD_SQLITE_SUBTYPE_SPECS` のキー集合) が同一 universe を分類することを検証する。
- 方式: 既存の `wireOpEnumerationDerived.test.ts` と `archiveOpEnumerationDerived.test.ts` の同期 assert を手本にする。具体的な subtype 名や件数を断定せず、集合間の差分が空であることを検証する。
- 追加: `TOKEN_EXEMPT_OPS` の各要素が `READ_ONLY_OPS` に含まれること、`TOKEN_REQUIRED_SUBTYPES` が免除集合の補集合であることを検証する。

### 禁止事項

- `dev-docs/TEST_RULE.md` に従う。固定時間待ち (`setTimeout` による待機、`waitForTimeout`、`sleep`) を使わない。`retry` や `retries` の引き上げでごまかさない。
- 非同期の完了は Promise や条件待ちで待ち、時計が必要なら注入可能な時計を使う。

### 実行

```bash
npm run type-check
npm run test -- src/messaging/__tests__/sqlite-taxonomy-pin.test.ts
```

## 実装者向け注記

### 現状コードの確認

着手前に必ず実行すること。

```bash
grep -rn "MODAL_REQUIRED_SUBTYPES" src/
grep -rn "ARCHIVE_SCOPE_BY_SUBTYPE" src/
grep -rn "READ_ONLY_OPS\|TOKEN_EXEMPT_OPS\|TOKEN_REQUIRED_SUBTYPES" src/
```

### 実装手順

1. `src/messaging/__tests__/` に固定テストを先に書く。Red を確認する。
2. `MODAL_REQUIRED_SUBTYPES` の定義本体を `sqliteOperationSecurity.ts` へ移す。`dashboardSqliteProtocol.ts` には再出力だけ残す。
3. `ARCHIVE_SCOPE_BY_SUBTYPE` が他の集合と離れている場合は隣へ寄せる。値と注釈は変えない。
4. 型の再出力 (`DashboardSqliteSubtype`, `TOKEN_REQUIRED_SUBTYPES`) がバイト同一であることを差分で確認する。
5. readOnly と import の重複は、行化か一か所固定かの小さい方を選ぶ。大きい方の行化は別 PBI に分割する。

### 落とし穴

- protocol 側に定義を残したまま複製しない。正本は一つにする。
- テストに subtype 名の一覧を直書きしない。追加時に自動で追従する形にする。
- 手書き分岐の整理で判定条件を変えない。この PBI は移動と固定だけである。

## 見積もり

5SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす
- [x] コードレビュー完了
- [x] リファクタリング完了
- [x] ドキュメント更新済み
