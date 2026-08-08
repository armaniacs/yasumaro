# PBI: queryLogs の失敗が「空データ」に化ける問題を修正する

**作成日**: 2026-08-09
**優先度**: 高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡あり（エクスポート失敗時の挙動が変わる）
**種別**: 🐛バグ修正（fix）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補3）で、`queryLogs` の失敗が
呼び出し側で**空の成功**に変換されていることが判明した。

### `queryLogs` は3分岐 union を返す

```typescript
// src/dashboard/dashboardSqliteService.ts:91
Promise<{ rows: BrowsingLogEntry[]; total: number } | { error: string } | null>
```

`null` は例外を catch した場合、`{error}` は SW がエラーを返した場合。

### 正しく処理している例（手本）

`sqliteHistoryPanel.ts:507-519` は**3分岐すべてを区別している**：

```typescript
if (result === null)          { state.error = t('historyLoadError'); ... }
else if ('error' in result)   { state.error = result.error; ... }   // 具体的文言を表示
else                          { state.entries = result.rows; ... }
```

**このパネルは修正対象ではない。他をこの形に揃えるのが本 PBI の目的。**

### 壊れている呼び出し側

#### A. `exportLogsService.ts:16` — 最も深刻

```typescript
async function queryAllData() {
  const result = await queryLogs({ limit: 10000, orderBy: 'created_at', orderDir: 'DESC' });
  return (result && 'rows' in result ? result.rows : []);   // 失敗 → []
}
```

`exportJson` / `exportCsv` / `exportMarkdown` の3つが利用。

**実害**: DB 障害時、ユーザーは**空のファイルをダウンロードし**、
`exportLogsPanel.ts:36` の
`showStatus(statusTarget, 'Markdown export completed.', 'success')`
という**成功メッセージ**を受け取る。

`exportLogsPanel.ts:31-40` は `try/catch` で囲んでいるが、`queryLogs` が
内部で例外を握りつぶすため**この catch は到達不能**。
パネル側に空チェックも一切ない（確認済み）。

**テスト状況**: `exportLogsService.test.ts` は22テストあるが、
`error` という語が**1度も出てこない**。失敗経路は完全に未検証。

#### B. `tagClusterPanel.ts:154` — リトライが無効化されている

```typescript
const result = await retryWithExponentialBackoff<BrowsingLogEntry[]>(
  async () => {
    const status = await getSqliteStatus();
    if (!status?.initialized) return null;
    const queryResult = await queryLogs({ limit: 10000 });
    return (queryResult && 'rows' in queryResult ? queryResult.rows : null) ?? [];  // ←
  },
  { label: 'tagCluster', maxAttempts: 4 }
);
```

`retryWithExponentialBackoff` は **`null` が返るか例外が出たときだけ**再試行する
（`dashboard/utils/retry.ts:64` — `if (result !== null) return result;`）。

末尾の `?? []` が `null` を**非 null の `[]`** に変えるため、
本物の DB 障害では**1回目で即座に成功扱い**となりリトライ0回。
`maxAttempts: 4` が効くのは `status.initialized` が false の経路だけ。

#### C. `markdownExport.ts:160, 211` — 軽微

```typescript
if (!result || !('rows' in result) || result.rows.length === 0) break;      // 159-160
if (!result || !('rows' in result) || result.rows.length === 0) { return {totalRows:0, ...} }  // 211
```

失敗が「0件」になる。ただし `dashboard.ts:682-685` が `totalRows === 0` を
`className = 'error'` で表示するため、**異常であることは伝わる**（理由が違うだけ）。
A・B より深刻度は低い。

### D. 1万件での無言の切り捨て

`exportJson/Csv/Markdown` は `limit: 10000` 固定で、`queryLogs` が返す
`total` と**照合していない**。1万件を超えると警告なくエクスポートが欠落する。
PBI-07 で修正したページングと同種の前提である。

## 方針

### 全20関数の Result 型統一は行わない（不採用）

`dashboardSqliteService` の20 export は失敗表現がバラバラだが
（`T|null`、`boolean`、`{success,error}|null`、3分岐 union）、
統一すると `toggleStar` 14箇所・`backupDb` 12箇所・`restoreDb` 12箇所など
**約50箇所**の呼び出し側を書き換えることになる。

本 PBI で確認された実害はすべて `queryLogs` 経由であり、
費用対効果が見合わない。**確認された実害の修正に絞る。**

### 採用する方針

`sqliteHistoryPanel` と同じく「3分岐を区別し、エラーは呼び出し元へ伝える」形に揃える。

## 作業内容

- [ ] `exportLogsService.queryAllData` がエラー時に**throw する**ようにする
      （`exportLogsPanel` の既存 `try/catch` が初めて機能するようになる）
- [ ] 併せて `total > rows.length` のとき**切り捨てが起きたことを伝える**
- [ ] `tagClusterPanel.loadRowsWithRetry` の `?? []` を除去し、
      失敗時は `null` を返してリトライが働くようにする
- [ ] `markdownExport` の2箇所で、エラーと0件を区別する
- [ ] `exportLogsService` の**失敗経路テストを新規追加**する（現在0件）
- [ ] `tagClusterPanel` の**リトライが実際に走ることを検証するテスト**を追加する

## 完了条件

- DB 障害時、エクスポートが「completed」と表示**しない**
- DB 障害時、tagCluster が実際にリトライする
- 1万件超のエクスポートで切り捨てが通知される
- **修正を戻すと新規テストが落ちる**ことを確認する
- `npm run validate` が通る

## 検証（テストの実効性）

PBI-07 の反省（page 0 しか見ておらず `slice(0,20)` が恒等変換になり、
バグを再導入してもテストが通った）を踏まえ、本 PBI でも
「修正を戻す → 赤 → 戻す」の確認を必須とする。

特に B のリトライ検証は、**呼び出し回数**を数えること
（結果だけ見ると `[]` と `[]` で区別がつかない）。

## 参照

- アーキテクチャレビュー 2026-08-09 候補3
- 手本: `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:507-519`
- 前提: [2026-08-09-10](2026-08-09-10-fix-dashboard-sqlite-lasterror-snapshot.md)
  （具体的文言が handler まで届いて初めて、本 PBI が画面まで運ぶ意味を持つ）
