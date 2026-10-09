# OpfsWorkerBackend の null-fold 2 行パターン ×17 の共通化（refactor）

## 1. タイトル + 種別

- **タイトル**: `OpfsWorkerBackend` 内に手書きされている「worker 応答 `null` → `OPFS_WORKER_UNAVAILABLE_ERROR`、非 null → `{ success: true, ... }`」の 2 行畳み込み（非アーカイブ 17 メソッド）を `private async callWorkerOk<T>(type, payload, project)` 1 本に統合する
- **種別**: refactor（挙動不変・重複削減のみ）
- **見積もり**: 1.5 SP

## 2. 優先度

- **優先度**: 順位 11
- **RICE**: R4 / I1 / C1.0 / E1.5 → **2.7**
- **根拠**:
  - アーカイブ 14 op は既に `proxyArchive`（:100-107）に畳まれており、非アーカイブ 17 メソッドの同形の 2 行畳み込みだけが未統一の残骸として 17 か所に手維持されている。エラー文言は定数共通化済みだが、畳み込み構造自体が 17 か所で手書きのまま
  - 失敗カウンタというガードは `callWorker`（:62-71）に一元済みのため、畳み込みのヘルパー化は挙動を変えない。Confidence 1.0（機械的な統合）だが Impact は小（重複削減・規範化のみ、外部挙動不変）のため順位は下位に配置
- **依存**: **なし**

## 3. ユーザーストーリー

**OPFS バックエンド実装の保守担当者として**、17 メソッドに手書きされている null-fold の 2 行畳み込みが 1 つの `callWorkerOk` に集約されていてほしい。なぜなら、畳み込み構造が 17 か所で手維持されていると、アーカイブ側の `proxyArchive` との構造ドリフトが黙って通過するから。

## 4. 背景

「worker 応答 `null` → `OPFS_WORKER_UNAVAILABLE_ERROR`、非 null → `{ success: true, ... }`」の 2 行畳み込みが非アーカイブ 17 メソッドに手書きされている。アーカイブ 14 op は既に `proxyArchive`（:100-107）に畳まれており、残りが同形の未統一残骸。失敗カウンタというガードは `callWorker`（:62-71）に一元済みのため、畳み込みのヘルパー化は挙動を変えない。

該当箇所（17 箇所・全 file:line 検証済み）:

- `src/offscreen/OpfsWorkerBackend.ts:111`（insert）
- `src/offscreen/OpfsWorkerBackend.ts:117`（insertBatch）
- `src/offscreen/OpfsWorkerBackend.ts:130`（query）
- `src/offscreen/OpfsWorkerBackend.ts:136`（update）
- `src/offscreen/OpfsWorkerBackend.ts:142`（delete）
- `src/offscreen/OpfsWorkerBackend.ts:148`（toggleStar）
- `src/offscreen/OpfsWorkerBackend.ts:154`（purgeOldRecords）
- `src/offscreen/OpfsWorkerBackend.ts:161`（purgeContent）
- `src/offscreen/OpfsWorkerBackend.ts:166`（purgeAuditLog）
- `src/offscreen/OpfsWorkerBackend.ts:172`（getFtsIndexSize）
- `src/offscreen/OpfsWorkerBackend.ts:178`（backupDb）
- `src/offscreen/OpfsWorkerBackend.ts:252`（getStatus）
- `src/offscreen/OpfsWorkerBackend.ts:258`（insertAuditLog）
- `src/offscreen/OpfsWorkerBackend.ts:264`（queryAuditLog）
- `src/offscreen/OpfsWorkerBackend.ts:272`（serialize）
- `src/offscreen/OpfsWorkerBackend.ts:278`（getCount）
- `src/offscreen/OpfsWorkerBackend.ts:284`（clearAll）

既存の構造単位: `proxyArchive` は :100-107、`restoreDb`/`healthCheck` は :238-248。

改善案: `private async callWorkerOk<T>(type, payload, project)` を 1 本追加する（null → 既存定数 `OPFS_WORKER_UNAVAILABLE_ERROR`、非 null → `project`）。guard は既存 `callWorker` にそのまま置かれる。`restoreDb`/`healthCheck`（:238-248）のみ null と false を区別せず独自文言（`Binary restore failed` / `Health check failed`）を返すため、現行文言を保持するならこの 2 つは対象外にする。挙動不変。

## 5. BDD シナリオ

### シナリオ 1: null-fold が 1 本のヘルパーに統一される

```gherkin
Given OpfsWorkerBackend.ts に callWorkerOk(type, payload, project) が 1 本追加されている
When 非アーカイブ 17 メソッドの null-fold 構造を確認する
Then 17 メソッドすべてが callWorkerOk 呼び出しに置き換えられていること
And if (result === null) return { success: false, error: OPFS_WORKER_UNAVAILABLE_ERROR } の 2 行畳み込みがメソッド内に手書きで残っていないこと
```

