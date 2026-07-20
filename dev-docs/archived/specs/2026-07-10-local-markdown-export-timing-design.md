# ローカル Markdown 書き出しタイミング選択 — 設計書

## 背景

PBI `2026-07-09-03-feat-local-markdown-idle-export` により、ローカル Markdown 書き出しは「録画のたびにダウンロード」から「アイドル時 / 30分ごとに1日分をまとめてダウンロード」に変更された。この変更で連打・O(n²) 再ダウンロード問題は解消したが、動作確認時に「最大30分待たないと結果が見えない」ため、ユーザーが挙動を確認しづらいという新たな不満が生じた。

本設計では、書き出しタイミングをユーザーが選べる4択に拡張する。

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/storage/types.ts` | `LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED` を廃止し `LOCAL_MARKDOWN_EXPORT_TIMING` を追加 |
| `src/utils/storage/defaults.ts` | `LOCAL_MARKDOWN_EXPORT_TIMING: 'idle'` を追加 |
| `src/utils/storage.ts` | `getSettings()` に `AUTO_ENABLED` → `TIMING` の一回限りマイグレーションを追加 |
| `src/background/pipeline/steps/saveLocalMarkdownStep.ts` | バッファ追記後、`TIMING === 'immediate'` のときデバウンスアラームを予約 |
| `src/background/localMarkdownExportCore.ts`（新規） | `chrome.downloads.download` を呼ぶ共通フラッシュ処理を抽出 |
| `src/background/localMarkdownIdleFlusher.ts` | `initIdleFlush()` → `initExportScheduler()` に改称し、`TIMING` に応じてリスナー/アラームを出し分け。日次フラッシュ処理を追加 |
| `src/background/service-worker.ts` | `initIdleFlush()` 呼び出しを `initExportScheduler()` に置換 |
| `src/dashboard/dashboard.ts` | チェックボックス1個の読み書きをラジオボタン4択の読み書きに変更 |
| `entrypoints/options/index.html` | `localMarkdownExportAutoEnabled` チェックボックスをラジオボタン群に置換 |
| i18n: `public/_locales/{ja,en}/messages.json` | 新規ラベル・ヘルプテキストのキー追加、既存ヘルプテキストの実態修正 |

## 設定キー

```typescript
// StorageKeys に追加
LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
```

```typescript
// Settings インターフェースに追加
[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]: 'manual' | 'immediate' | 'idle' | 'daily';
```

デフォルト値: `'idle'`（現行動作を維持）

`LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED`（真偽値）は削除する。既存ユーザーの値は `getSettings()` 内で一度だけ次のルールに変換し、`LOCAL_MARKDOWN_EXPORT_TIMING` が未設定の場合のみ書き込む。

| 旧 `AUTO_ENABLED` | 新 `TIMING` |
|---|---|
| `true` | `'idle'` |
| `false` | `'manual'` |

## モード仕様

| モード | 挙動 |
|---|---|
| `manual` | バッファには追記するが自動ダウンロードは一切行わない。既存のエクスポート/インポート画面から手動取得は可能 |
| `immediate` | 記録直後、進行中のデバウンス予約がなければ60秒後の単発アラームを1件予約。発火時にその時点のバッファ全体を1回でフラッシュ（複数記録が1分間に集中しても1回にまとまる） |
| `idle`（デフォルト） | 現行動作を維持。`chrome.idle.onStateChanged` が `idle` を検知、または30分ごとのフォールバックアラームでフラッシュ |
| `daily` | 日付が変わったタイミング（翌日0:00起点、以降24時間ごと）で前日分のバッファのみフラッシュ |

`idle` と `daily` は排他（同時に両方は動かない）。ユーザーがモードを切り替えるたびに、旧モードのアラームは新モード登録前にクリアする。

## バックエンド設計

### 共通フラッシュ処理の抽出

現行 `localMarkdownIdleFlusher.ts` の `flushPendingExports()` は「バッファを全走査して当日以外も含め全部フラッシュ」する実装だが、`daily` モードは「前日分のみ」を対象にする必要がある。共通コアに対象日付フィルタを渡せるようにする。

```typescript
// src/background/localMarkdownExportCore.ts
export async function flushBufferedExports(
  filter?: (date: string) => boolean
): Promise<void> {
  const settings = await getSettings();
  const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
  const all = await chrome.storage.local.get();

  for (const key of Object.keys(all)) {
    if (!key.startsWith(DAILY_BUFFER_PREFIX)) continue;
    const date = key.slice(DAILY_BUFFER_PREFIX.length);
    if (filter && !filter(date)) continue;

    const entries = all[key];
    if (!Array.isArray(entries) || entries.length === 0) continue;

    const content = buildDailyMarkdown(date, entries);
    const dataUrl = `data:text/markdown;base64,${btoa(unescape(encodeURIComponent(content)))}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename: `${exportPath}/${date}.md`,
      saveAs: false,
      conflictAction: 'overwrite',
    });
  }
}
```

- `idle` モードのフラッシュ: `flushBufferedExports()`（フィルタなし、全バッファ対象。現行動作を維持）
- `daily` モードのフラッシュ: `flushBufferedExports(date => date === getYesterdayDateString())`
- `immediate` モードのフラッシュ: `flushBufferedExports()`（フィルタなし。デバウンス発火時点の全バッファを対象。immediate 使用時は通常その日のバッファしか存在しないため実質的に当日分のみになる）

バッファは flush 後もクリアしない（既存方針を踏襲。未フラッシュ検知の単純化と、`conflictAction: 'overwrite'` による重複書き出し吸収を優先）。

### `saveLocalMarkdownStep.ts` の変更

```typescript
// バッファ追記後
if (localExportEnabled) {
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING];
  if (timing === 'immediate') {
    const alarm = await chrome.alarms.get(IMMEDIATE_FLUSH_ALARM);
    if (!alarm) {
      chrome.alarms.create(IMMEDIATE_FLUSH_ALARM, { delayInMinutes: 1 });
    }
  }
}
```

`chrome.alarms.get()` で既存予約の有無を確認してから作成することで、1分間のデバウンス（複数回の記録を1回のフラッシュにまとめる）を実現する。

### `localMarkdownIdleFlusher.ts` → `initExportScheduler()`

```typescript
export async function initExportScheduler(): Promise<void> {
  // 前のモードのアラームを掃除してから、現在のモードのものだけを登録する
  chrome.alarms.clear(IDLE_FALLBACK_ALARM);
  chrome.alarms.clear(DAILY_FLUSH_ALARM);

  const settings = await getSettings();
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING];

  if (timing === 'idle') {
    chrome.alarms.create(IDLE_FALLBACK_ALARM, { periodInMinutes: 30 });
    if (chrome.idle) {
      chrome.idle.onStateChanged.addListener((state) => {
        if (state === 'idle') void flushBufferedExports();
      });
    }
  } else if (timing === 'daily') {
    chrome.alarms.create(DAILY_FLUSH_ALARM, {
      when: getNextMidnightTimestamp(),
      periodInMinutes: 1440,
    });
  }
  // 'manual' と 'immediate' は常設のリスナー/アラームを必要としない
}
```

`chrome.idle.onStateChanged.addListener` は一度登録すると `removeListener` しない限り残るが、Service Worker はエフェメラルで起動のたびにモジュールの状態がリセットされるため実害はない（現行実装と同じ前提）。

### `chrome.alarms.onAlarm` ハンドラの分岐（`service-worker.ts`）

```typescript
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === IDLE_FALLBACK_ALARM) void flushBufferedExports();
  if (alarm.name === DAILY_FLUSH_ALARM) void flushBufferedExports(date => date === getYesterdayDateString());
  if (alarm.name === IMMEDIATE_FLUSH_ALARM) void flushBufferedExports();
});
```

## UI設計

`entrypoints/options/index.html` の「ローカル MARKDOWN 書き出し」セクションを次の構造に変更する。

```html
<input type="checkbox" id="localMarkdownExportEnabled">
<label for="localMarkdownExportEnabled">ローカル Markdown に書き出す</label>

<div id="localMarkdownExportSettings" class="hidden">
  <p>書き出しタイミング</p>
  <input type="radio" name="localMarkdownExportTiming" id="timingManual" value="manual">
  <label for="timingManual">手動のみ（自動書き出ししない）</label>

  <input type="radio" name="localMarkdownExportTiming" id="timingImmediate" value="immediate">
  <label for="timingImmediate">即時（記録直後、最短1分間隔）</label>

  <input type="radio" name="localMarkdownExportTiming" id="timingIdle" value="idle">
  <label for="timingIdle">アイドル時 / 30分ごと</label>

  <input type="radio" name="localMarkdownExportTiming" id="timingDaily" value="daily">
  <label for="timingDaily">日付が変わったとき（前日分を回収）</label>
</div>
```

- 親チェックボックスOFF時は `#localMarkdownExportSettings` ごと非表示にする（既存の表示制御ロジックを流用）
- 「アイドル時 / 30分ごと」のヘルプテキストは「ページが記録されるたびに自動ダウンロードします」という現状と矛盾する文言を、実態（アイドル時または30分ごとにまとめて書き出す）に修正する

`dashboard.ts` の読み書きロジックは、チェックボックス1個の `.checked` 読み書きから、`name="localMarkdownExportTiming"` のラジオグループの選択値読み書きに変更する。

## 副作用・エッジケース

- モード切替の反映は Service Worker 起動時（`initExportScheduler()` 呼び出し時）に限られる。設定保存直後に即座にアラームを切り替えたい場合は、`dashboard.ts` の保存処理から `chrome.runtime.sendMessage` 経由で `initExportScheduler()` の再実行をトリガーする（バックグラウンドとダッシュボードは別コンテキストのため）
- `immediate` モードで発火直前にブラウザが閉じられた場合、次回起動時にバッファは残っているため、次の記録時またはモードが `idle`/`daily` に変わった際の定期フラッシュで回収される（データロストはない）
- 既存の `LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED` を参照しているテストは `LOCAL_MARKDOWN_EXPORT_TIMING` を使うよう更新する

## テスト戦略

### 単体テスト
- `saveLocalMarkdownStep`: `timing='immediate'` かつ既存アラーム無し → アラーム作成；既存アラームあり → 作成スキップ；`timing='idle'/'daily'/'manual'` → アラーム作成なし
- `initExportScheduler`: 各 `timing` 値ごとに正しいアラーム/リスナーのみが登録され、他方はクリアされること
- `flushBufferedExports`: フィルタなし → 全バッファ対象；`date => date === 昨日` → 前日分のみ対象
- マイグレーション: `AUTO_ENABLED=true` → `TIMING='idle'` に変換；`AUTO_ENABLED=false` → `TIMING='manual'`；`TIMING` 既存時は上書きしない

### 統合テスト
- `immediate` モードで2回連続記録 → ダウンロードは1回だけ発火すること（デバウンス確認）
- `daily` モードでアラーム発火 → 前日分のみダウンロードされ、当日分は対象外であること

## Definition of Done
- [ ] 全ユニット/統合テストが実装されパスする
- [ ] 4モードそれぞれで正しいタイミング・対象範囲でダウンロードされる
- [ ] 既存 `AUTO_ENABLED` ユーザーが `idle` モードに自動移行される
- [ ] UIのヘルプテキストが実態と一致する
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載
