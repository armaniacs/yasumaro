# PBI: getMsgWithCache if-chain の解消（refactor）

優先度: 台帳 RICE 6.0（Reach 3 / Impact 1 / Confidence 1.0 / Effort 0.5pt）
backlog: [2026-09-18-00-backlog-archloop-0918.md](2026-09-18-00-backlog-archloop-0918.md)（台帳、候補 C2）
依存: なし

## ユーザーストーリー

popup のエラー表示を保守する開発者として、翻訳キャッシュの取得を1つのルックアップに統一してほしい、なぜなら現在は型・キャッシュリテラル・8分岐 if-chain の3箇所並列で手動維持されており、メッセージ1個の追加に3箇所編集が必要だから。

## 背景（現状と課題）

`src/popup/errorUtils.ts` の `getMsgWithCache`（108-141行目付近）:

1. `MessagesCache` 型定義（key 集合）
2. キャッシュリテラル（8キーの `chrome.i18n.getMessage` 呼び出し）
3. `if (key === 'connectionError') return ...` ×8 の手書き type guard

の3箇所が同じ key 集合を手動平行維持する。interface（key 引数の型）が implementation（if-chain）とほぼ同複雑さの浅いモジュール。PBI 2026-09-12-08 で locale 切替時のキャッシュ無効化は修正済みだが、構造はそのまま。

対応方針: if-chain を `key in messagesCache` の1ルックアップに置換する。キャッシュ構築は `Object.fromEntries` か既存リテラルのまま維持し、欠落キーは現行どおり生 `chrome.i18n.getMessage(key, substitutions)` にフォールバックする。キャッシュ戦略・locale key・返り値は不変。

## BDD受け入れシナリオ

```gherkin
Scenario: キャッシュ対象キーは翻訳を返す
  Given chrome.i18n.getMessage が翻訳を返す環境
  When getMsgWithCache('connectionError') を呼ぶ
  Then 翻訳文字列が返る（統合前と同一）

Scenario: 非キャッシュキーは生 getMessage にフォールバックする
  Given キャッシュ対象外のキーと substitutions
  When getMsgWithCache('otherKey', ['x']) を呼ぶ
  Then chrome.i18n.getMessage('otherKey', ['x']) の結果が返る
```

## 受け入れ基準

- [x] `getMsgWithCache` の if-chain が1ルックアップに置換されている
- [x] キャッシュ戦略（locale 切替無効化）・返り値が統合前と同一
- [x] `npm run type-check` が green
- [x] popup errorUtils 関連 vitest が green
- [x] `grep -n "if (key === " src/popup/errorUtils.ts` が 0 件

## テスト戦略

- 既存テスト（sanitizeError・errorUtils 系）が無修正でパスすること = 挙動不変の証明

## 見積もり

0.5pt（1関数の置換。新規テスト不要）。

## 実装ガイド

- 着手時点での確認ポイント: `src/popup/errorUtils.ts` の getMsgWithCache 全体（108-141行目付近）と MessagesCache 型
- `MessagesCache` 型自体は維持する（keyof による key 制約は残す）
- git mv による pbi アーカイブは統合側が行う
