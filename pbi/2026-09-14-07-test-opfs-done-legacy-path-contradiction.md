# PBI: deriveMigrationStatusの「移行済みかつレガシーDB残存」状態を可視化する

## ユーザーストーリー
拡張機能の開発者として、`deriveMigrationStatus`が「移行済みフラグが立っているのにレガシーDBがまだ存在する」状態を検知できるようにしたい、なぜなら現在この組み合わせは無条件で「Done」表示になり、レガシーDBの削除失敗や部分移行がユーザーにもサポート担当にも一切見えないため。

## 優先度
- 順位: 03 / 4
- RICEスコア: 3.2（Reach=開発者(月数回の変更頻度) × Impact=0.5 × Confidence=80% / Effort=0.5人日）
- 根拠: adversarial-code-reviewで裏取り済み。実装コストは小さいが、表示仕様の判断を伴うためConfidenceはやや低い。依存関係なし。

---

## 実装ガイド（調査済み・そのまま着手可）

### この矛盾状態は実際に起こりうる（調査結果）

当初「一見あり得ない組み合わせ」と書いたが、調査の結果**実際に発生しうる**ことが分かった。2つの値は独立した情報源から来る:

`src/offscreen/sqliteStatus.ts:95-119`

| フィールド | 情報源 | 更新タイミング |
|---|---|---|
| `opfsMigrationV2Done` | `chrome.storage.local`（`StorageKeys.OPFS_MIGRATION_V2_DONE`）| 移行ルーチンが完了時に書き込む |
| `opfsLegacyDbPath` | **ライブprobe**（OPFS上に実ファイルが存在するか毎回確認）| 診断パネルを開くたびに実測 |

したがって「移行ルーチンは完走してフラグを立てたが、レガシーファイルの削除に失敗した/削除をしていない」場合、`opfsMigrationV2Done=true` かつ `opfsLegacyDbPath='<pool>/<file>'` になる。これはディスク容量を二重に消費している状態であり、ユーザーに見えるべき情報。

### 現状のロジック（`src/dashboard/panels/diagnostic/diagnosticsPanel.ts:289-304`）

```typescript
  const opfsLegacyPath = sqlite?.opfsLegacyDbPath;
  const idbLegacyName = sqlite?.idbLegacyDbName;
  const opfsNotApplicable = !opfsDone && opfsLegacyPath === null;   // ← done=true なら常に false
  const idbNotApplicable = !idbDone && idbLegacyName === null;
  const allDone = (opfsDone || opfsNotApplicable) && (idbDone || idbNotApplicable);
  // ...
  const opfsChecking = !opfsDone && !opfsNotApplicable && !opfsAttempted;  // ← done=true なら常に false
  const opfsWarn = !opfsDone && !opfsNotApplicable && !opfsChecking;       // ← done=true なら常に false
```

`opfsDone === true` の場合、`notApplicable`/`checking`/`warn` はすべて `false` に落ち、`allDone === true` になる。レガシーDBの残存は完全に握り潰される。

### 変更方針

`MigrationOpfsStatus`（`diagnosticsPanel.ts:244-253`）と `MigrationIdbStatus`（255-260）に「残存」を表すフラグを1つ追加し、レンダー側で1行出す。

1. 型に追加:

```typescript
export interface MigrationOpfsStatus {
  done: boolean;
  notApplicable: boolean;
  checking: boolean;
  warn: boolean;
  /**
   * 移行済みフラグが立っているのにライブprobeがレガシーDBを検出した状態。
   * 移行ルーチンは完走したがレガシーファイルの削除に失敗した/未実施の
   * 可能性があり、ディスクを二重消費している。done とは独立したフラグ
   * （done 自体は true のまま — 移行そのものは完了しているため）。
   */
  legacyStillPresent: boolean;
  legacyPath: string | null | undefined;
  // ... 以下既存
}
```

2. `deriveMigrationStatus` 内で算出（`opfsNotApplicable` の算出直後あたり）:

```typescript
  const opfsLegacyStillPresent = opfsDone && opfsLegacyPath != null;
  const idbLegacyStillPresent = idbDone && idbLegacyName != null;
```

`!= null` を使うこと（`undefined` は「probeが失敗して未確認」なので残存と断定しない — 上記`sqliteStatus.ts:112-113`のコメント参照）。

3. 戻り値の `opfs` / `idb` にそれぞれ `legacyStillPresent` を含める

4. `hints` に新しい種別を追加（`MigrationHintKind`、`diagnosticsPanel.ts:242`）:

```typescript
export type MigrationHintKind = 'noAbsolutePath' | 'idbExplanation' | 'opfsCheckingStale' | 'legacyStillPresent';
```

`deriveMigrationStatus` 内で `if (opfsLegacyStillPresent || idbLegacyStillPresent) hints.push('legacyStillPresent');`

5. `renderMigrationSection`（337行目〜）に hint の描画を追加。既存の `opfsCheckingStale` hint の描画（429-435行目）が実装例になる:

```typescript
  if (status.hints.includes('legacyStillPresent')) {
    const note = document.createElement('p');
    note.className = 'help-text';
    note.textContent = getMessage('diagMigrationLegacyStillPresent')
      || 'Migration is marked complete, but the legacy database file is still present. It is safe to keep, but it consumes storage — reloading the extension may trigger cleanup.';
    el.appendChild(note);
  }
```

