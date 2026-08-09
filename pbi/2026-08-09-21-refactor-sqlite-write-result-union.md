# PBI: SQLite 変更系のエラーを Result union で貫通させ lastError を廃止する

**作成日**: 2026-08-09
**優先度**: 中
**見積もり**: 🟡中（3pt目安）
**副作用**: 🟡軽微（変更系の失敗が無反応から明示的エラー表示に変わる）
**種別**: ♻️リファクタリング（refactor）＋🐛バグ修正（fix）

---

## フェーズ0: 既実装確認（実施済み・2026-08-09）

```bash
grep -n "deleteResult\|updateResult\|toggleStarResult\|clearAllResult" src/background/sqliteClient.ts
# → 出力なし。未実装であることを確認
```

PBI 2026-08-09-19 で**読み取り系**を `CallResult` 化済み。本PBIは**変更系**（残り半分）。

---

## 背景

PBI-19 は読み取り系5メソッドを `CallResult` 化したが、
**変更系は意図的に対象外とした**（同PBI「決定7」）。その残りを片付ける。

### 現状: 9箇所が共有可変状態を読んでいる

`src/background/sqliteClient.ts:120-137` のコメントが危険性を明示している:

```typescript
/**
 * This is shared mutable state: it describes "the most recent failure by
 * anyone", not "why *your* call failed". Reading it after a call can observe
 * a different operation's error, or null, if another operation completed in
 * between — the read is outside the request Mutex.
 */
lastErrorDetail: SqliteError | null = null;
```

`deps.lastError()` を読む箇所（実測9件）:

| 行 | subtype | フォールバック文言 |
|---|---|---|
| 131 | `toggle_star` | `'Toggle star failed'` |
| 138 | `delete` | `'Delete failed'` |
| 150 | `update` | `'Update failed'` |
| 164 | `clear_all` | `'Clear all failed'` |
| 205 | `import` | （防御的コメント付き） |
| 230 | `status` | `'Status check failed'` |
| 237 | `opfs_spike` | `'OPFS spike failed'` |
| 301 | `purge_now` | `'Purge failed'` |
| 329 | `content_purge_now` | `'Content purge failed'` |

加えて診断ログ2件（`reviewSummaryGenerator.ts:191, 260`）が `sqliteClient.lastError` を直接読む。

### 実害: 変更系の失敗が利用者に一切伝わらない

**本PBIの調査で判明した新しい発見。**

`src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:241-266`:

```typescript
async function handleToggleStar(id: number): Promise<void> {
  const result = await toggleStar(id);
  if (result) {          // ← 失敗時は else が無い
    const entry = state.entries.find(e => e.id === id);
    if (entry) entry.is_starred = result.is_starred;
    refresh();
  }
}

async function handleDelete(id: number): Promise<void> {
  // ...確認ダイアログ...
  const ok = await deleteLog(id);
  if (ok) {              // ← 失敗時は else が無い
    state.entries = state.entries.filter(e => e.id !== id);
    refresh();
  }
}
```

**DB障害でスターが付かない／削除できないとき、画面は完全に無反応になる。**
エラーも出ず、ボタンを押しても何も起きない。利用者は操作が効かない理由を知る手段がない。

ハンドラ層では `deps.lastError() || 'Delete failed'` として
エラー文言が組み立てられているが、**dashboard 側が `boolean` に潰すため到達しない。**

> PBI-19 は「読み取り系は嘘の表示になる（データがありませんと出る）」ことを問題とした。
> 変更系は嘘は表示しないが、**沈黙する**。どちらも「失敗を伝えない」点で同根。

### 根本原因（なぜなぜ分析）

**なぜ1**: なぜ画面が無反応なのか
→ `deleteLog()` が `boolean` を返し、失敗理由を持たないから。

**なぜ2**: なぜ `boolean` なのか
→ `dashboardSqliteService.ts:174-182` が `response.success === true` に潰しているから。

**なぜ3**: なぜ潰せると判断されたのか
→ 「削除できたか否か」だけ分かれば UI は書けるという想定。
実際には**失敗時に何をすべきか**が設計されていなかった（`if (ok)` に `else` が無い）。

**なぜ4**: なぜハンドラは `deps.lastError()` を読むのか
→ `sqliteClient.delete()` が `boolean` を返し、`call()` が持っていた
`CallResult` を捨てているから（`sqliteClient.ts:354-357`）。

