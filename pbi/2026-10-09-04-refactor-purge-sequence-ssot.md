# PBI: purge トランザクションスケルトン 4 重実装の共通化（refactor）

- 種別: refactor
- 優先度: 順位4（holistic-1009 ラウンド NN04）
- RICE: R4 × I2 × C1.0 / E2 = **4.0**
- 見積もり: 2 SP

## 根拠

- 順位4は NN05（IdbVfsBackend scalar ヘルパー）と同点 4.0。tie-break は NN04 先行: purge 統合が `runPurgeSequence` 内に scalar 読みを吸収するため、NN05 の対象範囲が縮小する（台帳「同点の順位根拠」参照）。
- I2（大きい）の理由: IDB ラングと OPFS ラングでデータ挙動が分岐する silent drift の温床であり、過去に skip-undefined drift という同型バグが実在した。
- C1.0: 重複の存在と移設先（queryPlan.ts、両バックエンドが既に import する共有層）はコードで確定。設計判断は残っていない。
- E2（M）: 4コピー＋簡略版ツイン1組の縮約と、先行する parity pin テストの作成を含む。

## 依存

- NN05（[2026-10-09-05-refactor-idb-scalar-read-helper.md](2026-10-09-05-refactor-idb-scalar-read-helper.md)）がこの PBI の着地後に同じファイル `src/offscreen/IdbVfsBackend.ts` を触る。**NN04 → NN05 の順で実施すること**（編集競合回避。台帳「依存マップ」参照）。

## ユーザーストーリー

保守担当者として、purge シーケンスの changes() 計数規則とトランザクションポリシーが 1 か所（1 つの関数）に存在してほしい。そうすれば、片方のラングだけが静かにズレるバグを、共通関数を 1 箇所直すだけで構造的に排除できる。

## 背景

「delete-old（retentionDays>0 でゲート）→ `SELECT changes()` → COUNT → maxRecords 超過分の excess delete → `SELECT changes()`」という実行シーケンスが、バックエンド2種 × op2種の4箇所に構造的に同一の本体（各 ~35行）として並ぶ:

- `src/offscreen/IdbVfsBackend.ts:217-251`（purgeOldRecords）
- `src/offscreen/IdbVfsBackend.ts:253-286`（purgeContent）
- `src/offscreen/opfsWorker/purgeHandlers.ts:41-76`（handlePurgeOldRecords）
- `src/offscreen/opfsWorker/purgeHandlers.ts:78-109`（handleContentPurge）

同型の簡略版ツイン（retention のみ・skip ガード前方配置）も並行して存在する:

- `src/offscreen/IdbVfsBackend.ts:288-302`（purgeAuditLog）／`src/offscreen/opfsWorker/purgeHandlers.ts:111-127`（handleAuditLogPurge）

ヘッダコメントは「mirroring IdbVfsBackend…」とミラーを宣言するのみで、機械的な同一性保証はない。既存の parity テスト（sqliteHandlers-twins-parity.test.ts）はメッセージハンドラ層（dbMaintenance モック経由）を pin するもので、**バックエンド層の4コピーは pin されていない**。片方だけカウント規則・スキップガード・トランザクション有無がズレると、IDB ラングと OPFS ラングでデータ挙動が分岐する。

## 改善案

`queryPlan.ts`（両バックエンドが既に import する共有層。`src/offscreen/IdbVfsBackend.ts:21`、`src/offscreen/opfsWorker/purgeHandlers.ts:33`）に、statements + executor seam（exec / count / changes を取るオブジェクト）を受け取る `runPurgeSequence` を 1 本置く。

- changes() 計数規則とトランザクションポリシーのコメントはその関数へ移り、4コピーは statements 構築＋呼び出し1行に縮む。
- 挙動不変。既存の retention/maxRecords ゲートとガードは移設先で同一保持する。

## BDD シナリオ

### シナリオ1: 4実装が同一入力で同一結果を返す（parity pin・リファクタ前）

```gherkin
Given retentionDays=30, maxRecords=100 の同一入力と、exec / count / changes の呼び出しを記録する executor モックを用意する
When IdbVfsBackend.purgeOldRecords と opfsWorker.handlePurgeOldRecords に同一入力を与えて実行する
Then 両者とも同一の SQL 実行シーケンス（delete-old → SELECT changes() → COUNT → excess delete → SELECT changes()）を記録し、同一の purged 値を返す
```

### シナリオ2: リファクタ後も挙動不変である（golden）

```gherkin
Given 現行実装でシナリオ1相当を pin した golden テストが green である
When runPurgeSequence への共通化リファクタを適用する
Then golden テストと既存 sqliteHandlers-twins-parity.test.ts が全て green のまま保たれる
```

### シナリオ3: skip ガードの分岐が同一保持される

```gherkin
Given retentionDays が undefined または 0 以下である
When purgeOldRecords 系 op を実行する
Then retention delete とその SELECT changes() は実行されず、COUNT 以降の maxRecords 系処理のみが走る（現行挙動と同一）
And purgeAuditLog / handleAuditLogPurge ではトランザクションを開始せず purged=0 を返す（現行挙動と同一）
```

## 受け入れ基準

- [ ] `queryPlan.ts` に executor seam（exec / count / changes を取るオブジェクト）を受け取る `runPurgeSequence` が 1 本置かれている
- [ ] `IdbVfsBackend.ts:217-251`（purgeOldRecords）と `IdbVfsBackend.ts:253-286`（purgeContent）が statements 構築＋呼び出し 1 行に縮約されている
- [ ] `opfsWorker/purgeHandlers.ts:41-76`（handlePurgeOldRecords）と `opfsWorker/purgeHandlers.ts:78-109`（handleContentPurge）が同様に縮約されている
- [ ] changes() 計数規則とトランザクションポリシーのコメント（skip ガード契約を含む）が `runPurgeSequence` へ移設されている
- [ ] retention/maxRecords のゲート条件（retentionDays>0、maxRecords>0、count>maxRecords）と skip ガードが移設先で同一保持されている
- [ ] 簡略版ツイン（purgeAuditLog / handleAuditLogPurge）を共通化の対象に含めるかを判断し、含めない場合はその理由が残されている
- [ ] 挙動不変であることを parity/golden テストが示している

## テスト戦略

**parity pin 先行**: リファクタに先立ち、4実装が同一入力で同一結果（同一実行シーケンス・同一 purged 値）となることを pin する parity/golden テストを書く。バックエンド層の4コピーは現状 pin されていないため、この pin テストがリファクタ中のリグレッション防波堤になる。リファクタ後は既存の sqliteHandlers-twins-parity.test.ts（メッセージハンドラ層）の追従確認も行う。

## DoD

- [ ] parity/golden テストがリファクタ前に green、リファクタ後も green である
- [ ] `npm run validate`（type-check + test）が green
- [ ] `IdbVfsBackend.ts` と `opfsWorker/purgeHandlers.ts` から重複したトランザクションスケルトン本体が除去されている
- [ ] IdbVfsBackend ラングと OPFS ラングの差分挙動（カウント規則・skip ガード・トランザクション有無）がテストで検出可能になっている

## 出所

holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）。NN04。