### シナリオ 2: null 応答経路の pin が現行どおり維持される

```gherkin
Given opfsWorkerBackend-degradation.test.ts の proxyMethods テーブル（19 メソッド）が存在する
When worker 応答が null の状態で 17 メソッドのいずれかを呼び出す
Then { success: false, error: 'OPFS Worker unavailable' } で解決されること
And 既存の pin テーブルは無変更で green であること
```

### シナリオ 3: 成功時の応答構成が現行どおりである

```gherkin
Given worker が非 null の応答を返す
When 17 メソッドのいずれかを呼び出す
Then project によるフィールド射影が現行どおりであること（例: insert は { success: true, id }、serialize は { success: true, data }、update は { success: true }）
And getStatus は応答をそのまま返す現行構成を維持すること
```

### シナリオ 4: restoreDb / healthCheck は対象外で文言が現行どおりである

```gherkin
Given worker 応答が null の状態で restoreDb と healthCheck を呼び出す
Then restoreDb は { success: false, error: 'Binary restore failed' } で解決されること
And healthCheck は { success: false, error: 'Health check failed' } で解決されること
And この 2 メソッドは callWorkerOk への置き換え対象に含まれていないこと
```

### シナリオ 5: 失敗カウンタのガード挙動が不変である

```gherkin
Given 失敗カウンタと degrade 信号は callWorker に一元されている
When null 応答が連続して閾値に達する
Then onDegraded が 1 回だけ呼ばれる現行挙動が維持されること
```

## 6. 受け入れ基準

- [x] `src/offscreen/OpfsWorkerBackend.ts` に `private async callWorkerOk<T>(type, payload, project)` が 1 本追加されている
- [x] 非アーカイブ 17 メソッド（:111, 117, 130, 136, 142, 148, 154, 161, 166, 172, 178, 252, 258, 264, 272, 278, 284）の 2 行畳み込みが `callWorkerOk` 呼び出しに置き換えられ、同形の畳み込みがメソッド内に残っていない
- [x] null → 既存定数 `OPFS_WORKER_UNAVAILABLE_ERROR`、非 null → `project` の構成が現行どおりで、外部挙動は不変である
- [x] guard（失敗カウンタ・degrade 信号）は既存 `callWorker` にそのまま置かれ、移動・変更されていない
- [x] `restoreDb`/`healthCheck`（:238-248）は対象外で、独自文言（`Binary restore failed` / `Health check failed`）が現行どおり維持される
- [x] `proxyArchive`（:100-107）とアーカイブ 14 op は無変更である
- [x] 既存バックエンドテスト（`opfsWorkerBackend-degradation.test.ts` ほか）が無変更で green である

## 7. テスト戦略

1. **null 応答経路の pin 先行**: 着手前に `src/offscreen/__tests__/opfsWorkerBackend-degradation.test.ts` の pin（`proxyMethods` テーブル 19 メソッドの `it.each` が `{ success: false, error: OPFS_WORKER_UNAVAILABLE_ERROR }` を pin、:174-203）を確認し、統合中も無変更で失敗しないことを安全網として使う。同ファイルの restore/health reasons 分離 pin（:207-218）と連続失敗カウンタ pin（describe `consecutive-failure counter`）も無変更の安全網とする
2. **既存バックエンドテストの green 維持**: `opfsWorkerBackend-degradation.test.ts`、`opfsDegradation.integration.test.ts`、`auditLogPurgeSeam.test.ts`、`queryDispatchRegression.test.ts`、`backendResolver-coverage.test.ts` を無変更で通過させる。テスト側の pin 部分は変更しない
3. **外部挙動のリグレッション観点**: null 応答（共通定数）・非 null 応答（project 射影・getStatus の素通し構成含む）・restoreDb/healthCheck の独自文言・degrade 信号の 1 回呼び出しの各経路が現行どおりであることを pin で確認する
4. **validate green**: `npm run validate`（type-check + test）で全テスト通過を確認する

## 8. 見積もり

**1.5 SP** — 機械的な統合（ヘルパー 1 本追加 + 17 メソッドの置き換え）のみでロジック変更なし。`restoreDb`/`healthCheck` の対象外判断と pin テーブルとの照合が含まれるため 1 SP ではなく 1.5 SP。影響範囲は `src/offscreen/OpfsWorkerBackend.ts` 1 ファイル。

## 9. DoD

- [x] 受け入れ基準 7 件すべて充足
- [x] `npm run validate`（type-check + test）が green
- [x] `opfsWorkerBackend-degradation.test.ts` の pin（proxyMethods テーブル・restore/health 分離・連続失敗カウンタ）が無変更で通過
- [x] `OpfsWorkerBackend.ts` 内に手書きの null-fold 2 行畳み込みが非アーカイブメソッドに残っていない
- [x] 既存機能への影響ゼロ（外部挙動不変）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 11（R4 / I1 / C1.0 / E1.5 → 2.7）
- 依存: なし
