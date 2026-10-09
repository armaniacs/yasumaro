# アーカイブ payload 検査の二重実装と厳格さ drift の解消

**種別**: fix

## 優先度

- **順位**: 1（holistic-1009 / NN01）
- **RICE**: 6.0（R4・I3・C1.0・E2）
  - R4: archive 系 messaging は四半期に複数回の保守関与がある
  - I3: 実害解消 — untrusted 入力の拒否ゲートが silent に弱まり得る
  - C1.0: コードで確定（file:line 実読検証済み）
  - E2: M（2 SP）
- **根拠**: 実害級の境界チェック drift。同一リクエストを通る 2 つの手書き検査の間で、archive_export の length 上限欠落と archive_query の定数参照漏れ（生リテラル）が既に発生している。parity pin が無いため、片方だけ緩むと untrusted 入力の拒否ゲートが silent に弱まる。
- **依存**: なし（W1 バッチ・並列可）

## ユーザーストーリー

> 保守担当者として、アーカイブ系 5 subtype の payload 検査が validators.ts と同じ共有チェックヘルパーから構成され、数値上限がレジストリ定数から参照されることを望む。なぜなら、envelope ゲートと handler ゲートが独立した手書き検査のままだと、片方だけ緩めた変更が silent に取り込まれ、拒否ゲートが弱まったまま気付けないからである。

## 背景

同一リクエストが 2 つの手書き検査を通る。

1. **SW 側 envelope ゲート**: `src/messaging/validators.ts` の `DASHBOARD_SQLITE_SUBTYPE_SPECS`（MessageRouter 実行）
2. **handler 側 deps ゲート**: `src/messaging/archiveWireTable.ts` の validate ラムダ（`runTableDriven` 経由）

5 つの archive subtype（preview / create / export / query / update）で同じ型/境界チェックが 2 実装されており、厳格さが既にズレている。

- **archive_export の length 上限（8MB）** はバリデータ側のみにあり、wire table 側には存在しない（`validators.ts:366-376` vs `archiveWireTable.ts:210-218`）
- **archive_query の 500** はバリデータ側がレジストリ定数 `src/utils/limits.ts:147`（`MAX_ARCHIVE_QUERY_LIMIT`）を参照するが、wire table 側は生リテラル（`archiveWireTable.ts:373`）

両者を pin する parity テストは存在しない。

根因（台帳 5 Whys より）: validators と wire table が別ラウンドで別々に作られ、共有チェックの抽出と parity pin が実施されなかったため。

### 該当箇所

| ファイル | 箇所 | 内容 |
|---|---|---|
| `src/messaging/validators.ts` | :283-301 | cutoffPairGuard |
| `src/messaging/validators.ts` | :359 | archive_preview |
| `src/messaging/validators.ts` | :360-365 | archive_create |
| `src/messaging/validators.ts` | :366-376 | archive_export |
| `src/messaging/validators.ts` | :383-395 | archive_query |
| `src/messaging/validators.ts` | :396-402 | archive_update |
| `src/messaging/archiveWireTable.ts` | :119-127 | preview |
| `src/messaging/archiveWireTable.ts` | :152-160 | create |
| `src/messaging/archiveWireTable.ts` | :210-218 | export（上限なし） |
| `src/messaging/archiveWireTable.ts` | :371-380 | query（:373 でリテラル 500） |
| `src/messaging/archiveWireTable.ts` | :407-415 | update |

### 改善案

- wire table の validate を validators.ts と同じ共有チェックヘルパー（中立モジュールの `nonNegativeInteger` 等）から構成し、上限はレジストリ定数参照に統一する。
- untrusted 入力の拒否ゲート自体は validators.ts に残す（envelope ゲートの移設・削除はしない）。
- spec 行と wire 行の同一フィールド比較の parity テスト 1 本で drift を機械検出可能にする。
- 挙動不変。既存の fail-closed ガードは移設先で保持する。

## BDD シナリオ