**なぜ5（根本）**
**PBI-19 のなぜ5と同一。**
その呼び出しに紐づいた事実（戻り値）を捨て、
共有された最新状態（`lastError`）で代用している。
読み取り系だけ直したので、**同じ欠陥が変更系に残っている。**

---

## ユーザーストーリー

**拡張機能の利用者**として、**履歴の削除やスター付けが失敗したときにそれを知りたい**、
なぜなら**現在は画面が無反応になるだけで、操作が効かない理由も対処方法も分からないから**。

## ビジネス価値

- **サイレント障害の解消**: DB障害時に「ボタンが壊れている」ようにしか見えない状態を解消する。
- **並行性バグの構造的排除**: `lastError` を削除することで、
  「別操作のエラーを読む」というテスト困難な競合が**発生しえなくなる**。
- **測定方法**: `deps.lastError()` の参照数（9 → 0）、`lastError` フィールドの存在（有 → 無）。

---

## BDD受け入れシナリオ

```gherkin
Scenario: 削除の失敗が利用者に伝わる
  Given SQLite が障害でエラーを返す状態である
  When 利用者が履歴エントリの削除ボタンを押す
  Then 失敗した旨のエラーメッセージが画面に表示される
  And エントリは一覧から消えない

Scenario: スター付けの失敗が利用者に伝わる
  Given SQLite が障害でエラーを返す状態である
  When 利用者がスターボタンを押す
  Then 失敗した旨のエラーメッセージが画面に表示される

Scenario: 成功時の挙動が変わらない
  Given SQLite が正常である
  When 利用者が履歴エントリを削除する
  Then エントリが一覧から消え、エラーは表示されない

Scenario: 失敗理由がその呼び出しのものである
  Given 2つの SQLite 操作が並行して実行される
  And 一方だけが失敗する
  When 失敗した側の呼び出し元がエラーを受け取る
  Then それは自分の操作の失敗理由であり、他方の理由ではない

Scenario: 共有可変状態が存在しない
  Given リファクタリング完了後のコードである
  When SqliteClient を確認する
  Then lastError / lastErrorDetail フィールドが存在しない
```

---

## 受け入れ基準

- [ ] 変更系メソッドが `CallResult` を返す（`boolean` / `null` への潰しをやめている）
- [ ] `dashboardSqliteHandlers.ts` の `deps.lastError()` 参照が**0件**
- [ ] `DashboardSqliteHandlerDeps` から `lastError` が削除されている
- [ ] `SqliteClient` から `lastErrorDetail` / `lastError` が削除されている
- [ ] `reviewSummaryGenerator.ts:191, 260` の診断ログが戻り値経由になっている
- [ ] `sqliteHistoryPanel.ts` の削除・スターが失敗時にエラーを表示する
- [ ] `npm run validate` が通る

---

## テスト戦略（t_wadaスタイル / Outside-In）

### E2Eテスト（最小限）
- 正常時の削除・スター操作が従来どおり動作する（既存E2Eで担保）

### 統合テスト（中程度）
1. **エラー貫通**: SQLite 障害時、`deleteLog` が理由付きの失敗を返す
2. **UI表示**: `sqliteHistoryPanel` が失敗時にエラー要素を出す
3. **成功時無変化**: 成功パスの戻り値・UI挙動が従来と同じ

### 単体テスト（多数）
1. `delete` / `update` / `toggleStar` / `clearAll` が `CallResult` を返す
2. 失敗時に `error.kind` / `error.retriable` が正しい
3. ハンドラが `result.error.message` を返す（`lastError` を読まない）
4. **並行性**: 2操作を交互に実行し、各々が自分のエラーを受け取る（なぜ5の回帰防止）

### Outside-In の進め方
1. 「削除失敗時にエラー表示」の統合テストを書く → 失敗を確認
2. `sqliteClient` の変更系を `CallResult` 化
3. ハンドラ → service → panel の順に貫通させる

---

## 実装アプローチ

詳細な手順は実装計画を参照:
`dev-docs/plans/2026-08-09-pbi21-sqlite-write-result-union-plan.md`

---

## 見積もり

🟡中（3pt目安）— 対象は9ハンドラ分岐＋2診断ログ。PBI-19 で確立した型・パターンをそのまま流用できる。

---

## 技術的考慮事項

### 依存関係
- **前提**: PBI 2026-08-09-19（読み取り系 `CallResult` 化）完了済み — 済
- `CallResult<T>` / `SqliteError` / `categorizeError` は**既に存在する**。新規設計は不要

