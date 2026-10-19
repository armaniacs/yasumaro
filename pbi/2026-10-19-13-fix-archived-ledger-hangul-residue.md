## ユーザーストーリー

PBI 台帳の読者として、**アーカイブ済み PBI に残ったハングル混入が日本語へ戻っていてほしい**。なぜなら台帳は「なぜこの修正をしたのか」を後から読む唯一の記録であり、混入した文字が残ると文が読めず、レビュー時に主張を検証できないからである。

## 優先度

- RICE: 100（Reach=50 / Impact=1 / Confidence=100% / Effort=0.5）
  - Reach: 50。影響は台帳の読者に限られる（live ではなくアーカイブ）
  - Impact: 1。読みにくさは残るが、live の判断には直接効かない（PBI 09 が live 側を復元済み）
  - Confidence: 100%。**破損 326 箇所 / 141 種類**を `node scripts/check-docs-chars.mjs --list` で機械的に列挙できる（下記の対応表はそのうち判断済みの 21 行）
  - Effort: 0.5 SP。局所置換。判断は表の範囲では済んでいる
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低（対応表どおりに置換するだけ。ただし 1 箇所ずつ読む）
- 副作用: 🟢なし（アーカイブの Markdown のみ）

## 背景（発見の経緯）

PBI [2026-10-19-09](../dev-docs/archived/pbi/2026-10-19-09-fix-ledger-deep-mojibake-restore.md) の棚卸しで、非 CJK 文字の走査をアーカイブまで回したところ **Hangul 62 文字 / 13 ファイル**が残っていた。PBI 09 の背景にある「クラス 1（非 CJK 混入）はクリーン」は **live `pbi/` についてのみ正しく、アーカイブは未走査**だった。PBI 09 はスコープ判断（アーカイブは棚卸しのみ）に従って復元せず、本 PBI として切り出した。

2026-10-20 の文字規約導入（`AGENTS.md` / `CLAUDE.local.md` の「Documentation Characters」）で検証スクリプト `scripts/check-docs-chars.mjs` が入り、**破損の全量が機械的に出るようになった**。現在の実測は **326 箇所 / 141 種類**（ハングル・簡体字・`U+FFFD`・アラビア文字）。対応表はそのうち判断済みの 21 行で、残りは `--list` の出力を見ながら同じ基準（前後の文法が復元語を一意に決めるか）で進める。

## 対応表（実測・2026-10-19）

`dev-docs/archived/pbi/` の 13 ファイル。いずれも韓国語の語・助詞が日本語に置き換わった形で、前後の文法が復元語を一意に決める。**混入していた文字そのものは本ファイルに書かない**（規約上、範囲外文字を残せないため。修正前のバイト列は git 履歴 `git show <commit>:<file>` で参照できる）。以下は「どのファイルの・どの語を・どう直したか」の記録。

| ファイル | 復元（適用済み） |
|---|---|
| `2026-08-01-19-fix-offline-queue-save-frequency.md` | 過剰最適化 |
| `2026-08-23-03-refactor-messaging-validator-interface.md` | 既存 logic / validator 抽出 / (新規作成) |
| 同 | `// handler で分散した logic を収集` |
| 同 | `Handler registry に validator を登録` |
| 同 | (または DI layer) / `Handler で validator を呼び出し` |
| 同 | `// Handler 実装で` / `// Handler wrapper で` |
| `2026-08-27-13-feat-consolidate-recording-pipeline.md` | ` 分類を導入する` |
| `2026-09-25-01-fix-transport-replay-safety.md` | `」再送を起こさない` |
| `2026-09-25-02-investigate-withlock-cas-deep-equal.md` | `冪等性だけでなく` |
| `2026-09-25-20-doc-messaging-layer-decision-record.md` | `中立化される前` |
| `2026-09-25-24-investigate-privacy-reconsent-ux.md` | `再利用する。` / `経路は必要である。` |
| `2026-09-25-31-fix-withlock-object-conflict-policy.md` | `非突然変異形であり` |
| `2026-09-28-13-refactor-layer-boundary-hygiene-bundle.md` | `直接構築を除去し` |
| `2026-09-28-20-refactor-ai-summary-cleansing-settings-delta-write.md` | `に見区別されていた` |
| `2026-10-01-10-fix-bootstrapper-silent-catch.md` | `両方にあった無言の` / `あった無言の catch` |
| `2026-10-01-16-refactor-saved-url-retention-unification.md` | `ためこれを不変性` |
| `2026-10-01-23-refactor-storage-transaction-cas-unification.md` | `追加の理由は` |

## 進捗（2026-10-20 時点）

`node scripts/check-docs-chars.mjs` の実測で **326 → 192 箇所**まで修復済み。修正済みの内訳:

- 韓国語混入の塊（`2026-08-23-03` の code block 9 箇所、`2026-09-25-24` の 14 箇所、`2026-09-25-31` など）
- 簡体字の単字（分岐・分離・自体・唯一・一貫・実在・ボタン・状況・ユーザー・バックアップ・飲む・飲み込み）
- grep の漢字レンジ（U+9FAF 等）→ `[ぁ-んァ-ヶ]|\p{Han}`（PCRE 前提に変更。意味は同じで CP932 内）
- 本 PBI の対応表から混入文字そのものを削除（表は「復元（適用済み）」形式に変更）

**進め方**: `node scripts/check-docs-chars.mjs --list` の出力を上から順に、次の基準で 1 箇所ずつ直す。

1. 前後の文法から復元語が一意に決まるもの（簡体字の単字→対応する日本語の字、韓国語の助詞→日本語の助詞）は置換する
2. 一意に決まらないものは、その語句だけ削除する（推測で文を作らない）
3. 直したら `--list` を再実行し、件数が減ったことを確認する

残りの大半は (a) 簡体字・ハングルの単字・語（`CHANGELOG.md` と `dev-docs/ADR/`、`dev-docs/archived/pbi/` に分散）、(b) U+FFFD（4 箇所、語の一部が欠落）、(c) アラビア文字の断片（2 ファイル）。

## 受け入れ基準

- [ ] 上表の 13 ファイルで Hangul が 0 文字になる（走査出力を記録）
- [ ] 各ファイルの復元箇所の前後 3 行を読み、日本語として通ることを確認する
- [ ] 表の「復元」列から外れる語を新たに補わない（表に無い断片を見つけたら、その場で決めず本 PBI に追記して判断を残す）
- [ ] 非 CJK 文字の走査（`pbi/` + `dev-docs/archived/pbi/`）で、μ などの正当な技術表記を除いて 0 である
- [ ] `npm run validate` が緑

## テスト戦略

- 自動テストは無い（ドキュメントのみ）。**走査スクリプトの出力**を記録することが検証。
- 走査対象は `pbi/*.md` と `dev-docs/archived/pbi/*.md`。Hangul（`\uAC00-\uD7AF`）が 0 であることを示す。
- 復元の正しさは前後文の読解で確認する（1 ファイル 1 段落）。

## 関連

- [2026-10-19-09-fix-ledger-deep-mojibake-restore.md](../dev-docs/archived/pbi/2026-10-19-09-fix-ledger-deep-mojibake-restore.md) ― 発見の現場（live の深い断片を復元し、アーカイブの残存を切り出した）
- `pbi/00-INDEX.md` ― 台帳
- `dev-docs/DOCUMENTATION_GUIDE.md` ― ドキュメントの方針
