# Yasumaro のプライバシー保護はどう動いているか — PII マスキングから毎日削除までの全体像

[日本語](#日本語) | [English](#english)

---

## 日本語

Web ページを AI に送って要約する拡張機能にとって、いちばん気になるのは「自分の個人情報はどこへ行くのか」という点だと思います。Yasumaro は「閲覧したページの内容」をそのままクラウドに送るのではなく、**個人を特定できる情報（PII: Personally Identifiable Information）を複数の層で守る**仕組みを持っています。

この記事では、実際のソースコードを端から端まで辿って、その仕組みがどう動いているかを順を追って解説します。コードを読まない人でも「いつ・何が・どう守られるか」がわかるように書きました。

- 第 1 章: PII マスキングとはそもそも何か
- 第 2 章: 記録パイプラインでいつ呼ばれるか
- 第 3 章: 同意と保持期間がどうゲートしているか
- 第 4 章: 毎日の自動削除がどう実行されるか

---

### 第 1 章: PII マスキングとは何か

**PII（個人を特定できる情報）** とは、メールアドレス・電話番号・クレジットカード番号・マイナンバー・銀行口座といった、そのまま外部に出すとまずい情報のことです。Yasumaro は、記録したページ内容を AI 要約や Obsidian 保存に渡す**前**に、これらを伏せ字にする層として PII マスキングを持っています。

実装は 2 つのファイルに分かれています。

| ファイル | 役割 |
| :--- | :--- |
| `src/utils/piiSanitizer.ts` | 正規表現で PII を検出し `[MASKED]` に置換。マスク結果を `MaskedItem` として保持 |
| `src/utils/piiStripper.ts` | マスク済みアイテムから、元の生データ（`original` フィールド）を完全に削除 |

`piiSanitizer.ts` は、単なる置換以上の工夫をしています。例えばクレジットカード番号は Luhn 検証（カード番号のチェックディジット）を通してからマスクし、誤検出を減らしています。また **ReDoS（正規表現によるサービス拒否）対策** として、入力サイズ制限（64KB）・マッチ件数上限（1000 件）・タイムアウト（5 秒）を設けています。これは「長い文章を処理するときに、悪意ある文字列で処理が固まらないようにする」ための防御です。

そして重要なのが、**プライバシーモード（Privacy Mode）との連動** です。Yasumaro には 4 つのモードがあります。

| モード | ステータス | 動作 |
| :--- | :--- | :--- |
| A: Local Only | 開発中 | 完全ローカル処理 |
| B: Full Pipeline | 開発中 | ローカル要約 + クラウド仕上げ |
| **C: Masked Cloud** | **推奨** | **PII をマスクしてからクラウドへ送信** |
| D: Cloud Only | - | 生データをそのままクラウド送信 |

デフォルトでは **Mode C（Masked Cloud）** が使われます。つまり PII マスキングの主目的は、「クラウドの AI に送る前に、個人情報を伏せ字にしておく」ことにあります。

さらに Yasumaro はこれを **2 層のプライバシー保護（Two-Layer Privacy Protection）** として設計しています。

- **層 1: Private Page Detection** — HTTP レスポンスヘッダを解析し、「これはプライベートなページ（銀行のログイン後画面など）だ」と判定する
- **層 2: PII マスキング** — ページ内容から個人情報そのものを伏せ字にする

どちらかが「プライベート」と判定すれば、記録は止まります。

---

### 第 2 章: 記録パイプラインでいつ呼ばれるか

では、このマスキングが実際に「いつ」走るのか。答えは、**記録処理の本体である `RecordingPipeline` の途中** です。

`src/background/pipeline/RecordingPipeline.ts` は、記録処理をいくつかのステップに分けて実行します。その中に `processPrivacyPipelineStep`（プライバシー処理ステップ）があり、ここから `src/background/privacyPipeline.ts` の `PrivacyPipeline` を呼び出します。

`PrivacyPipeline.process()` の内部は、大きく 3 つの層（L1〜L3）に分かれています。

```
L1: ローカル要約（Local AI が使える場合）
L2: PII マスキング ← ここで sanitizeRegex() を呼ぶ
L3: クラウド要約（AI プロバイダへ送信）
```

Mode C のとき、`_buildSanitizedSettings()` が `useMasking: true` を返すので、L2 の `sanitizeRegex()` が実行されて PII が伏せ字になります。そして L3 では「マスク済みの文章」が AI に送られます。つまり **生データがクラウドへ出ることはありません**。

加えて、マスキングはもう 2 つの場所からも呼ばれます。

1. **記録結果の確定時** — `RecordingPipeline.execute()` の最後で、`stripPiiFromMaskedItems()` が呼ばれます。これは「マスクした結果（置換後の文字列）」は残しておくものの、**元の生データ（`original` フィールド）を完全に削除する** 処理です。`piiStripper.ts` が担っています。「伏せ字にしたけど、念のため元データもメモリに残さない」という多層防御です。
2. **手動記録のとき** — ポップアップの「今すぐ記録」など手動経路では、`manualContentFetcher.ts` の `sanitizeContent()` がコンテンツ取得直後に `piiSanitizer.sanitizeRegex()` を呼び、取得した瞬間にマスクします。

---

### 第 3 章: 同意と保持期間がどうゲートしているか

ここまで読むと「マスクしてくれるなら、いつでも記録されてるの？」と思うかもしれません。そうではありません。**マスキングよりも前に「ユーザーの同意」という最前線のゲート** があります。

`src/popup/privacyConsent.ts` の `hasPrivacyConsent()` が同意状態を返し、バックグラウンド側の `service-worker.ts` は記録を始める前にこれを直接チェックします。

```ts
// service-worker.ts より（複数箇所）
isRecordingAllowed: () => hasPrivacyConsent(),
```

つまり、**同意していない状態では、記録自体が始まらない** ので、PII マスキングの処理にすら進みません。初回起動時やポリシー改定時には同意モーダルが表示され、拒否すれば記録は止まります。

これらは Yasumaro の中で **「Content Privacy-by-Design（Sanitize + Consent + Retention）」** というひとつの概念に束ねられています。

- **Sanitize**: PII マスキング（第 1・2 章）
- **Consent**: ユーザーの同意（この章）
- **Retention**: 保持期間と自動削除（次章）

また、ツールバーのバッジ表示（`consentBadge.ts`）も `hasPrivacyConsent()` を呼んでおり、同意状態が視覚的にわかるようになっています。

---

### 第 4 章: 毎日の自動削除がどう実行されるか

マスクしていても、長期間ため込めば「いつか復元されるかもしれないデータ」が残り続けます。だから Yasumaro は、**保持期間を過ぎた記録を毎日自動で物理削除** します。

中心になるのは `src/background/dailyPurgeHandler.ts` の `handleDailyPurgeAlarm()` です。Chrome のアラームで毎日起動し、以下のように動きます。

```ts
const settings = await getSettings();

// レコード単位の削除
const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]   ?? null;
if (days !== null || max !== null) {
  await purgeOldRecords(days ?? undefined, max ?? undefined);
}

// 内容単位の削除（PBI-3）
const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS] ?? null;
if (contentDays !== null || contentMax !== null) {
  await purgeContent(contentDays ?? undefined, contentMax ?? undefined, includeStarred);
}
```

注目すべきは、**`handleDailyPurgeAlarm()` は直接 `purgeOldRecords()` を呼んでいない** ことです。まず `getSettings()` で保持期間の設定値を読み出し、その値を `opfsWorker` 経由の `handlePurgeOldRecords()` → `sqlExec()` へ渡します。実際の DELETE 文は OPFS 上の SQLite に対して発行されます。

そして「どの保存層を消すか」は、現在選択されている **StorageBackend** 次第です。Yasumaro は環境に応じて 3 つのバックエンドを使い分けます（OPFS 優先 → IDB → Fallback）。

| Backend | 役割 |
| :--- | :--- |
| `OpfsWorkerBackend` | OPFS 上の SQLite（通常ここが使われる） |
| `IdbVfsBackend` | OPFS が使えない環境での IndexedDB VFS |
| `FallbackStorageAdapter` | 最終手段の `chrome.storage.local` |

どの環境でも `StorageBackend` という同じ抽象を `implements` しているため、上位の削除処理は「今選ばれているバックエンドの `purgeOldRecords()` を呼ぶ」だけで済みます。

保持期間の設定値そのものは、**Dashboard の retention-settings**（`src/dashboard/`）からユーザーが変更でき、既定値は `src/utils/storageSettings.ts` の `DEFAULT_SETTINGS` にあります。運用上の目安として「30〜365 日 / 1,000〜100,000 件」の範囲が想定されています。両方が `null`（未設定）のときは削除をスキップし、無制限保持となります。

---

### まとめ: 4 層の防御

全体を図にすると、こうなります。

```
[ユーザー同意]  hasPrivacyConsent()  ← 最前線ゲート（なければ記録自体しない）
      │
[記録パイプライン]
  ├ processPrivacyPipelineStep → PrivacyPipeline.process()
  │     Mode C のとき sanitizeRegex() で PII マスク   ← 層2
  └ execute() → stripPiiFromMaskedItems() で元データ削除
      │
[毎日アラーム]
  handleDailyPurgeAlarm() → getSettings() で保持期間を取得
      → opfsWorker 経由で選択中 StorageBackend の古いレコードを物理削除
```

| 層 | 処理 | コード |
| :--- | :--- | :--- |
| 1. 同意 | 記録前の最前線ゲート | `hasPrivacyConsent()` |
| 2. マスク | クラウド送信前に PII を伏せ字 | `PrivacyPipeline` → `sanitizeRegex()` |
| 3. 除去 | 記録確定時に元データを削除 | `stripPiiFromMaskedItems()` |
| 4. 削除 | 保持期間超過分を毎日物理削除 | `handleDailyPurgeAlarm()` → `purgeOldRecords()` |

「同意 → マスク → 除去 → 自動削除」——この 4 段階が、`Content Privacy-by-Design` というひとつの設計思想のもとで繋がっているのが、Yasumaro のプライバシー保護の全貌です。

---

## English

For a browser extension that sends your browsing history to an AI for summarization, the biggest concern is usually: "Where does my personal information go?" Yasumaro does not ship raw page content to the cloud. Instead, it protects **Personally Identifiable Information (PII)** through multiple layers.

This article walks through the actual source code, end to end, to explain how that protection works. It is written so that even non-developers can understand *when, what, and how* their data is protected.

- Chapter 1: What PII masking actually is
- Chapter 2: When it is invoked in the recording pipeline
- Chapter 3: How consent and retention gate it
- Chapter 4: How daily automatic deletion runs

---

### Chapter 1: What is PII Masking

**PII (Personally Identifiable Information)** means data that can identify a person — email addresses, phone numbers, credit card numbers, My Number, bank accounts, and so on. Yasumaro has a PII masking layer that replaces these with placeholders *before* the content is sent to AI summarization or saved to Obsidian.

The implementation lives in two files.

| File | Role |
| :--- | :--- |
| `src/utils/piiSanitizer.ts` | Detects PII via regex and replaces it with `[MASKED]`; keeps the result as a `MaskedItem` |
| `src/utils/piiStripper.ts` | Strips the original raw data (`original` field) from masked items entirely |

`piiSanitizer.ts` does more than simple replacement. Credit card numbers, for example, are validated with the Luhn algorithm before masking to reduce false positives. It also defends against **ReDoS (Regular expression Denial of Service)** with an input size cap (64KB), a match-count limit (1000), and a 5-second timeout — so a malicious string cannot freeze processing.

Crucially, masking is tied to the **Privacy Mode**. Yasumaro has four modes.

| Mode | Status | Behavior |
| :--- | :--- | :--- |
| A: Local Only | in development | Fully local processing |
| B: Full Pipeline | in development | Local summary + cloud finish |
| **C: Masked Cloud** | **recommended** | **Masks PII, then sends to cloud** |
| D: Cloud Only | - | Sends raw data to cloud as-is |

By default, **Mode C (Masked Cloud)** is used. So the main purpose of PII masking is: "mask personal information *before* sending it to the cloud AI."

Yasumaro designs this as **Two-Layer Privacy Protection**.

- **Layer 1: Private Page Detection** — analyzes HTTP response headers to flag a page as private (e.g. a post-login banking screen)
- **Layer 2: PII Masking** — masks the personal information in the page content itself

If either layer judges the page private, recording stops.

---

### Chapter 2: When is it invoked in the recording pipeline

So when does the masking actually run? The answer is **midway through `RecordingPipeline`**, the core of recording.

`src/background/pipeline/RecordingPipeline.ts` runs recording as a sequence of steps. One of them, `processPrivacyPipelineStep`, calls `PrivacyPipeline` in `src/background/privacyPipeline.ts`.

Inside `PrivacyPipeline.process()`, there are three layers (L1–L3).

```
L1: Local summarization (if a local AI is available)
L2: PII masking  ← calls sanitizeRegex() here
L3: Cloud summarization (sent to the AI provider)
```

In Mode C, `_buildSanitizedSettings()` returns `useMasking: true`, so L2's `sanitizeRegex()` runs and masks PII. Then in L3, the *masked* text is what gets sent to the AI. So **raw data never leaves for the cloud**.

Masking is also called from two other places.

1. **When the recording result is finalized** — at the end of `RecordingPipeline.execute()`, `stripPiiFromMaskedItems()` is called. It keeps the masked result (the replaced string) but **fully removes the original raw data** via `piiStripper.ts`. "Mask it, but don't even keep the original in memory" — defense in depth.
2. **For manual recording** — the manual path (e.g. "Record now" in the popup) calls `sanitizeContent()` in `manualContentFetcher.ts`, which invokes `piiSanitizer.sanitizeRegex()` immediately after fetching content.

---

### Chapter 3: How consent and retention gate it

Reading this far, you might wonder: "If it masks for me, is it always recording?" No. **Before masking, there is a front-line gate: user consent.**

`hasPrivacyConsent()` in `src/popup/privacyConsent.ts` reports consent state, and the background `service-worker.ts` checks it directly before starting any recording.

```ts
// from service-worker.ts (several places)
isRecordingAllowed: () => hasPrivacyConsent(),
```

So **without consent, recording never starts** — it never even reaches the masking step. On first launch or policy change, a consent modal appears; declining stops recording.

These pieces are bound together under one concept in Yasumaro: **"Content Privacy-by-Design (Sanitize + Consent + Retention)."**

- **Sanitize**: PII masking (Chapters 1–2)
- **Consent**: user consent (this chapter)
- **Retention**: retention period and auto-deletion (next chapter)

The toolbar badge (`consentBadge.ts`) also calls `hasPrivacyConsent()`, so consent state is visible at a glance.

---

### Chapter 4: How daily auto-deletion runs

Even masked, hoarding data long-term means "recoverable data" lingers. So Yasumaro **physically deletes records past their retention period, automatically, every day.**

The core is `handleDailyPurgeAlarm()` in `src/background/dailyPurgeHandler.ts`. Triggered daily by a Chrome alarm, it works like this.

```ts
const settings = await getSettings();

// Record-level purge
const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]   ?? null;
if (days !== null || max !== null) {
  await purgeOldRecords(days ?? undefined, max ?? undefined);
}

// Content-level purge (PBI-3)
const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS] ?? null;
if (contentDays !== null || contentMax !== null) {
  await purgeContent(contentDays ?? undefined, contentMax ?? undefined, includeStarred);
}
```

Note an important detail: **`handleDailyPurgeAlarm()` does not call `purgeOldRecords()` directly.** It first reads the retention settings via `getSettings()`, then passes those values through `opfsWorker`'s `handlePurgeOldRecords()` → `sqlExec()`, which issues the actual DELETE against the SQLite database on OPFS.

And **which storage layer gets purged** depends on the currently selected **StorageBackend**. Yasumaro picks one of three backends by environment (OPFS preferred → IDB → Fallback).

| Backend | Role |
| :--- | :--- |
| `OpfsWorkerBackend` | SQLite on OPFS (normally used) |
| `IdbVfsBackend` | IndexedDB VFS when OPFS is unavailable |
| `FallbackStorageAdapter` | last-resort `chrome.storage.local` |

Because all implement the same `StorageBackend` abstraction, the deletion logic only needs to "call `purgeOldRecords()` on the selected backend."

The retention values themselves are editable from the **Dashboard's retention-settings** (`src/dashboard/`), with defaults in `DEFAULT_SETTINGS` of `src/utils/storageSettings.ts`. The intended range is "30–365 days / 1,000–100,000 records." When both values are `null` (unset), purge is skipped for unlimited retention.

---

### Summary: Four layers of defense

The whole picture looks like this.

```
[User consent]  hasPrivacyConsent()  ← front-line gate (no consent, no recording)
      │
[Recording pipeline]
  ├ processPrivacyPipelineStep → PrivacyPipeline.process()
  │     Mode C masks PII via sanitizeRegex()        ← layer 2
  └ execute() → stripPiiFromMaskedItems() drops original data
      │
[Daily alarm]
  handleDailyPurgeAlarm() → getSettings() reads retention
      → opfsWorker → purges old records on the selected StorageBackend
```

| Layer | Process | Code |
| :--- | :--- | :--- |
| 1. Consent | front-line gate before recording | `hasPrivacyConsent()` |
| 2. Mask | masks PII before cloud send | `PrivacyPipeline` → `sanitizeRegex()` |
| 3. Strip | drops original data at finalize | `stripPiiFromMaskedItems()` |
| 4. Delete | daily physical purge past retention | `handleDailyPurgeAlarm()` → `purgeOldRecords()` |

"Consent → Mask → Strip → Delete" — these four stages are connected under a single design philosophy, `Content Privacy-by-Design`. That is the full shape of Yasumaro's privacy protection.
