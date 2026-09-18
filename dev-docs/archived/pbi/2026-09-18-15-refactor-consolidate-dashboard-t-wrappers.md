# PBI: dashboard t() ラッパの tOrKey 統合（refactor）

優先度: 台帳 RICE 6.0（Reach 6 / Impact 1 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918c.md](2026-09-18-00-backlog-holistic-0918c.md)（台帳、候補 C2）
依存: なし

## ユーザーストーリー

dashboard を保守する開発者として、翻訳ラッパを1つの seam 関数に統一してほしい、なぜなら現在は4ファイルがそれぞれ同義の `t()` / `localized()` を自前定義しており（計129呼び出しサイト）、名前付き置換対応の有無だけ実装が分かれているから。

## 背景（現状と課題）

以下の4ラッパが同義実装として分散している（着手時に行番号を再確認すること）:

1. `dashboard/panels/asyncData/sqliteHistoryPanelView.ts`（20行目付近）— `t(key, subs?) => getMessageOr(key, key, subs)`、61呼び出し
2. `dashboard/panels/asyncData/sqliteHistoryPanel.ts`（23行目付近）— 同一実装、15呼び出し
3. `dashboard/cleansingStatsView.ts`（5行目付近）— `t(key) => getMessageOr(key, key)`、12呼び出し
4. `dashboard/panels/diagnostic/archivePanel.ts`（27行目付近）— `localized(key, args?) => getMessage(key, args ?? null) || key`、41呼び出し（**名前付き置換 Record<string, string|number> を使用** — archivePreviewSummary {…} 等で実使用を確認済み）

対応方針: `utils/i18n.ts` に `tOrKey(key, substitutions?)` を新設する。substitutions は `string | string[] | Record<string, string | number>` を受け、string/array は位置置換、object は getMessage 既存の名前付き置換に委譲する。4ファイルはローカル定義を削除し `import { tOrKey as t }` / `import { tOrKey as localized }` に置換する（**呼び出しサイト129箇所は無変更**）。

挙動の同一性: t(key, subs) = getMessageOr(key, key, subs) は subs が string|array の場合 chrome.i18n.getMessage への直接渡しで同一。localized(key, args) は getMessage(key, args ?? null) || key で同一。tOrKey は string substitutions を chrome.i18n に直接渡す（getMessage の string 落ち対策）。

## BDD受け入れシナリオ

```gherkin
Scenario: 翻訳ありキーで4ラッパが同一の文字列を返す
  Given 翻訳が存在するキーと、位置置換・名前付き置換・置換なしの3呼び出し
  When tOrKey を介して各呼び出しを行う
  Then 統合前の各ラッパと同一の文字列が返る

Scenario: 欠落キーでキー自身が返る
  Given 翻訳が存在しないキー
  When tOrKey を呼ぶ
  Then キー文字列そのものが返る（fallback=key の現行契約）
```

## 受け入れ基準

- [x] `tOrKey` が `utils/i18n.ts` に新設されている（string/array/object substitutions 対応）
- [x] 4ファイルのローカル `t` / `localized` 定義が削除され、別名 import に置換されている
- [x] 呼び出しサイト129箇所に変更がない
- [x] `npm run type-check` が green
- [x] 変更ファイルの関連 vitest（dashboard パネル系）が green
- [x] `grep -rn "function t(key\|function localized(" src/dashboard --include="*.ts" | grep -v __tests__` が空を返す

## テスト戦略

- i18n テストに tOrKey の単体テストを追加（翻訳あり・欠落・位置置換・名前付き置換）
- dashboard パネル系の既存テストが無修正でパスすること = 挙動不変の証明

## 見積もり

1pt（seam 1関数 + 4ファイルのラッパ置換。呼び出しサイト無変更）。

## 実装ガイド

- 着手時点での確認ポイント: `utils/i18n.ts` の getMessage 名前付き置換ロジック、archivePanel の args 実使用（名前付きオブジェクトあり — 実測済み）
- `getMessageOr` 自体のシグネチャは変更しないこと（既存呼び出し影響を避ける。tOrKey は新規関数）
- git 操作・pbi 編集は統合側が行う
