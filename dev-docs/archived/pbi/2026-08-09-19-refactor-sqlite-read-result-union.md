# PBI: SQLite 読み取り系のエラーを Result union で貫通させる

**作成日**: 2026-08-09
**優先度**: 高
**見積もり**: 🔴大（5pt目安）
**副作用**: 🟡あり（DB障害時の表示が「空」から「エラー」に変わる）
**種別**: ♻️リファクタリング（refactor）＋🐛バグ修正（fix）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補02+04）で、
**SQLite のエラー情報が最後の一段で捨てられている**ことが判明した。

`/grilling` による設計対話（質問7〜10）を経て方針を決定済み。

### エラーは途中まで正しく運ばれている

```
StorageBackend            BackendOrError<T> … error: string    ← 情報あり
  ↓
dbMaintenance             { success:false, error }             ← 情報あり
  ↓
SqliteClient.call()       CallResult<T> = {success:false,error} ← 情報あり
  ↓
SqliteClient.query()      return result.success ? result.data : null   ← ★捨てる
  ↓
dashboardSqliteHandlers   error: deps.lastError() || 'Query failed'    ← 横から拾い直す
  ↓
dashboardSqliteService    return null                                  ← ★また捨てる
  ↓
exportLogsPanel           result?.rows ?? [] → 'データがありません'      ← 嘘の表示
```

`src/offscreen/StorageBackend.ts` は18操作すべてで `BackendOrError<T>` を
正しく運んでおり、**この層は手本**である。問題は末端2箇所。

### 実害: DB障害が「データがありません」になる

`src/dashboard/panels/diagnostic/exportLogsPanel.ts:78-82`:

```typescript
const result = await queryAuditLogs({ limit: 100000, offset: 0 });
const rows = result?.rows ?? [];
if (rows.length === 0) {
  if (auditStatusEl) auditStatusEl.textContent = 'データがありません';
  return;
}
```

DB が開けなかった利用者に「監査ログは空です」と表示される。

**これは v6.7.26 で3箇所修正した不具合と同じクラス**であり、
形が残っているため4件目が生き残っていた。

### 根本原因（なぜなぜ分析）

**なぜ1**: ハンドラが `deps.lastError()` を読むのは、`deps.query()` の戻り値が
`{rows,total} | null` で失敗理由を含まないから。

**なぜ2**: `query()` が理由を返さないのは `sqliteClient.ts:259` の
`return result.success ? result.data : null;` のため。
**直前の `call()` は `CallResult<T>` という完全な情報を持っている**のに潰している。
同じ潰し方が **13メソッド**、`boolean` 化が **6メソッド**。

**なぜ3**: 潰してよいと判断されたのは、`lastError` という public フィールドに
退避してあり後から読めるから。

**なぜ4**: だが `lastError` は**インスタンス共有の可変状態**である。
`call()` は成功時に `this.lastError = null`（`sqliteClient.ts:215`）、
失敗時に上書き（211/221行）する。`msgOffscreen` は Mutex で直列化されるが、
**`lastError` の読み出しは Mutex の外**。
戻り値を見てから `lastError` を読むまでの間に別操作が完了すると、
**別の操作のエラー、あるいは `null` を読む**。

この危険は既に認識されており、v6.7.26 で `import` ケースだけ緩和済み
（`dashboardSqliteHandlers.ts:193` のコメント
「Read once: a second call could observe a different value if another
operation completed in between.」）。**残る14箇所は未対応。**

**なぜ5（根本）**:
**その呼び出しに紐づいた事実（戻り値）を捨て、
共有された最新状態（インスタンス変数）で代用しているから。**
`lastError` は本質的に「直前の誰かの失敗」であって
「この呼び出しの失敗理由」ではない。大半のケースで一致するため機能しているが、原理的に別物。

### 候補04（retry）も同じ根から生えている

`dashboardSqliteService.ts:99, 132` の retry 条件:

```typescript
if (attempt === 0 && response.error && String(response.error).includes('Query failed')) {
```

`'Query failed'` は `deps.lastError() || 'Query failed'` の**右辺**、
すなわち「`lastError` が空のときだけ出る汎用フォールバック文言」。

ところが `categorizeError`（`sqliteClient.ts:46-60`）は
最後が `return \`Unexpected error: ${msg}\`` で**必ず非空を返す**。
したがって右辺はほぼ選ばれず、**この retry はほぼ発動していない**。

さらに v6.7.26 の `lastError` getter 化により、より具体的なエラーが
返るようになったため、発動条件は**さらに狭まった**。

> 【訂正】レビュー報告時に「候補02を実施すると retry が静かに壊れる」と書いたが、
> 正確には**すでに大半のケースで発動していない**。

**気づかれなかった理由**: `categorizeError` の第1分岐が
`'SQLite request timed out. The database may still be initializing.'` を返すため、
未初期化はタイムアウトとして分類され、それらしい説明が出る。
利用者からは「エラーは出るが説明がついている」状態に見え、retry 不発が症状として現れない。

