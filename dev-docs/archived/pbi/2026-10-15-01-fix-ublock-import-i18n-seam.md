# PBI: uBlock sourceManager の user-facing 文言を i18n seam に寄せる

## ユーザーストーリー

英語ロケールの利用者として、uBlock フィルター管理 (削除・再読込・保存) の成否メッセージを英語で読みたい。現在 `sourceManager.ts` の `showStatus` 3 箇所と `throw` 6 箇所が日本語直書きで、EN 環境でも日本語が表示されるからだ。同一機能の呼び出し側 (`index.ts`) は `getMessage` キー経由で正しくローカライズされており、同一機能内の 2 経路併存が seam の迂回になっている。

## ビジネス価値

- EN ユーザーへの日本語表示という実害を解消する (Impact=中)
- uBlock 文言の所有を辞書 SSOT に寄せ、今後の文言修正を `messages.json` のみに locality 化する
- holistic-1014b 台帳送り F3 (uBlock import 内部分散の精査) を公式に消費する

## 優先度

- 種別: fix
- RICEスコア: **3.0** (Reach=3 / Impact=1 / Confidence=1.0 / Effort=1 SP)
  - Reach=3: uBlock インポート利用者は全体の部分集合だが設定画面の主要動線
  - Impact=1 (中): EN ロケールでの誤言語表示。機能不全ではない
  - Confidence=1.0: 実コードで 9 箇所の直書きを確認済み (file:line は下記)
  - Effort=1: 同一ファイル完結・throw の interface (Error) 不変・辞書追加のみ

## 診断根拠

`/tmp/architecture-review-20261015-053800.md` 候補 1 (Strong)。F2 は発火条件 (3つ目の retrying op) 未成立で deferred 維持。

## BDD受け入れシナリオ

```gherkin
Scenario: ENロケールでソース削除の成功メッセージが英語になる
  Given ロケールを en に設定している
  When uBlock ソース一覧でソースを削除する
  Then #domainStatus に "Source deleted" が表示される
  And 日本語リテラルが DOM に含まれない

Scenario: ENロケールで再読込失敗の throw 文言が英語になる
  Given ロケールを en に設定している
  When 手動入力ソースを再読込する
  Then throw された Error の message が英語である
  And 呼び出し側の showStatus 表示も英語のみになる

Scenario: JAロケールの表示は変わらない
  Given ロケールを ja に設定している (または辞書キー欠落時は fallback)
  When 削除・再読込・保存の各操作を行う
  Then 従来と同一の日本語メッセージが表示される
  And 既存テストの日本語断定は locale 解決が ja のまま green である

Scenario: console 警告が logger seam を経由する
  Given 部分的に無効な行を含むフィルターを保存する
  When 有効ルールが存在して保存が成功する
  Then スキップ警告が console.warn 直呼びではなく logWarn seam を経由する
```

## 受け入れ基準

- [x] `sourceManager.ts:77` の `'ソースを削除しました'` を `getMessageOr('ublockSourceDeleted', 'ソースを削除しました')` に置換している
- [x] `sourceManager.ts:157` の直書きエラー表示を `getMessageOr('ublockNoValidRulesWithDetail', ...)` に置換している
- [x] `sourceManager.ts:201` の `` `フィルターソースを${action}しました...` `` を更新/追加の 2 キー (`ublockSourceSavedUpdated` / `ublockSourceSavedAdded`、`{ruleCount}` 置換) に置換している。`action` 戻り値の型・値は変えない (interface 不変)
- [x] `throw new Error('日本語...')` 6 箇所 (`:91,95,97,107,150,158`) を `getMessageOr` 解決済みメッセージの throw に置換している。Error 型の interface は不変
- [x] 新規キー (7 件目安) を `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方に追加している (en は英訳、ja は従来文言と同一)
- [x] `sourceManager.ts:112,164` の `console.warn` を `logWarn` seam (PBI 2026-09-18-06 の確立 seam) に寄せている
- [x] `src/dashboard/settings/ublockImport/` 配下の production TS に日本語 user-facing リテラルが残っていない (コメント・テストを除く。`rg '\p{Han}'` で確認)
- [x] 既存テスト (`sourceManager.test.ts` 等) が green。日本語断定の更新が必要になった場合は理由をコミットメッセージに記録する (期待値合わせではなく文言仕様変更として)
- [x] `npm run validate` が green

## 実装方針 (5 Whys 要約)

- Why 日本語が EN に出るのか → throw/showStatus が辞書を経由せず直書きだから
- Why 直書きが残ったのか → archloop-1010 NN05 の dashboard i18n sweep が `index.ts` (呼び出し側) 中心で `sourceManager.ts` (被呼び出し側) を見落としたから
- Why 見落とされたのか → 同一機能でもファイルが分かれると sweep の網から漏れるから。解 = 機能単位 (uBlock import) で `rg '\p{Han}'` をかけ、コメント以外をゼロにする
- 行動可能な解: `getMessageOr(key, 従来文言)` + 辞書 7 件追加。テストの chrome.i18n mock が `''` を返す構成なら fallback で既存日本語断定は不変 (着手時に実測で確定させる)

## テスト戦略

- unit: `src/dashboard/settings/ublockImport/__tests__/sourceManager.test.ts` ― 既存 523 行スイートで回帰 pin。locale 解決の実測を先に確認し、必要なら en 解決の新規ケースを 2 件追加 (削除メッセージ・throw メッセージの en 断定)
- 辞書: 両 locale の JSON validity は `validate:json` が担保。新規キーの ja/en 存在は目視 + `jq` で確認
- 手動確認 (DoD 分離): 実ブラウザ Load unpacked → dashboard → uBlock インポート → EN ロケールで削除・再読込失敗・保存の英語表示を確認、JA で従来表示を確認 (`dev-docs/TESTING_GUIDE.md` 手順)

## 見積もり

- 1 SP (🟢低)。ファイル排他: `sourceManager.ts` + 辞書 2 件 + テスト 1 件のみ
