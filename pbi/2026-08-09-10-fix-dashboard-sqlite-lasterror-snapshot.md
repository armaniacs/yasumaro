# PBI: dashboard SQLite の lastError が起動時スナップショットで固定される問題を修正する

**作成日**: 2026-08-09
**優先度**: 高
**見積もり**: 🟢小（1pt目安）
**副作用**: 🟡あり（エラー文言が変わる。既存テスト3件が落ちる想定）
**種別**: 🐛バグ修正（fix）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補1）で、dashboard SQLite ハンドラの
**エラー文言が一度もユーザーに届いていない**ことが判明した。

### 問題: 20依存のうち `lastError` だけが関数ではなく値

```typescript
// src/background/service-worker.ts:389-403（実測）
const _dashboardSqliteHandler = createDashboardSqliteHandler({
  query: (params) => sqliteClient.query(params as any),   // ← 関数（毎回評価）
  search: (query, limit, offset) => ...,                  // ← 関数
  // ...17個すべて関数...
  lastError: sqliteClient.lastError,                      // ← 値（一度だけ評価）
```

`createDashboardSqliteHandler` が呼ばれるのは **module load 時**。
その時点の `sqliteClient.lastError` は初期値 `null`（`sqliteClient.ts:78`）。

その後 `call()` が失敗するたびに `this.lastError` を書き換えるが
（`sqliteClient.ts:211/221`）、handler が掴んだのは**評価済みの `null`** であり、
以後どれだけ更新されても handler からは見えない。

### 実害

`dashboardSqliteHandlers.ts` の **15箇所**が以下の形をしている：

```typescript
return { success: false, error: deps.lastError || 'Query failed' };
```

`deps.lastError` は常に `null` なので、**常に右辺の汎用文言**が返る。

`categorizeError()`（`sqliteClient.ts:46-60`）が用意した以下の具体的文言は、
**production で一度も表示されたことがない**：

| 実際の原因 | 本来出るはずの文言 | 実際に出る文言 |
|---|---|---|
| 容量超過 | Storage quota exceeded. Some older records may have been removed. | Query failed |
| offscreen 消失 | Database connection lost. Please reload the extension. | Query failed |
| タイムアウト | SQLite request timed out. The database may still be initializing. | Query failed |

### なぜテストで見つからなかったか

**当初「wrapper は mock 設定後に評価されるので偶然動く」と分析したが、これは誤りだった。**

`dashboardSqliteHandlers.ts:365` の `sqliteClient.lastError ?? null` も
`handler(payload)` の**前**に評価されるため、production と同じく事前スナップショットである。

正しい理由は単純で、**テストの mock client が `lastError` プロパティを持っていない**：

```typescript
// src/background/handlers/__tests__/dashboardSqliteHandlers-extra.test.ts:39-55
function createMockSqliteClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    // ... lastError は存在しない
  };
}
```

よって `undefined ?? null === null` となり、テストは**汎用文言が返る挙動を正常として固定**している：

```typescript
// 同ファイル:86, 187, 432
expect(result).toEqual({ success: false, error: 'Query failed' });
expect(result).toEqual({ success: false, error: 'Get count failed' });
expect(result).toEqual({ success: false, error: 'Status check failed' });
```

**実装後の訂正**: この3件は**落ちなかった**。

PBI 起票時は「修正すれば落ちる」と予測したが、誤りだった。
理由は、wrapper 側を `lastError: () => sqliteClient.lastError ?? null` と
getter 化しても、mock は `lastError` プロパティ自体を持たないため
`undefined ?? null === null` となり、**汎用文言へのフォールバックが維持される**ため。

つまりこの3テストは「lastError が無いときは汎用文言」という
**正しい挙動を検証している**ので、変更不要。修正対象ではなかった。

## 方針の検討

### 案A: `SqliteClient` の全メソッドを Result 型に変更（不採用）

`query()` 等は現在 `T | null` を返し、`result.error` を捨てている
（`sqliteClient.ts:259` 等）。これを `{ok, error}` 形式に変えるのが最も筋が良い。