**retry の根本原因もなぜ5と同じ**: 「リトライすべきか」という判断を、
その判断に必要な情報を持たない層（dashboard）が、
**人間向けに整形済みの英文**から復元しようとしている。
`categorizeError` の文言が整備された結果、壊れた。

---

## 決定事項（/grilling で合意済み）

| # | 論点 | 決定 |
|---|---|---|
| 7 | 移行範囲 | **読み取り系6関数に限定**。変更系（delete/update/toggleStar 等）は据え置き |
| 9 | どこで直すか | `SqliteClient` の対応6メソッドを **`CallResult` 化**し、`deps.lastError()` 経由をやめる |
| 8 | retriable の判断 | **`CallResult` に相乗り**させる。文字列照合を廃止 |
| 10 | PBI 粒度 | 候補02と04は**不可分**（retriable が `CallResult` に相乗りするため）。1 PBI |

### 決定7の根拠

実害が確認されたのは**すべて読み取り系**（v6.7.26 の3件 + `exportLogsPanel.ts:79`）。
読み取り系は「空である」という事実を利用者に提示する経路であり、
情報が失われると嘘の表示になる。

変更系は失敗しても「消えていない」ことが画面で分かるため実害が出にくく、
`if (!await deleteLog(id))` で足りている。巻き込むと複雑さが分散する（削除テストが失敗）。

### 対象6関数

| dashboard 側 | SqliteClient 側 |
|---|---|
| `queryLogs` | `query` |
| `searchLogs` | `search` |
| `queryAuditLogs` | `queryAuditLog` |
| `getLogCount` | `getCount` |
| `getSqliteStatus` | `getStatus` |
| `backupDb` | `backupDb` |

> **`getSqliteStatus` は実装時に対象から外す可能性がある。**
> 現在、失敗時も正常な型で `initError` を詰めて返す設計になっており
> （`dashboardSqliteService.ts:298-313`）、
> これは診断パネルが「初期化に失敗した」状態を**表示するため**の意図的な設計と読める。
> 実装時に判断すること。

> 【実装後の判断】**`getSqliteStatus` / `getCount` を対象から外した。**
>
> - `getStatus`: `sqliteClient.ts:418-429` が失敗時にも
>   `{ initialized: false, ..., initError }` を組み立てて返しており、
>   「初期化に失敗した」こと自体が診断パネルの表示内容である。
>   `CallResult` 化すると呼び出し側が失敗として扱い、表示すべき情報が消える。
> - `getLogCount`: 唯一の呼び出し元 `diagnosticsPanel.ts:203` が
>   `urlCount >= 0 ? String(urlCount) : 'Unavailable'` と `-1` を正しく区別済み。
>   変更しても得るものがない。
>
> 結果、dashboard 側の実質的な移行対象は
> `queryLogs` / `searchLogs` / `queryAuditLogs` / `backupDb` の4関数。
> SqliteClient 側は `queryResult` / `searchResult` / `getCountResult` /
> `backupDbResult` / `queryAuditLogResult` の5メソッドを追加した
> （`getCountResult` は handler 経由で使用）。

---

## 目的

`CallResult`（＝その呼び出しに紐づくエラー）を SW から dashboard まで貫通させ、
`lastError` という共有可変状態の経由をやめる。
併せて `retriable` を union に乗せ、文字列照合による retry 判定を廃止する。

---

## 対象範囲

| ファイル | 変更内容 |
|---|---|
| `src/background/sqliteClient.ts` | `categorizeError` を構造化。対象6メソッドを `CallResult` 化 |
| `src/background/handlers/dashboardSqliteHandlers.ts` | 対象6分岐で `deps.lastError()` をやめ `result.error` を使う |
| `src/background/handlers/dashboardSqliteProtocol.ts` | レスポンスに `retriable` を追加 |
| `src/dashboard/dashboardSqliteService.ts` | 対象6関数を Result union 化。独自 retry ループを削除 |
| `src/dashboard/panels/diagnostic/exportLogsPanel.ts` | 実害箇所の修正 |
| `src/dashboard/utils/retry.ts` | `{error}` 形式への対応（下記リスク2） |
| `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` | retry 利用箇所の追随 |
| `src/dashboard/panels/asyncData/tagClusterPanel.ts` | retry 利用箇所の追随 |

### 据え置き（決定7）

変更系メソッドと、それに対応する9箇所の `deps.lastError()` は現状維持。

---

## 受け入れ条件

- [ ] 対象6メソッドが失敗理由を戻り値で返す（`lastError` 経由をやめている）
- [ ] 対象6分岐で `deps.lastError()` を読んでいない
- [ ] `categorizeError` が分類（`kind`）を保持し、`retriable` を導出できる
- [ ] `dashboardSqliteService.ts` から `includes('Query failed')` 等の文字列照合が消えている
- [ ] `exportLogsPanel.ts` が DB 障害時に「データがありません」と表示しない
- [ ] `retryWithExponentialBackoff` の既存2利用箇所が壊れていない（リスク2）
- [ ] `npm run validate` が通る

---

## テスト方針

### 新規に必要なテスト

1. **エラー貫通**: backend のエラー文言が dashboard 層まで**そのまま**届くこと
2. **空と失敗の区別**: 0件成功と失敗が呼び出し側で区別できること
   （`exportLogsPanel` の回帰防止）
