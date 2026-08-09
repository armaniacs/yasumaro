# PBI: markdownFormatter と obsidianFormatter のサニタイズ差異を調査する

**作成日**: 2026-08-09
**優先度**: —
**見積もり**: 🟢小（調査のみ・実装なし）
**副作用**: なし
**種別**: 🔍調査（investigation）

**ステータス**: ✅ **調査完了 — 対応不要と結論。コード変更は行わない。**

---

## 背景

アーキテクチャレビュー（2026-08-09、候補6）で、同種のデータを扱う2つの
Markdown フォーマッタでサニタイズ関数が異なることを指摘した。

```typescript
// src/dashboard/obsidianFormatter.ts:27-29
const title = sanitizeForMarkdownLinkText(entry.title || entry.url || 'Untitled');
const url   = sanitizeUrlForMarkdownTarget(entry.url);

// src/utils/markdownFormatter.ts:5-6
const title = sanitizeForObsidian(entry.title || entry.url || 'Untitled');
const url   = sanitizeForObsidian(entry.url);
```

レビュー時点では「片方への修正がもう片方に届かない locality の問題」とし、
着手前に ADR 2026-07-22 の確認を必須と記載した。

## 調査結果: 対応不要

### 1. ADR は用途別の使い分けを明示的に定めている

ADR 2026-07-22「Markdown出力経路へのサニタイズ適用ルール」の関数表：

| 関数 | 対象 |
|------|------|
| `sanitizeForObsidian(text)` | title, summary, digest, **free-text URL**, 文中のURL, 見出し |
| `sanitizeUrlForMarkdownTarget(url)` | **リンクターゲット位置のURL**（`[title](url)` の `(url)` 部分） |

**両者は「強弱」ではなく「用途違い」である。**

### 2. `markdownFormatter.ts` はリンク構文を組み立てていない

出力形式（全文確認済み）：

```
# {title}

- URL: {url}
- Date: {date}
- Tags: {tags}

## Summary

{summary}
```

`[text](url)` を**一切生成しない**。URL は free text 位置に出力される。
ADR の表に照らすと `sanitizeForObsidian` が**正しい選択**である。

### 3. `sanitizeForMarkdownLinkText` の存在理由が当てはまらない

`markdownSanitizer.ts:128-132` の doc comment：

> The link text is attacker-controlled (page title, stored record title).
> If it contains a suffix like `](https://evil.example)`, and sanitization is
> applied BEFORE the caller wraps it in `[${title}](${url})`, the wrapper
> closes early and renders a link to the attacker-chosen destination
> (VULN-001 / VULN-016 / VULN-017).

この関数は**呼び出し側が `[${title}](${url})` で包むこと**を前提に存在する。
`markdownFormatter` は包まないため、脆弱性ベクタが成立しない。

### 4. サニタイズ漏れも無い

`markdownFormatter.ts` は title / url / summary / tags の
**untrusted フィールド全てに** `sanitizeForObsidian` を適用している（5-9行）。

## 結論

**差異は意図的かつ正しい。** 統一すべきではない。

`markdownFormatter` を `sanitizeUrlForMarkdownTarget` に変えると、
`https?://` 以外の URL（記録済みの `file://` 等）が `about:blank` に
置換され、**表示上の情報が失われる回帰**になる。

## この記録を残す理由

「2つのフォーマッタでサニタイズが違う」という観察は今後も繰り返し発生しうる。
そのたびに同じ調査をしないよう、**なぜ違ってよいのか**を記録する。

同種の指摘が再度出た場合は、まず「そのフォーマッタは `[](...)` を組むか？」
を確認すること。組まないなら `sanitizeForObsidian` が正しい。

## 参照

- アーキテクチャレビュー 2026-08-09 候補6（Speculative 判定）
- ADR 2026-07-22-markdown-output-sanitization-guardrail
- `src/utils/markdownSanitizer.ts:85-150`（3関数の実装と doc comment）
