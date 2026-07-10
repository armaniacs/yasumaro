# PBI-2: ダッシュボード SQLite 履歴パネルへの content 表示トグル追加 — 設計書

## 概要

PBI-1 で SQLite `browsing_logs` に `content` カラムが追加され、PBI-3 で実際に content が保存されるようになる。本 PBI では、ダッシュボードの SQLite 履歴パネル（`sqliteHistoryPanel.ts`）で各エントリの content（本文）を展開表示できるトグル UI を追加する。content は長文になり得るため、デフォルトは非表示（折りたたみ）とし、ユーザーが明示的に展開したときのみ表示する。

PBI-1 設計書（`2026-07-07-pbi1-sqlite-metadata-persist-design.md:214-220`）で「ダッシュボード UI の修正（PBI-2）」としてスコープ外にされていた作業。

## 現状

- SQLite 履歴パネルの DOM は `entrypoints/options/index.html:1579` の `<section id="panel-sqlite-history">`、コンテナは `#sqlite-history-container`。
- レンダリング本体は `src/dashboard/sqliteHistoryPanel.ts`。`renderEntryList()`（465-552行目）が `BrowsingLogEntry`（`sqliteHistoryPanel.ts` へは `./dashboardSqliteService.js` 経由でインポート、型定義自体は `src/utils/sqlite-types.ts:24`、`content?: string | null` は既に定義済み）の配列から1件ずつ `.sqlite-entry` を描画している。現状 `title`/`url`/`domain`/`created_at`/`summary`/`tags` のみ表示しており、**content は一切参照していない**。
- 長文の折りたたみ表示パターンは別パネル（レガシー履歴パネル）の `src/dashboard/historyEntryRow.ts:55-84` の `createContentToggle()` に既存。ボタン＋`aria-expanded` 属性＋`.content-preview.hidden` の開閉というシンプルな実装。SQLite履歴パネル側には同種のトグルがまだ無いため、このパターンを移植する。
- 設定の select 要素と `StorageKeys` のバインドパターンは `dashboard.ts` の保持ポリシー系実装（`sqliteRetentionDays`/`sqliteMaxRecords`）に既存: `dashboard.ts:216-217`（型宣言）→`275-276`（`getElementById`取得）→`351-352`（`StorageKeys` マッピングテーブル）→`552-557`（保存時の型変換）。

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/storage/types.ts` | `SHOW_SQLITE_CONTENT` キー追加（boolean） |
| `src/utils/storage/defaults.ts` | デフォルト値 `false` 追加 |
| `entrypoints/options/index.html` | SQLite履歴パネル設定に「content表示」チェックボックス追加 |
| `src/dashboard/sqliteHistoryPanel.ts` | `renderEntryList()` に content トグルボタン＋展開エリアを追加 |
| `src/dashboard/dashboard.ts` | 新設定キーの読み取り・保存バインド追加 |
| i18n: `public/_locales/ja/messages.json`, `public/_locales/en/messages.json` | 新規キー追加 |

## 設定キー

```typescript
// StorageKeys に追加
SHOW_SQLITE_CONTENT: 'show_sqlite_content',  // boolean
```

Settings インターフェースに追加:

```typescript
[StorageKeys.SHOW_SQLITE_CONTENT]: boolean;
```

デフォルト値: `false`（初期状態では content トグルボタン自体は常に表示するが、本文プレビューはこの設定に関わらず展開時のみ描画。この設定は「一覧に content が存在するエントリにトグルボタンを出すかどうか」の可否スイッチとして使う。content が無いエントリ（`content == null`）はそもそもトグルボタンを出さない）。

## sqliteHistoryPanel.ts — トグル追加

`renderEntryList()` のテンプレートに、`entry.content` が存在する場合のみトグルボタンと展開エリアを追加する。`historyEntryRow.ts` の `createContentToggle()` と同じ開閉方式（`aria-expanded` + `.content-preview.hidden`）を採用するが、SQLite履歴パネルは文字列テンプレート方式（`innerHTML`）でレンダリングしているため、DOM生成関数ではなくHTML文字列として実装する:

```typescript
// renderEntryList() 内、summary 行の下に追加
${entry.content ? `
  <button type="button" class="content-toggle-btn" data-action="content-toggle"
          data-id="${entry.id}" aria-expanded="false" aria-controls="content-preview-${entry.id}">
    ${t('historyShowContent')}
  </button>
  <div class="content-preview hidden" id="content-preview-${entry.id}">${escapeHtml(entry.content)}</div>
` : ''}
```

イベントワイヤリングは既存の `[data-action="star"]` 等と同じ場所（`renderEntryList()` 末尾の `querySelectorAll` ブロック）に追加:

```typescript
listEl.querySelectorAll('[data-action="content-toggle"]').forEach((el) => {
  el.addEventListener('click', () => {
    const id = (el as HTMLElement).getAttribute('data-id');
    const area = document.getElementById(`content-preview-${id}`);
    if (!area) return;
    const isHidden = area.classList.toggle('hidden');
    el.setAttribute('aria-expanded', String(!isHidden));
    el.textContent = isHidden ? t('historyShowContent') : t('historyHideContent');
  });
});
```

## 一覧取得設定 UI

SQLite履歴パネルのフィルタ/表示設定エリアに「content表示を有効化」チェックボックスを追加する。これは既存の保持ポリシー系 select とは異なり、パネル自体の表示切り替えなので `sqliteHistoryPanel.ts` 側の state（`state.showContent` のようなフラグ）と `dashboard.ts` 経由の永続化設定（`StorageKeys.SHOW_SQLITE_CONTENT`）の両方に反映する。

既存のチェックボックス+ラベルは `class="checkbox-label"` でラップする（`class="toggle-label"` は別パターン: `toggle-switch` ラベルの隣に置く単独の `<span>` であり、チェックボックスをラップする用途ではない。`reviewSummaryEnabled`（`entrypoints/options/index.html:284-287`）と同じ構造にする）:

```html
<!-- entrypoints/options/index.html: panel-sqlite-history 内、フィルタ操作エリア -->
<label class="checkbox-label">
  <input type="checkbox" id="sqliteShowContentToggle">
  <span data-i18n="showContentToggleLabel"></span>
