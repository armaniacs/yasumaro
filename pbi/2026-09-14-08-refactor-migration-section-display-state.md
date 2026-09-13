# PBI: renderMigrationSectionの表示優先順位ロジックをderiveMigrationStatus側に統合

## ユーザーストーリー
拡張機能の開発者として、`renderMigrationSection`に残っている状態→ラベルの優先順位判定ロジックを`deriveMigrationStatus`側の判別可能ユニオン（`displayState`）に統合したい、なぜなら現在この優先順位はレンダー関数側に残っており「DOM組み立てのみの薄い関数」という設計意図が未達成であり、優先順位を変更する際にjsdom前提のテストを書かない限り壊れても気づけないため。

## 優先度
- 順位: 04 / 4（最後に着手）
- RICEスコア: 1.6（Reach=開発者(月数回の変更頻度) × Impact=1 × Confidence=80% / Effort=1人日）
- 根拠: adversarial-code-reviewで裏取り済み。視覚的差分ゼロを保ちながらのリファクタで他候補より実装コストが高い。

## 依存関係（重要）

**PBI 07（`legacyStillPresent` 追加）の後に着手すること。** 両PBIとも `MigrationOpfsStatus` / `MigrationIdbStatus`（`diagnosticsPanel.ts:244-260`）を変更するため、同時並行で進めるとコンフリクトする。PBI 07 が `legacyStillPresent` を追加した後、このPBIで `displayState` を追加する順序なら衝突しない。

もし PBI 07 が未着手のまま本PBIから着手する場合は、`legacyStillPresent` の存在を前提にしない形で実装し、PBI 07 側でマージ調整すること。

---

## 実装ガイド（調査済み・そのまま着手可）

### 現状のコード（`src/dashboard/panels/diagnostic/diagnosticsPanel.ts:367-368`）

```typescript
  const opfsValue = opfs.done ? doneSuffix : (opfs.notApplicable ? notApplicableSuffix : (opfs.checking ? checkingSuffix : pendingSuffix));
  const idbValue = idb.done ? doneSuffix : (idb.notApplicable ? notApplicableSuffix : pendingSuffix);
```

`deriveMigrationStatus` が返す `done` / `notApplicable` / `checking` という**独立した3つのbool**から、レンダー側が「どれを優先して表示するか」を再導出している。この優先順位（done > notApplicable > checking > pending）がレンダー関数にしか存在しない。

### 変更方針

`deriveMigrationStatus` 側で表示状態を一意に決定し、レンダー側はマッピングするだけにする。

1. 判別可能ユニオン型を定義（`MigrationOpfsStatus` の定義の手前、`diagnosticsPanel.ts:242`付近）:

```typescript
/**
 * 移行状態の表示区分 — 優先順位（done > notApplicable > checking > pending）を
 * deriveMigrationStatus 側で一度だけ解決した結果。レンダー側はこれをラベルに
 * マッピングするだけで、優先順位を再導出しない。
 *
 * IDB 側に 'checking' は存在しない: OPFS は LAST_ATTEMPTED_AT / RECORD_COUNT で
 * 「移行ルーチンがまだ走っていない」を検出できるが、IDB 側には対応する計測
 * フィールドがないため（sqliteStatus.ts の extras 参照）。
 */
export type MigrationDisplayState = 'done' | 'notApplicable' | 'checking' | 'pending';
```

2. 各 Status 型に追加:

```typescript
export interface MigrationOpfsStatus {
  done: boolean;
  notApplicable: boolean;
  checking: boolean;
  warn: boolean;
  displayState: MigrationDisplayState;   // ← 追加
  // ... 既存フィールド
}

export interface MigrationIdbStatus {
  done: boolean;
  notApplicable: boolean;
  warn: boolean;
  /** IDB 側は 'checking' を取らない（上記コメント参照）。 */
  displayState: Exclude<MigrationDisplayState, 'checking'>;   // ← 追加
  legacyName: string | null | undefined;
}
```

既存の `done` / `notApplicable` / `checking` / `warn` は**残すこと**。`warn` はレンダー側で `makeStatRow` の第3引数（警告フラグ）に使われており（369-370行目）、`displayState` とは別の軸。既存テスト10件もこれらを参照している。

3. `deriveMigrationStatus` 内で算出（`return` の直前）:

```typescript
  const opfsDisplayState: MigrationDisplayState =
    opfsDone ? 'done'
    : opfsNotApplicable ? 'notApplicable'
    : opfsChecking ? 'checking'
    : 'pending';
  const idbDisplayState: Exclude<MigrationDisplayState, 'checking'> =
    idbDone ? 'done'
    : idbNotApplicable ? 'notApplicable'
    : 'pending';
```

現状のレンダー側の三項演算子と**まったく同じ優先順位**にすること（視覚的差分ゼロが制約）。

4. 戻り値の `opfs` / `idb` にそれぞれ `displayState` を含める

5. `renderMigrationSection` の 367-368行目を置き換え:

```typescript
  const suffixByState: Record<MigrationDisplayState, string> = {
    done: doneSuffix,
    notApplicable: notApplicableSuffix,
    checking: checkingSuffix,
    pending: pendingSuffix,
  };
  const opfsValue = suffixByState[opfs.displayState];
  const idbValue = suffixByState[idb.displayState];
```

`doneSuffix` 等の定義（352-355行目）はそのまま使える。

### 追加すべきテスト

`src/dashboard/panels/diagnostic/__tests__/deriveMigrationStatus.test.ts` に追加。既存の `sqlite()` ヘルパーが使える:

