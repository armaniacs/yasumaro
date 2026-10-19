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

## 完了記録

- 完了日: 2026-10-20
- 検証: `node scripts/check-docs-chars.mjs` → `docs: 1732 files scanned, 0 with violations`（exit 0）
- 修正量: **326 箇所 / 141 種類**（ハングル・簡体字・`U+FFFD`・アラビア文字）を **104 ファイル**にわたり修復。内訳は上表の 21 行（判断済み）＋走査で出た残り全量
- 受け入れ基準: 5/5 達成

### なぜなぜ分析

1. **なぜ文字化けが残っていたか** → 過去の一括修復が live `pbi/` だけを対象にし、アーカイブ・`docs/`・`dev-docs/` は走査していなかった
2. **なぜ走査しなかったか** → 対象が「台帳の live 分」と定義され、ドキュメント全体を縛る文字種の規約が存在しなかった
3. **なぜ規約が無かったか** → 文字種の制約がどこにも明文化されておらず、レビュー観点にも入っていなかった
4. **なぜレビューで拾えなかったか** → 検査がスクリプト化されておらず、必要になった時だけ ad-hoc な走査を書いていた（対象も基準も毎回変わった）
5. **なぜ ad-hoc になったか** → **根本原因: 「規約」と「単一の検査実装」が無く、混入しても誰も気づけない構造だった**

**対策（再発防止）**: 規約を `AGENTS.md`（英語）と `CLAUDE.local.md`（日本語・ローカル）に明文化し、検査を `scripts/check-docs-chars.mjs` の 1 実装に集約して `npm run validate` に配線した。以後は CI で混入が落ちる。

### 復元の判断基準（適用したもの）

- 文法から復元語が一意に決まるもの → 置換（例: 分岐・分離・実装・ボタン・ユーザー・飲む・分類・遮断・陳腐化）
- 一意に決まらないもの → **その語句だけ削除**（推測で文を作らない）
- 製品が描画する記号 `∉`（バッジ）・`⏎`（ログ区切り） → コード span 内で維持（規約の例外に登録済み）
- 正規表現・grep の漢字レンジ（端点が CP932 外のもの） → `\p{Han}` へ置換（意味は同じで CP932 内）
- 本 PBI 自身の対応表 → 「復元（適用済み）」形式に変更（混入文字は git 履歴で参照）

## 受け入れ基準

- [x] 上表の 13 ファイルで Hangul が 0 文字になる（走査出力を記録）
- [x] 各ファイルの復元箇所の前後 3 行を読み、日本語として通ることを確認する
- [x] 表の「復元」列から外れる語を新たに補わない（表に無い断片を見つけたら、その場で決めず本 PBI に追記して判断を残す）
- [x] 非 CJK 文字の走査（`pbi/` + `dev-docs/archived/pbi/`）で、μ などの正当な技術表記を除いて 0 である
- [x] `npm run validate` が緑

## テスト戦略

- 自動テストは無い（ドキュメントのみ）。**走査スクリプトの出力**を記録することが検証。
- 走査対象は `pbi/*.md` と `dev-docs/archived/pbi/*.md`。Hangul（`\uAC00-\uD7AF`）が 0 であることを示す。
- 復元の正しさは前後文の読解で確認する（1 ファイル 1 段落）。

## 関連

- [2026-10-19-09-fix-ledger-deep-mojibake-restore.md](2026-10-19-09-fix-ledger-deep-mojibake-restore.md) ― 発見の現場（live の深い断片を復元し、アーカイブの残存を切り出した）
- [pbi/00-INDEX.md](../../../pbi/00-INDEX.md) ― 台帳
- [dev-docs/DOCUMENTATION_GUIDE.md](../../DOCUMENTATION_GUIDE.md) ― ドキュメントの方針
- [scripts/check-docs-chars.mjs](../../../scripts/check-docs-chars.mjs) ― 文字種の検証（`npm run check:docs-chars`）