**不採用の理由**: `SqliteClient` の公開メソッドは20個以上あり、
`recordingLogic` / `migrationService` / `RecordingPipeline` 等の
background 全体から呼ばれている。変更量とリスクが本 PBI の目的
（届いていないエラー文言を届ける）に対して過大。

### 案B: deps の `lastError` を getter 関数にする（採用）

```typescript
// service-worker.ts
lastError: () => sqliteClient.lastError,
```

他の19依存と同じ「関数」の形に揃うため、**同じ間違いが再発しにくい**。
`SqliteClient` 側は無変更で、`reviewSummaryGenerator.ts:191/260` の
ライブ読み出し（正しく動作している）にも影響しない。

## 作業内容

- [x] `DashboardSqliteHandlerDeps.lastError` の型を `string | null` から
      `() => string | null` に変更する
- [x] `dashboardSqliteHandlers.ts` の15箇所を `deps.lastError()` 呼び出しに変更する
- [x] `service-worker.ts:403` を `lastError: () => sqliteClient.lastError` に変更する
- [x] `dashboardSqliteHandlers.ts:365`（wrapper）も同様に getter 化する
- [x] **具体的文言が伝播することを検証するテストを追加**する（5件）
- [x] ~~既存の3テストを更新する~~ → **不要と判明**（上記「実装後の訂正」参照）

## 実装結果

### 変更点

| ファイル | 変更 |
|---|---|
| `dashboardSqliteHandlers.ts:35` | 型を `() => string | null` へ。理由をコメントで明記 |
| `dashboardSqliteHandlers.ts` 15箇所 | `deps.lastError` → `deps.lastError()` |
| `dashboardSqliteHandlers.ts`（import 分岐） | 2回読みを1回に集約（読み取り間で値が変わりうるため） |
| `service-worker.ts:403` | `() => sqliteClient.lastError` |
| `dashboardSqliteHandlers.ts:365` | `() => sqliteClient.lastError ?? null` |

### 追加テスト（5件）

`dashboardSqliteHandlers-lastError.test.ts` を新規作成。
mutable cell を getter で読ませ、production の
「呼び出しのたびに `SqliteClient` が書き換える」構造を再現している。

- 失敗呼び出し中に設定された文言が返ること
- lastError が無いときは従来の汎用文言にフォールバックすること
- **handler 生成後**に発生したエラーが見えること（本バグの核心）
- 連続失敗で最新の文言が返ること
- search 経路でも伝播すること

### テストの実効性検証（必須手順）

1. 5件が緑になることを確認
2. deps の getter を**構築時に1回だけ評価される形**に差し替え（旧セマンティクスの再現）
3. **5件すべてが赤**になることを確認
   （`AssertionError: expected { success: false, …(1) } to deeply equal …`）
4. 修正を復元し、再度緑を確認

PBI-07 で「バグを再導入してもテストが通る」欠陥テストを書いた反省を踏まえた手順。

### 検証結果

- 新規5件: 緑（壊すと5件とも赤）
- dashboard SQLite 関連の既存テスト: **141件 全通過**
- `npm run type-check`: 通過

## 完了条件

- `sqliteClient.lastError` に値が入っている状態で query が失敗したとき、
  handler の戻り値に**その文言が含まれる**
- `lastError` が null のときは従来どおり汎用文言にフォールバックする
- **修正を戻すと新規テストが落ちる**ことを確認する（回帰テストの実効性検証）
- `npm run validate` が通る

## 検証（テストの実効性）

前回 PBI-07 で「バグを再導入してもテストが通る」欠陥テストを書いた反省から、
本 PBI では以下を必須とする：

1. 新規テストを追加し、緑になることを確認
2. `service-worker.ts` の修正を**一時的に元に戻す**
3. テストが**赤になる**ことを確認
4. 修正を戻す

## 参照

- アーキテクチャレビュー 2026-08-09 候補1
- 関連: [2026-08-09-11](2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md)（配線二重化）
- 関連: [2026-08-09-12](2026-08-09-12-fix-querylogs-error-swallowing.md)（呼び出し側）
