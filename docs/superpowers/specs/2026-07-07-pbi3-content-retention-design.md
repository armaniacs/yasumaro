# PBI-3: content（本文）保存 + 保持ポリシー — 設計書

## 概要

PBI-1 で SQLite `browsing_logs` に `content` カラムを追加したが、パイプラインでは常に `null` を書き込んでいる。本 PBI では (1) パイプラインで content を SQLite に保存し、(2) 保持日数・最大件数に基づいて古い content を NULL にする機能を追加する。レコード自体は削除せず、content カラムのみを NULL にする。

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/storage/types.ts` | `CONTENT_RETENTION_DAYS`, `CONTENT_MAX_RECORDS` キー追加 |
| `src/utils/storage/defaults.ts` | デフォルト値（null）追加 |
| `src/background/pipeline/RecordingPipeline.ts` | `content: data.content \|\| null` を設定 |
| `src/offscreen/sqlite.ts` | `purgeContent()` 関数追加 |
| `src/offscreen/offscreen.ts` | `CONTENT_PURGE` メッセージハンドラ追加 |
| `src/offscreen/opfsWorker.ts` | `handleContentPurge()` 追加 |
| `src/background/sqliteClient.ts` | `purgeContent()` メソッド追加 |
| `src/background/dailyPurgeHandler.ts` | content パージ呼び出し追加 |
| `src/dashboard/dashboard.ts` | General パネルに content 保持設定 UI 追加 |
| i18n: `public/_locales/ja/messages.json`, `public/_locales/en/messages.json` | 新規キー追加 |

## 設定キー

```typescript
// StorageKeys に追加
CONTENT_RETENTION_DAYS: 'content_retention_days',  // number | null
CONTENT_MAX_RECORDS: 'content_max_records',        // number | null
```

Settings インターフェースに追加:

```typescript
[StorageKeys.CONTENT_RETENTION_DAYS]: number | null;
[StorageKeys.CONTENT_MAX_RECORDS]: number | null;
```

デフォルト値: `null`（無制限）

既存の保持ポリシー系キーは `SQLITE_RETENTION_DAYS: 'sqlite_retention_days'` / `SQLITE_MAX_RECORDS: 'sqlite_max_records'`（`src/utils/storage/types.ts:199-200`）で、対象ストア名（sqlite）を接頭辞にしている。本 PBI の `CONTENT_*` は対象カラム名（content）を接頭辞にしており命名軸が異なるが、content は browsing_logs 内の1カラムのみが対象で「ストア全体のパージ」とは性質が違うため区別する意図であれば妥当。

## パイプライン修正

`RecordingPipeline.ts` の `createSaveSqliteStep()` で、BrowsingLogRecord の `content` に `data.content` を設定する:

```typescript
content: data.content || null,  // PBI-3: content を保存
```

PBI-1 で `content: null` と書いた部分を置き換える。content がなければ `data.content` は `undefined` になり `null` が入る。

## content パージ関数

### パターン

既存の `purgeOldRecords()` と同じ 2 段階パターンに従う:
1. `tryOpfsProxy()` で OPFS Worker に委譲（Worker が存在する場合）
2. 直接 DB パスで SQL を実行（Worker が存在しない場合）
3. フォールバックモードはスコープ外

影響行数は SQLite の `changes()` 関数で取得する（既存の `handlePurgeOldRecords` と同じ手法）。

### sqlite.ts — `purgeContent()`

既存の `purgeOldRecords()`（同ファイル内、`execWithCache()` ヘルパーを使用するパターン）に合わせる。`sqlite3!.exec(dbHandle!, sql, params)` や `sqlite3!.changes(dbHandle!)` という直接呼び出しは本プロジェクトには存在しないため使用しない。`changes()` は `SELECT changes()` をSQLとして実行しコールバックで受け取る。

```typescript
export async function purgeContent(
  retentionDays?: number | null,
  maxRecords?: number | null
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ purged: number }>('CONTENT_PURGE', { retentionDays, maxRecords });
    if (opfsResult !== null) return { success: true, purged: opfsResult.purged };

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    let totalPurged = 0;

    // 1. 日数ベース: 古いエントリの content を NULL に
    if (retentionDays != null && retentionDays > 0) {
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      await execWithCache(
        `UPDATE browsing_logs SET content = NULL
         WHERE content IS NOT NULL AND created_at < ? AND is_starred = 0`,
        [cutoffMs]
      );

      let changes1 = 0;
      await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
        changes1 = Number(row[0]);
      });
      totalPurged += changes1;
    }

    // 2. 件数ベース: content を持つエントリが上限を超えたら古いものから NULL に
    if (maxRecords != null && maxRecords > 0) {
      let count = 0;
      await execWithCache(
        `SELECT COUNT(*) FROM browsing_logs WHERE content IS NOT NULL AND is_starred = 0`,
        [],
        (row: SqliteValue[]) => { count = Number(row[0]); }
      );

      if (count > maxRecords) {
        const excess = count - maxRecords;
        await execWithCache(
          `UPDATE browsing_logs SET content = NULL
           WHERE id IN (
             SELECT id FROM browsing_logs
             WHERE content IS NOT NULL AND is_starred = 0
             ORDER BY created_at ASC
             LIMIT ?
           )`,
          [excess]
        );

        let changes2 = 0;
        await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
          changes2 = Number(row[0]);
        });
        totalPurged += changes2;
      }
    }

    return { success: true, purged: totalPurged };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