### テスタビリティ
PBI-19 で `dashboardSqliteTestHarness.ts` に
「旧形式モックから `*Result` を導出するアダプタ」を追加済み。
本PBIでも同じ仕組みを変更系に拡張できる（`RESULT_METHOD_SOURCES` に行を足す）。

### 非機能要件
- **後方互換**: PBI-19 と同じく、既存メソッドは残し `*Result` を新設する方針も取れる。
  ただし本PBIは `lastError` の**削除**が目的なので、最終的には旧メソッドの利用者を全て移す

---

## 実装者向け注記

### 着手前に必ず実行

```bash
# 1. lastError の全読み手を把握する（chrome.runtime.lastError は無関係なので除外）
grep -rn "lastError" src --include='*.ts' | grep -v '__tests__' | grep -v "chrome.runtime.lastError"

# 2. PBI-19 の実装を読む（同じことを変更系にやるだけ）
git log --oneline --grep="sqlite" -5
git show f692cc9 --stat   # 読み取り系の CallResult 化
```

### 落とし穴: `getStatus` は対象外

`sqliteClient.ts:404-430` の `getStatus()` は**失敗時にも正常な型を返す**設計。

```typescript
// Even on failure, return diagnostic info so the UI can display it
return { initialized: false, path: '', fallback: false, fts5: false,
         initError: result.error.message || 'Unknown error', ... };
```

診断パネルが「初期化に失敗した」という状態を**表示する**ための意図的な設計。
`CallResult` 化すると呼び出し側が失敗として扱い、表示すべき情報が消える。
**PBI-19 でも同じ理由で対象外とした。踏襲すること。**

ただしハンドラ側（`dashboardSqliteHandlers.ts:230`）の
`deps.lastError() || 'Status check failed'` は、`getStatus()` が `null` を返した場合の分岐。
`getStatus()` が `null` を返すのは `call()` が失敗したときのみなので、
`getStatus` を `CallResult` を内部で使う形に変えれば `lastError` 参照は外せる。

### 落とし穴: `import` ケースの意味論

`dashboardSqliteHandlers.ts:203-208`:

```typescript
// Read once: a second call could observe a different value if another
// operation completed in between.
const importError = deps.lastError();
if (importError && inserted === 0) {
  return { success: false, error: importError };
}
```

これは「**バッチ内で1件も入らず、かつ直近にエラーがあった**」という条件。
ループ内の `deps.insert()` は個別に失敗を握りつぶしている（`catch { skipped++ }`）。

**単純に `lastError` を消すと、この判定ができなくなる。**
`insert()` を `CallResult` 化し、**ループ内で最後の失敗理由を局所変数に保持する**形に変える。

```typescript
let lastInsertError: SqliteError | null = null;
for (const row of batch) {
  const result = await deps.insert({...});
  if (result.success) inserted++;
  else { skipped++; lastInsertError = result.error; }
}
if (lastInsertError && inserted === 0) {
  return { success: false, error: lastInsertError.message };
}
```

これで共有状態を使わずに同じ判定ができる（かつ正確になる）。

### 落とし穴: 診断ログ2箇所

`reviewSummaryGenerator.ts:191, 260`:

```typescript
addLog(LogType.ERROR, 'Failed to query entries for weekly summary',
       { weekKey, error: sqliteClient.lastError });
```

ここは `query()` の直後。`queryResult()` に変えて `result.error.message` を渡す。
**`lastError` を消すには、この2箇所も必ず直す必要がある**（消し忘れると型エラーで気づける）。

### 落とし穴: UI にエラー表示先が無い可能性

`sqliteHistoryPanel` の `handleDelete` / `handleToggleStar` は現在
エラー表示のコードが**存在しない**。`state.error` フィールドは既にあるので
（`SqliteHistoryState.error: string | null`）、そこに入れて `refresh()` する形が自然。
既存のエラー表示 UI がどう描画されるかを先に確認すること。

```bash
grep -n "state.error" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts
```

---

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `grep -rn "lastError" src --include='*.ts' | grep -v chrome.runtime` が
      SqliteClient 関連で0件
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` が通る
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に「削除・スター操作の失敗が表示されるようになった」旨を記載

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補03）
- 先行PBI: 2026-08-09-19（読み取り系の `CallResult` 化）— **本PBIの前提かつ手本**
- 同種の過去修正: 2026-08-09-10（`lastError` の getter 化）
- ADR 2026-07-13 sqlite-architecture-deep-dig（仮定G — 本PBIと矛盾しない）
