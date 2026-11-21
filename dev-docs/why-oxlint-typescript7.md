# なぜなぜ分析: oxlint 移行と TypeScript 7 の目的分離

本ドキュメントは「なぜ oxlint 全面移行で TS7 を狙うのか」を5回掘り、破壊的フェーズに
入る前の意思決定を記録したもの。前提調査は [investigation-oxlint-migration.md](investigation-oxlint-migration.md)、
PBI は [pbi/2026-11-22-01](../pbi/2026-11-22-01-chore-oxlint-migration-typescript7.md)。

結論: **「TS7 アンブロック」と「eslint 撤去」は独立した2つの目的**で、難易度もユーザー価値も
異なる。TS7 のブロッカーは `@typescript-eslint/parser` と `typedoc` だけで、eslint コアは無関係。
両者を1つの PBI に混ぜると破壊的フェーズの失敗理由が1つに潰れ、revert も効かなくなる。

## なぜなぜ1: そもそもの目的

```
なぜ oxlint に移行したい?
└→ typescript-eslint を消したいから
   なぜ typescript-eslint を消したい?
   └→ アイツの peer が typescript <6.1.0 で、TS7 の npm install を ERESOLVE で止めるから
      なぜ TS7 に上げたい?
      └→ tsgo(native Go)で type-check が速く、ツールチェーンを最新に保ちたい
         なぜそのため eslint も消す必要がある?
         └→ 【無い】eslint コア(10.15.0)の peer は jiti のみ。TS7 のブロッカーは
            @typescript-eslint/parser(peer typescript >=4.8.4 <6.1.0) と typedoc(peer 6.0.x)。
            eslint 本体は TS7 でも動く
```

## なぜなぜ2: なぜ「テスト」が本省の結合点か

```
なぜ eslint を消すとヤバい?
└→ 自作12ルールのテスト14ファイルが ESLint の RuleTester に依存
   なぜ RuleTester を使う?
   └→ ルールテストの標準道具(valid/invalid)
      なぜ RuleTester に parser が要る?
      └→ TSコード片をパースしてルールを走らせるため
         なぜそれが問題?
         └→ RuleTester は TS parser を要求し、その parser(=@typescript-eslint/parser)が
             まさに TS7 でブロックされる当の本人
```

## なぜなぜ3: なぜ「一気に撤去」が危険か

```
なぜ一気に撤去(eslint.config.js削除+14テスト削除+依存全抜き)が危険?
└→ 12ルールの正しさを保証しているのは、その14個の RuleTester テストだから
   なぜ消えると困る?
   └→ ルールがサイレントに壊れても誰も気づかない。現状 local 違反は1件のみの
      「ほぼゼロ基線」で、回帰しても CI が赤くならない
      なぜ基線ゼロが危険?
      └→ セーフティネットが「テスト失敗」でなく「パリティ」でしかない
         → だからこそ機械的パリティを先に通した(実装PoC)
```

## なぜなぜ4: なぜ SSOT を eslint.config.js に置いたか

```
なぜ .oxlintrc.json を手書きせず生成器にした?
└→ allowlist が25件超で手コピーは drift の温床
   なぜ drift が危険?
   └→ allow が片方にしか無いと誤検知/見逃しがサイレントに起きる
      なぜ生成器なら安全?
      └→ 単一源から派生し構造的に乖離しない。ただし eslint.config.js を削除した瞬間に
         生成器の import が壊れる → SSOT は「削除」でなく「移譲」が必要
```

## なぜなぜ5: なぜ typedoc も地雷か

```
なぜ typescript-eslint を消しても TS7 にならない?
└→ typedoc 0.28.20 の peer が typescript 5.0.x〜6.0.x に pin。docs ビルドが要求
   なぜ typedoc が要る?
   └→ npm run docs。ただし validate には入っていない(CI必須ゲート外)
      なぜ移行に効く?
      └→ TS7 を package.json に入れると typedoc の peer も ERESOLVE で挑戦してくる
```

## 実測で確定した重要事実（2026-11-22）

1. `eslint` 10.15.0 の peerDependencies は `jiti` のみ。**typescript 不要**。
2. `@typescript-eslint/parser` の peer は `eslint ^8.57||^9||^10` と `typescript >=4.8.4 <6.1.0`。
   → TS7 ブロッカーは parser 側だけ。型-aware でなくとも parser の peer が install を止める。
3. `typedoc` 0.28.20 の peer は `typescript 5.0.x〜6.0.x`。typescript-eslint とは別に TS7 を拒む。
4. `oxc-parser` は `parseForESLint` を持たない（`parse`/`parseSync`/`Visitor`/`visitorKeys` のみ）。
   ただし `parseSync(code, { range: true })` で ESTree 風 AST + 各ノードに start/end が付き、
   ソースから `loc` を復元し `tokens:[]`/`comments:[]` を空付与すれば **ESLint の parser として
   RuleTester が動作する**ことを実測確認（utils-layer-boundary の `import type` ケースが PASS）。

## この分析から導かれる方針

| | 目的 | ブロッカー | 難度 | ユーザー価値 |
|---|---|---|---|---|
| **Goal A** | TS7へ | `@typescript-eslint/*` + `typedoc` を外す。RuleTester の parser を oxc アダプタへ | 中 | ◎(本命) |
| **Goal B** | eslint撤去(高速化/依存減) | RuleTester を oxlint 互換 or 自前ハーネスへ | 高 | ○(副次) |

- **Goal A は Goal B を完了させなくても達成できる**
  （oxc アダプタで RuleTester を維持し、lint を oxlint へ寄せれば eslint コアは不要になるが、
  eslint を完全に消す Goal B とは独立に TS7 を実現できる）。
- eslint コアを Goal A で必ずしも消す必要はない。TS7 の install を阻むのは typescript-eslint と
  typedoc だけなので、これらを外せば eslint コアを残したままでも TS7 にできる。
- **推奨: 案1（Goal A 先行）**。本命価値(TS7)を最速・最小リスクで取り、eslint 撤去(Goal B)は
  別 PBI に切り出して各コミットの失敗理由を1つに保つ。