6. i18n キー `diagMigrationLegacyStillPresent` を `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方に追加する
   （既存の `diagMigrationCheckingStaleHint` の隣に置く。日本語は「移行は完了していますが、旧データベースファイルがまだ残っています。保持していても問題はありませんが、ストレージを消費します。拡張機能を再読み込みすると削除される場合があります。」程度）
   **注意**: JSON編集は CLAUDE.local.md の規約により Edit ツールを使うこと（`sed`/`awk` 禁止）

### 追加すべきテスト

`src/dashboard/panels/diagnostic/__tests__/deriveMigrationStatus.test.ts` に追加。既存の `sqlite()` ヘルパー（5-15行目、`opfsMigrationV2Done: true` / `idbMigrationV2Done: true` がデフォルト）がそのまま使える:

```typescript
  it('flags legacyStillPresent when OPFS migration is done but the legacy DB is still on disk', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: true,
      opfsLegacyDbPath: 'sqlite-pool/yasumaro.db',
    }));

    expect(status.opfs.done).toBe(true);          // 移行自体は完了
    expect(status.opfs.legacyStillPresent).toBe(true);
    expect(status.hints).toContain('legacyStillPresent');
  });

  it('does not flag legacyStillPresent when the probe could not confirm (undefined)', () => {
    // undefined = probe が失敗して未確認。残存と断定してはいけない。
    const status = deriveMigrationStatus(sqlite({ opfsMigrationV2Done: true }));

    expect(status.opfs.legacyStillPresent).toBe(false);
    expect(status.hints).not.toContain('legacyStillPresent');
  });

  it('does not flag legacyStillPresent when the legacy DB is confirmed absent', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: true,
      opfsLegacyDbPath: null,
    }));

    expect(status.opfs.legacyStillPresent).toBe(false);
  });

  it('flags legacyStillPresent on the IDB side independently', () => {
    const status = deriveMigrationStatus(sqlite({
      idbMigrationV2Done: true,
      idbLegacyDbName: 'idb-batch-atomic',
    }));

    expect(status.idb.legacyStillPresent).toBe(true);
    expect(status.hints).toContain('legacyStillPresent');
  });
```

### 検証コマンド

```bash
npm run type-check
npx vitest run src/dashboard/panels/diagnostic
npm run test:i18n   # i18nキー追加の検証（スクリプト名は package.json で確認）
npx vitest run src/dashboard
```

### 触ってはいけないもの

- `allDone` の算出ロジック — `legacyStillPresent` は `done` とは独立した情報であり、`allDone` を `false` にしてはいけない（移行自体は完了している）
- `src/offscreen/sqliteStatus.ts` — 値の生成側は変更不要
- 既存の10件のテストケース — すべて変更なくパスすること

---

## 制約
- `allDone` / `warn` / `checking` の既存の算出ロジックは変更しない（`legacyStillPresent` は独立した追加フラグ）
- 既存の `deriveMigrationStatus.test.ts` の10件が変更なくパスすること
- i18n は ja/en 両方に追加する（片方だけだとi18n網羅テストが落ちる）

## BDD受け入れシナリオ

```gherkin
Scenario: 移行済みフラグが立っていてもレガシーDBが実在すれば可視化される
  Given sqlite.opfsMigrationV2Done が true
  And ライブprobeが sqlite.opfsLegacyDbPath に実パスを返した
  When deriveMigrationStatus(sqlite) を呼び出す
  Then opfs.legacyStillPresent が true になり、hints に 'legacyStillPresent' が含まれる
  And opfs.done は true のまま（移行そのものは完了しているため）

Scenario: probeが未確認（undefined）の場合は残存と断定しない
  Given sqlite.opfsMigrationV2Done が true
  And sqlite.opfsLegacyDbPath が undefined（probe失敗で未確認）
  When deriveMigrationStatus(sqlite) を呼び出す
  Then opfs.legacyStillPresent が false になる

Scenario: 残存が検出された場合に診断パネルへ説明が表示される
  Given hints に 'legacyStillPresent' が含まれる
  When renderMigrationSection が実行される
  Then 「移行は完了しているがレガシーDBが残っている」旨の説明文が表示される
```

## 受け入れ基準
- [ ] `MigrationOpfsStatus` / `MigrationIdbStatus` に `legacyStillPresent: boolean` を追加する
- [ ] `deriveMigrationStatus` が `done === true && legacyPath != null` の条件で `legacyStillPresent` を算出する（`undefined` は残存と判定しない）
- [ ] `MigrationHintKind` に `'legacyStillPresent'` を追加し、OPFS/IDBいずれかで残存を検出したら hints に含める
- [ ] `renderMigrationSection` が該当 hint を説明文として表示する
- [ ] i18n キー `diagMigrationLegacyStillPresent` を `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方に追加する
- [ ] `allDone` の算出は変更しない（移行自体は完了しているため true のまま）
- [ ] 既存の `deriveMigrationStatus.test.ts` 10件が変更なくパスする

## テスト戦略
- E2E: 既存の診断パネル表示確認フローをそのまま再実行し回帰がないことを確認
- 統合: なし
- 単体: `legacyStillPresent` の4パターン（done+実パス / done+undefined / done+null / notDone+実パス）をOPFS・IDB両側で網羅

## 見積もり
1ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