```

`purgeOldRecords()` と同様、`usingFallbackStorage` の分岐は本 PBI のスコープ外（設計書冒頭の「スコープ外」参照）。呼び出し元（`sqliteClient.ts`）は戻り値が `{success: false}` の場合を考慮すること。

### opfsWorker.ts — `handleContentPurge()`

```typescript
async function handleContentPurge(payload: {
  retentionDays?: number | null;
  maxRecords?: number | null;
}): Promise<{ purged: number }> {
  let totalPurged = 0;

  // 1. 日数ベース
  if (payload.retentionDays != null && payload.retentionDays > 0) {
    const cutoffMs = Date.now() - payload.retentionDays * 24 * 60 * 60 * 1000;
    await sqlExec(
      `UPDATE browsing_logs SET content = NULL
       WHERE content IS NOT NULL AND created_at < ? AND is_starred = 0`,
      [cutoffMs]
    );
    await sqlQuery('SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
  }

  // 2. 件数ベース
  if (payload.maxRecords != null && payload.maxRecords > 0) {
    let count = 0;
    await sqlQuery(
      'SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL AND is_starred = 0',
      [],
      (row) => { count = Number(row.c); }
    );

    if (count > payload.maxRecords) {
      const excess = count - payload.maxRecords;
      await sqlExec(
        `UPDATE browsing_logs SET content = NULL
         WHERE id IN (
           SELECT id FROM browsing_logs
           WHERE content IS NOT NULL AND is_starred = 0
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        [excess]
      );
      totalPurged += excess;
    }
  }

  return { purged: totalPurged };
}
```

## offscreen.ts メッセージハンドラ

既存の `'SQLITE_PURGE'` ハンドラ（`if/else if` チェーン形式、switch/case ではない）に倣う。`purgeContent()` は既に `{success, purged}` または `{success: false, error}` を返すため、そのまま `sendResponse(result)` する（個別の try/catch は不要。外側の共通 catch がある）:

```typescript
// message handler の if/else if チェーン内
} else if (msg.type === 'CONTENT_PURGE') {
  const payload = msg.payload as Record<string, unknown> | undefined;
  const retentionDays = payload?.retentionDays != null ? Number(payload.retentionDays) : undefined;
  const maxRecords = payload?.maxRecords != null ? Number(payload.maxRecords) : undefined;
  const result = await purgeContent(retentionDays, maxRecords);
  sendResponse(result);
```

## sqliteClient.ts

既存 `purgeOldRecords()`（同ファイル259行目）と同じ引数型（`number | undefined`）に合わせる:

```typescript
async purgeContent(
  retentionDays?: number,
  maxRecords?: number
): Promise<{ purged: number } | null> {
  return this.call<{ purged: number }>(
    'CONTENT_PURGE',
    { retentionDays, maxRecords },
    (res) => ({ purged: Number(res.purged || 0) }),
  );
}
```

メッセージタイプ名は既存が `SQLITE_PURGE`（ストア名＋操作）である一方、本 PBI では `CONTENT_PURGE`（対象カラム＋操作）とする。既存の `SQLITE_*` 系メッセージとは命名軸が異なるが、content 専用のパージであることを明示する意図であれば妥当。統一したい場合は `SQLITE_CONTENT_PURGE` も検討可。

## 日次アラームへの統合

`dailyPurgeHandler.ts` の既存 `PurgeFn` は `(retentionDays?: number, maxRecords?: number) => Promise<{ purged: number } | null>` であり、`null` は受け取らず `undefined` を使う（既存コードは `days !== null ? days : undefined` で変換してから渡している）。`ContentPurgeFn` もこのシグネチャに合わせ、呼び出し側で同様の `null → undefined` 変換を行う:

```typescript
// 型: PurgeFn と同じ形で ContentPurgeFn を追加（number | undefined、number | null ではない）
type ContentPurgeFn = (
  retentionDays?: number,
  maxRecords?: number
) => Promise<{ purged: number } | null>;

export async function handleDailyPurgeAlarm(
  purgeOldRecords: PurgeFn,
  purgeContent: ContentPurgeFn
): Promise<void> {
  // ... 既存のレコードパージ ...

  // content パージ
  const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
  const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS] ?? null;
  if (contentDays !== null || contentMax !== null) {
    const result = await purgeContent(
      contentDays !== null ? contentDays : undefined,
      contentMax  !== null ? contentMax  : undefined,
    );
    logInfo('daily-content-purge completed', {
      purged: result?.purged ?? 0,
    }, 'dailyPurgeHandler');
  }
}
```

Service Worker 側の呼び出し元も更新:

```typescript
// service-worker.ts
handleDailyPurgeAlarm(
  (days, max) => sqliteClient.purgeOldRecords(days, max),
  (days, max) => sqliteClient.purgeContent(days, max),
);
```

## ダッシュボード UI

General パネルの「保持ポリシー」セクションに「コンテンツ保持設定」サブセクションを追加:

```
=== 保持ポリシー ===
レコード保持日数: [無制限 | 30日 | 90日 | 180日 | 365日]
最大レコード件数: [無制限 | 1,000 | 10,000 | 100,000]
「今すぐ削除を実行」

=== コンテンツ保持設定 ===
content（本文）保持日数: [無制限 | 7日 | 30日 | 90日 | 180日]
content（本文）最大保持件数: [無制限 | 100 | 500 | 1,000 | 10,000]
「今すぐ content を削除」
```

### 設定値の読み取り・保存

```typescript
// dashboard.ts — settings mapping
[StorageKeys.CONTENT_RETENTION_DAYS]: el.contentRetentionDaysSelect,
[StorageKeys.CONTENT_MAX_RECORDS]: el.contentMaxRecordsSelect,

// 保存前の値の変換（既存の保持ポリシーと同様）
const contentDaysRaw = newSettings[StorageKeys.CONTENT_RETENTION_DAYS];
newSettings[StorageKeys.CONTENT_RETENTION_DAYS] =
  contentDaysRaw === '' || contentDaysRaw === undefined ? null : Number(contentDaysRaw);
const contentMaxRaw = newSettings[StorageKeys.CONTENT_MAX_RECORDS];
newSettings[StorageKeys.CONTENT_MAX_RECORDS] =
  contentMaxRaw === '' || contentMaxRaw === undefined ? null : Number(contentMaxRaw);
```

### 手動 content パージボタン

General パネルの「今すぐ content を削除」ボタン:

```typescript
// ボタンのイベントハンドラ
el.contentPurgeNowBtn.addEventListener('click', async () => {
  const settings = await getSettings();
  const retentionDays = settings[StorageKeys.CONTENT_RETENTION_DAYS];
  const maxRecords = settings[StorageKeys.CONTENT_MAX_RECORDS];
  if (retentionDays === null && maxRecords === null) {
    // 「無制限なので content は削除されません」と表示
    return;
  }
  // Service Worker にメッセージを送信
  const result = await chrome.runtime.sendMessage({
    type: 'CONTENT_PURGE_NOW',
    retentionDays,
    maxRecords,
  });
  // 削除件数を表示
});
```

Service Worker 側に `CONTENT_PURGE_NOW` ハンドラを追加:

```typescript
case 'CONTENT_PURGE_NOW': {
  const { retentionDays, maxRecords } = message;
  const result = await sqliteClient.purgeContent(retentionDays, maxRecords);
  sendResponse({ success: true, purged: result?.purged ?? 0 });
  break;
}
```

## テスト計画

| テスト種別 | 対象 | 内容 |
|-----------|------|------|
| 単体 | `purgeContent()` | 日数ベース・件数ベースのパージロジック |
| 単体 | 設定キー | `CONTENT_RETENTION_DAYS` / `CONTENT_MAX_RECORDS` のデフォルト値と型 |
| 統合 | `dailyPurgeHandler` | content パージ呼び出しの有無（設定値に応じて） |
| 統合 | Dashboard UI | セレクトボックスの値→設定値変換 |
| E2E | パイプライン | content が SQLite に保存されること |

## スコープ外

- ダッシュボード SQLite 履歴パネルでの content 表示トグル（PBI-2）
- FTS5 検索対象に content を含めるかどうか（含めない）

---

## 深掘りセッション — 2026-07-07

### 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| offscreen.ts INSERT/INSERT_BATCH ハンドラが BrowsingLogRecord の全フィールドを素通ししている | 高 | PBI-1 で21カラム追加したが、offscreen.ts の INSERT ハンドラ（195-216行目）は古い10カラムのみを取り出して新規オブジェクトを構築している。PBI-1 の Pipeline で設定した metadata フィールドは offscreen 経路で全て消失する。PBI-3 の content も同様に消失する | PBI-3 に含めて修正する。明示的マッピングを全フィールドに拡張（現在のパターンを維持） |
| purgeContent() の is_starred=0 条件を hard-code する | 中 | PBI 計画書では「オプション、ユーザー判断」としているが、設計書では固定条件として記述 | 設定可能なチェックボックスにする。デフォルト ON（保護する）。キー名候補: `CONTENT_PURGE_INCLUDE_STARRED`（スター付きも削除対象にする） |
| フォールバックストレージの content パージはスコープ外 | 高 | 既存の purgeOldRecords() は `usingFallbackStorage` の分岐を持ちフォールバック時も動作する。PBI-3 で content 保存のみ実装しフォールバックパージを実装しないと、フォールバック利用時に content が蓄積し続ける。また storageFallback.ts の insert は content や PBI-1 メタデータを保存していない | フル対応: storageFallback.ts の insert/insertBatch で全メタデータ + content を保存するよう拡張し、purgeContent() も実装する |

### 新たに発見したリスク

1. **offscreen.ts INSERT 素通しバグ（PBI-1 の見落とし）**: Pipeline から sqliteClient.insert() を通じて送信された全フィールドが、offscreen.ts の INSERT ハンドラで消失する。PBI-1 の Pipeline 変更は offscreen 経路では実質無効。PBI-3 で修正しない限り content 保存も機能しない
2. **storageFallback.ts のフィールド欠落**: PBI-1 で sqlite.ts と opfsWorker.ts は更新されたが、storageFallback.ts の insert/insertBatch は更新されていない。content 保存とパージの一貫性を保つには storageFallback 全体のフィールド拡張が必要
3. **パフォーマンスリスク**: purgeContent() は2段階の UPDATE（日数ベース + 件数ベース）を逐次実行する。`content IS NOT NULL AND is_starred = 0` のレコードが 10 万件を超える場合、UPDATE × 2 + COUNT × 1 + SELECT changes() × 2 の合計5クエリが同期的に実行され DB ロック時間が長くなる。ただし既存の purgeOldRecords() も同様のパターンであるため、新規リスクではない
4. **content が空文字の場合**: 設計書の `data.content || null` は、空文字列 `""` を `null` に変換する（falsy）。空の content を保存しないという意図であれば妥当だが、空の記事か未取得かを区別できなくなる

### 決定事項

1. **offscreen.ts の INSERT/INSERT_BATCH ハンドラを全フィールド対応に拡張する**（明示的マッピング、現在のパターンを維持）
2. **is_starred 除外条件を設定可能なチェックボックスにする**（デフォルト: ON = スター付きを保護）。ストレージキー: `CONTENT_PURGE_INCLUDE_STARRED`（`boolean`、デフォルト `false` = 保護する）。UI は「スター付きエントリの content も削除対象にする」チェックボックス
3. **storageFallback.ts に全メタデータ + content 保存を追加し、purgeContent() を実装する**
4. ストレージキーの命名: `CONTENT_*`（対象カラム名を接頭辞）を維持。`SQLITE_CONTENT_PURGE` 等への変更は行わない
5. フォールバック時の `usingFallbackStorage` 分岐パターンは既存の purgeOldRecords() に合わせる

### 設計書への追加変更点

1. **変更対象ファイル**に `src/offscreen/storageFallback.ts` を追加する
2. **追加のストレージキー**: `CONTENT_PURGE_INCLUDE_STARRED`（`boolean`、デフォルト `false`）
3. **オフスクリーン INSERT ハンドラの全フィールドマッピング**を本 PBI のスコープに含める
4. **スコープ外**からフォールバックストレージの content パージを削除する（スコープ内に変更）

### 未解決の疑問

- storageFallback.ts へのメタデータ保存追加は、chrome.storage.local の 5MB クォータに影響する。content（最大64KB/エントリ）が保存されることで、フォールバック利用時にクォータ超過が発生しやすくなる。回避策として content 保存時にサイズチェックを行うかどうかは未決定
- `CONTENT_PURGE_INCLUDE_STARRED` のチェックボックスを content 保持設定セクション内のどこに配置するかは UI 実装時に判断

### 出典コード位置

- `src/offscreen/offscreen.ts:195-216` — INSERT ハンドラ（10カラムのみ）
- `src/offscreen/sqlite.ts:1175-1240` — purgeOldRecords()（パージパターン）
- `src/offscreen/storageFallback.ts:38-106` — insert/insertBatch（10カラムのみ）
- `src/background/dailyPurgeHandler.ts:1-29` — 現在の dailyPurgeHandler（単一 PurgeFn）
- `src/background/dashboardSqliteHandlers.ts:204-216` — purge_now ハンドラパターン