3. **retriable**: 初期化中に相当するエラーで `retriable: true` が立ち、
   quota / SQLITE_ エラーでは立たないこと
4. **並行性**: 別操作が間に挟まっても、返るエラーがその呼び出しのものであること
   （なぜ4の回帰防止）

### 既存テストへの影響

対象15ファイル。戻り値の形が変わるため広範囲に及ぶ。
**v6.7.26 で「バグを仕様として書いていたテスト」を書き直した前例がある**
（`markdownExport.test.ts` の
`treats a query error as an empty result rather than throwing`）。
同種のテストが残っていないか確認すること。

---

## リスクと注意点

### 1. DB障害時の表示が変わる（副作用 🟡）

「データがありません」→ 具体的なエラー文言。これは修正であり退行ではない。

### 2. `retryWithExponentialBackoff` の既存2利用箇所が壊れる

`src/dashboard/utils/retry.ts:64`:

```typescript
const result = await fn();
if (result !== null) {
  return result;
}
```

**`null` か例外のときしかリトライしない。**
本 PBI で対象6関数が `{ error }` を返すようになると、
`{ error }` は `null` ではないため**エラーを成功とみなして即座に返す**。

影響を受ける既存利用箇所:
- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts:215`（`getSqliteStatus`）
- `src/dashboard/panels/asyncData/tagClusterPanel.ts:149`（`getSqliteStatus`）

**この2箇所の対応は本 PBI の作業範囲に含める。**

> 【訂正】設計対話の途中で「独自 retry を削除し `retry.ts` に寄せればよい」と
> 推奨したが、この非互換を見落としていた。`retry.ts` にそのまま寄せることはできない。

> 【実装後の訂正】このリスクは**実際には発現しなかった**。
> 全4箇所の利用状況を確認した結果:
> - `tagClusterPanel.ts:158` — thunk 内で `'error' in queryResult` を判定し
>   `null` に正規化済み（2026-08-09-12 の修正による）
> - `sqliteHistoryPanel.ts:1039` — thunk が `state.error ? null : true` を返す
> - `diagnosticsPanel.ts:214` — `getSqliteStatus` を渡すが、同関数は決定7の
>   個別判断により**対象外**とした（下記）
>
> いずれも `{error}` をそのまま `retryWithExponentialBackoff` に渡していない。
> `retry.ts` は無変更で済んだ。

### 3. ADR 2026-07-13 仮定G との関係

同 ADR は「Chrome Extension API のエラーは型付き例外ではなく文字列メッセージ。
文字列マッチは fragile だが唯一の現実的手段」と結論している。

**本 PBI はこれと矛盾しない。**
`categorizeError` の**入力**が文字列である点は変えない。
変えるのは**出力**で、分類済みの `kind` を英文に畳んで捨てるのをやめる。

### 4. `lastError` フィールドの扱い

対象6メソッドが `CallResult` を返すようになっても、
`lastError` は変更系9箇所と診断ログ2箇所
（`reviewSummaryGenerator.ts:191, 260`）が使用中のため**残す**。
将来的な削除は変更系の移行後。

> 【実装後】内部状態を `lastErrorDetail: SqliteError | null` に一本化し、
> `lastError` は `lastErrorDetail?.message ?? null` を返す getter として残した。
> 事実の二重化を避けつつ、既存11箇所の読み手を無変更にするため。

### 5. 実装後の追記: 後方互換のとり方

既存6メソッドのシグネチャは**変更していない**。
`queryResult` 等を新設し、既存の `query` はそれを呼んで `null` に畳む形にした。
`query` は `recordingLogic` など読み取り以外の利用者も持つため、
全利用者を巻き込まずに済む。

### 6. 実装後の追記: テスト側の対応

テストは `SqliteClient` を手書きモックしており、`query` は定義するが
`queryResult` は定義しない。23件が失敗したため、
テストハーネス（`dashboardSqliteTestHarness.ts`）に
**旧形式モックから `*Result` を導出するアダプタ**を追加した。
`null` → `lastError` を載せた失敗、という変換になるので、
移行したアサーションの意味が保たれる。

このアダプタは以下の2点に注意して実装した:
- **呼び出し時に解決する**: 複数のテストがオブジェクト生成後に
  `client.query = vi.fn()` と差し替えるため、構築時のスナップショットでは追随できない
- **その場で拡張する**: テストが同じ参照に対して spy アサーションを行うため、
  コピーを返すと乖離する

実 `SqliteClient` を使う2テストのみ、`queryResult`/`searchResult` を
直接スタブするよう変更した（プロトタイプに実メソッドが存在し、
アダプタが導出をスキップするため）。

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補02・04）
- 設計対話: `/grilling` 質問7〜10
- 先行 PBI: 2026-08-09-18（クレンジングルール表）— **独立だが実施順は 18 が先**
- 同種の過去修正: 2026-08-09-12（queryLogs 失敗の空データ化、v6.7.26）
- ADR 2026-07-13 sqlite-architecture-deep-dig（仮定G）