```gherkin
Scenario: spec 行と wire 行の同一フィールド検査が一致する
  Given アーカイブ系 5 subtype（preview / create / export / query / update）の spec 行と wire 行が存在する
  When spec 行と wire 行の同一フィールド（型・数値境界・length 上限）を parity テストで比較する
  Then 全 subtype・全フィールドの一致が宣言され、差分があればテストが失敗する

Scenario: archive_export の length 上限が両ゲートで強制される
  Given archive_export の length 上限が 8MB として両ゲートに定義されている
  When 8MB を超える payload を持つ DASHBOARD_SQLITE 要求を送信する
  Then envelope ゲート（validators.ts）と handler ゲート（archiveWireTable.ts）の双方が要求を拒否する

Scenario: archive_query の上限がレジストリ定数から参照される
  Given archive_query の limit 上限が MAX_ARCHIVE_QUERY_LIMIT（src/utils/limits.ts）で定義されている
  When バリデータ側と wire table 側の双方の limit 境界を確認する
  Then 両者ともレジストリ定数を参照し、生リテラル 500 は残らない

Scenario: 片方だけ緩めた変更は silent に取り込まれない
  Given spec 行と wire 行を比較する parity テストが存在する
  When 片方のゲートのみ上限を緩める（または削除する）変更を加える
  Then parity テストが失敗し、drift が機械検出される

Scenario: リファクタ前後で許可/拒否の挙動は不変
  Given golden pin テストが 5 subtype の許可/拒否挙動を固定している
  When wire table の validate を共有チェックヘルパーから構成し直す
  Then 全 subtype の許可/拒否結果は変更前と同一であり、fail-closed ガードは移設先で保持される
```

## 受け入れ基準

- [ ] wire table（`archiveWireTable.ts`）の validate ラムダが、validators.ts と同じ共有チェックヘルパー（中立モジュールの `nonNegativeInteger` 等）から構成されている
- [ ] 数値上限はレジストリ定数参照に統一され、`archiveWireTable.ts:373` の生リテラル 500 が撤去されている
- [ ] archive_export の length 上限（8MB）が wire table 側でも強制されるか、parity テストにより両ゲートの一致が宣言されている
- [ ] untrusted 入力の拒否ゲート自体は validators.ts に残っている（envelope ゲートの移設・削除をしていない）
- [ ] 既存の fail-closed ガードが移設先で保持され、全 subtype の許可/拒否挙動が変更前と同一である
- [ ] spec 行と wire 行の同一フィールド比較の parity テストが 1 本追加され、drift が機械検出可能になっている
- [ ] 既存のハンドラテストが追従更新のみで通っている（検査の緩和を伴わない）

## テスト戦略

1. **golden pin を先に書く**: リファクタ前に、5 subtype × 境界値（正常・下限違反・上限違反）の許可/拒否挙動を固定するテストを追加し、現行挙動を pin する。
2. **parity pin を先に書く**: spec 行（`DASHBOARD_SQLITE_SUBTYPE_SPECS`）と wire 行（validate ラムダ）の同一フィールド比較テストを 1 本追加する。現状は drift があるため、archive_export の上限欠落と archive_query のリテラル 500 が赤として可視化される。
3. **リファクタで緑化**: 共有チェックヘルパーから wire table の validate を構成し、上限をレジストリ定数参照に統一する。golden pin との差分は、意図した修正（wire 側への export 上限追加・定数参照統一）のみであることを 1 件ずつ確認し、該当箇所の pin だけを明示更新する。
4. **既存ハンドラテストの追従**: 既存テストは追従更新のみとし、検査の緩和（期待値の緩め変更・拒否アサーションの削除）はしない。

固定時間待ちは使用しない（AGENTS.md の Async / Timing Failures ルール）。待ちが要る場合は完了シグナルの await または `waitForMock()` を使う。

## 見積もり

2 SP（M サイズ）

## DoD

- [ ] 受け入れ基準の全項目が完了している
- [ ] golden pin + parity テストが追加され、drift が機械検出可能になっている
- [ ] `npm run build` が成功している（コード変更後はテスト前に build）
- [ ] `npm run validate`（type-check + test）が green
- [ ] 検査の緩和（上限の撤廃・fail-closed ガードの削除・テスト期待値の緩め変更）が行われていない
- [ ] 変更対象は `src/messaging/validators.ts`・`src/messaging/archiveWireTable.ts`・共有チェックヘルパー（中立モジュール）・テストファイルに留まっている
- [ ] コード変更後に `graphify update .` を実行済み（AST-only・API コストなし）

## 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md) / NN01 / W1 バッチ・依存なし・並列可）
- 全 file:line は統合側による実読検証済み