</label>
```

```typescript
// dashboard.ts — 既存の select バインドパターンに倣う
[StorageKeys.SHOW_SQLITE_CONTENT]: el.sqliteShowContentToggle,
```

checkbox の `checked` 読み書きは新規コードを書く必要はなく、既存の `reviewSummaryEnabled`/`localMarkdownExportEnabled` と同様に `src/popup/settingsUiHelper.ts` の共通ヘルパー `extractSettingsFromInputs`/`loadSettingsToInputs`（58-59行目・82-83行目）が checkbox 要素を汎用的に処理する。マッピングテーブルにエントリを追加するだけでよい。

`sqliteHistoryPanel.ts` 側は初期化時に `getSettings()` から `SHOW_SQLITE_CONTENT` を読み、`false` の場合は content トグルボタン自体を描画しない（`entry.content && state.showContent` の両方が真の場合のみボタンを出す）。

## i18n キー

命名は既存の `retentionPolicyTitle`/`retentionDaysLabel` と同じ camelCase + Label/Title サフィックスに合わせる:

```json
{
  "historyShowContent": { "message": "本文を表示" },
  "historyHideContent": { "message": "本文を隠す" },
  "showContentToggleLabel": { "message": "一覧に本文表示ボタンを出す" }
}
```

en側は対応する英語訳を追加。

## エスケープ・XSS対策

content はユーザーが閲覧したウェブページ本文であり信頼できない外部データのため、既存の `title`/`url` と同様に必ず `escapeHtml()` を通す（`sqliteHistoryPanel.ts` 内に既存のヘルパー関数を使用、507行目の `summary` 表示と同じ扱い）。

## テスト計画

| テスト種別 | 対象 | 内容 |
|-----------|------|------|
| 単体 | `renderEntryList()` | content ありエントリでトグルボタンが描画されること／content なしエントリで描画されないこと |
| 単体 | `renderEntryList()` | `SHOW_SQLITE_CONTENT` が false の場合トグルボタンが出ないこと |
| 単体 | content トグルクリック | `.content-preview` の `hidden` クラスが開閉すること、`aria-expanded` が更新されること |
| 単体 | XSS | content に `<script>` 等を含む場合 `escapeHtml()` で無害化されること |
| 統合 | Dashboard 設定 | チェックボックスの状態 → `StorageKeys.SHOW_SQLITE_CONTENT` への保存・復元 |

## スコープ外

- content の全文検索（FTS5 対象化）は PBI-1 で対象外と明記済み、本 PBI でも対象外
- content の編集・削除UI（PBI-3 の保持ポリシーによる自動NULL化のみが削除経路）
- レガシー履歴パネル（`historyEntryRow.ts`）側の content トグルは既存のまま変更しない