```typescript
  it('resolves opfs displayState to done when the migration flag is set', () => {
    expect(deriveMigrationStatus(sqlite()).opfs.displayState).toBe('done');
  });

  it('resolves opfs displayState to notApplicable when not done and no legacy DB exists', () => {
    const status = deriveMigrationStatus(sqlite({ opfsMigrationV2Done: false, opfsLegacyDbPath: null }));
    expect(status.opfs.displayState).toBe('notApplicable');
  });

  it('resolves opfs displayState to checking when not done, legacy DB unconfirmed, and never attempted', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: false,
      opfsMigrationV2LastAttemptedAt: null,
    }));
    expect(status.opfs.displayState).toBe('checking');
  });

  it('resolves opfs displayState to pending when the migration was attempted but did not finish', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: false,
      opfsMigrationV2LastAttemptedAt: '2026-08-29T00:00:00.000Z',
    }));
    expect(status.opfs.displayState).toBe('pending');
  });

  it('resolves idb displayState across its three states (never checking)', () => {
    expect(deriveMigrationStatus(sqlite()).idb.displayState).toBe('done');
    expect(deriveMigrationStatus(sqlite({ idbMigrationV2Done: false, idbLegacyDbName: null })).idb.displayState).toBe('notApplicable');
    expect(deriveMigrationStatus(sqlite({ idbMigrationV2Done: false, idbLegacyDbName: 'idb-batch-atomic' })).idb.displayState).toBe('pending');
  });
```

各 `displayState` の期待値は、既存テストの `done`/`notApplicable`/`checking`/`warn` の assertion と整合していることを確認すること（例: 46-57行目のテストが `checking: true` を期待している入力なら、`displayState` も `'checking'` になるはず）。

### 視覚的差分ゼロの検証方法

`src/dashboard/panels/diagnostic/__tests__/diagnosticsPanel.migration.test.ts`（既存のjsdom統合テスト・8件）が表示内容を検証している。**このテストを一切変更せずにパスさせること**が、視覚的差分ゼロの証明になる。変更が必要になった場合は、表示が変わってしまっている証拠なので実装を見直す。

### 検証コマンド

```bash
npm run type-check
npx vitest run src/dashboard/panels/diagnostic   # migration.test.ts を無変更でパスさせる
npx vitest run src/dashboard
```

### 触ってはいけないもの

- `makeStatRow` の第3引数に渡している `opfs.warn` / `idb.warn`（369-370行目）— `displayState` とは別の軸なので残す
- `overall` の算出ロジック（`allDone` / `checking` / `warn`）— 今回のスコープ外
- `diagnosticsPanel.migration.test.ts` — 無変更でパスすることが受け入れ条件

---

## 制約
- 表示内容・DOM構造は変更しない（リファクタのみ、視覚的な差分ゼロ）
- `MigrationOpfsStatus` / `MigrationIdbStatus` の既存フィールド（`done`/`notApplicable`/`checking`/`warn`）は削除しない（`warn` はレンダー側で別用途に使用中、既存テスト10件も参照）
- PBI 07 の後に着手する（同じ型を触るため）

## BDD受け入れシナリオ

```gherkin
Scenario: OPFS移行状態の表示区分がderiveMigrationStatus側で一意に決定される
  Given DiagnosticsSnapshot.sqlite が特定の移行状態を示す値を持つ
  When deriveMigrationStatus(snapshot.sqlite) を呼び出す
  Then opfs.displayState が 'done' | 'notApplicable' | 'checking' | 'pending' のいずれか一意の値として返される

Scenario: renderMigrationSectionが表示区分をラベルにマッピングするだけになる
  Given deriveMigrationStatus の戻り値に opfs.displayState が含まれている
  When renderMigrationSection(el, snap) を呼び出す
  Then 優先順位の条件分岐なしに displayState から対応するラベル文字列を引くだけになる

Scenario: 既存の診断パネル表示が変更前と完全に同じ結果になる
  Given 任意の DiagnosticsSnapshot.sqlite の組み合わせ
  When 既存の diagnosticsPanel.migration.test.ts を無変更で実行する
  Then 8件すべてがパスする（表示テキストが一致している証明）
```

## 受け入れ基準
- [ ] `MigrationDisplayState` 型（`'done' | 'notApplicable' | 'checking' | 'pending'`）を定義する
- [ ] `MigrationOpfsStatus.displayState` と `MigrationIdbStatus.displayState`（後者は `checking` を除外）を追加する
- [ ] `deriveMigrationStatus` が現状のレンダー側と同一の優先順位で `displayState` を算出する
- [ ] `renderMigrationSection` の `opfsValue`/`idbValue` 算出が `Record<MigrationDisplayState, string>` によるマッピングだけになる
- [ ] IDB側に `checking` 状態が存在しない理由をコードコメントで明示する
- [ ] `deriveMigrationStatus.test.ts` に `displayState` の全パターン（OPFS 4種・IDB 3種）の単体テストを追加する
- [ ] `diagnosticsPanel.migration.test.ts`（既存8件）を**無変更で**パスさせる
- [ ] 既存の `deriveMigrationStatus.test.ts` 10件が変更なくパスする

## テスト戦略
- E2E: 既存の診断パネル表示確認フローをそのまま再実行し回帰がないことを確認
- 統合: `diagnosticsPanel.migration.test.ts`（既存jsdomテスト）を無変更でパスさせることで視覚的差分ゼロを証明
- 単体: `displayState` の全パターン網羅、OPFS/IDBの非対称性（IDB側にcheckingがないこと）を型と実行時の両方で確認

## 見積もり
2ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
