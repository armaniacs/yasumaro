## ユーザーストーリー

PBI 台帳の読者として、**アーカイブ済み PBI に残ったハングル混入が日本語へ戻っていてほしい**。なぜなら台帳は「なぜこの修正をしたのか」を後から読む唯一の記録であり、混入した文字が残ると文が読めず、レビュー時に主張を検証できないからである。

## 優先度

- RICE: 100（Reach=50 / Impact=1 / Confidence=100% / Effort=0.5）
  - Reach: 50。影響は台帳の読者に限られる（live ではなくアーカイブ）
  - Impact: 1。読みにくさは残るが、live の判断には直接効かない（PBI 09 が live 側を復元済み）
  - Confidence: 100%。13 ファイル / 62 文字を実測し、各断片の復元語を文脈から確定済み（下記の対応表）
  - Effort: 0.5 SP。13 ファイルの局所置換。判断は済んでいる
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低（対応表どおりに置換するだけ。ただし 1 箇所ずつ読む）
- 副作用: 🟢なし（アーカイブの Markdown のみ）

## 背景（発見の経緯）

PBI [2026-10-19-09](../dev-docs/archived/pbi/2026-10-19-09-fix-ledger-deep-mojibake-restore.md) の棚卸しで、非 CJK 文字の走査をアーカイブまで回したところ **Hangul 62 文字 / 13 ファイル**が残っていた。PBI 09 の背景にある「クラス 1（非 CJK 混入）はクリーン」は **live `pbi/` についてのみ正しく、アーカイブは未走査**だった。PBI 09 はスコープ判断（アーカイブは棚卸しのみ）に従って復元せず、本 PBI として切り出した。

## 対応表（実測・2026-10-19）

`dev-docs/archived/pbi/` の 13 ファイル。各行は「混入 → 復元」。いずれも韓国語の語・助詞が日本語に置き換わった形で、前後の文法が復元語を一意に決める。

| ファイル | 混入（現在） | 復元 |
|---|---|---|
| `2026-08-01-19-fix-offline-queue-save-frequency.md` | `過剰최適化` | `過剰最適化` |
| `2026-08-23-03-refactor-messaging-validator-interface.md` | `既존 logic` | `既存 logic` |
| 同 | `validator 추출` | `validator 抽出` |
| 同 | `(새로 생성)` | `(新規作成)` |
| 同 | `// handler에서 분산된 logic을 수집` | `// handler で分散した logic を収集` |
| 同 | `Handler registry에 validator 등록` | `Handler registry に validator を登録` |
| 同 | `(또는 DI layer)` | `(または DI layer)` |
| 同 | `Handler에서 validator 호출` | `Handler で validator を呼び出し` |
| 同 | `// Handler 구현에서` | `// Handler 実装で` |
| 同 | `// Handler wrapper에서` | `// Handler wrapper で` |
| `2026-08-27-13-feat-consolidate-recording-pipeline.md` | `  분류を導入する` | ` 分類を導入する` |
| `2026-09-25-01-fix-transport-replay-safety.md` | `」재를 만들さない` | `」再送を起こさない` |
| `2026-09-25-02-investigate-withlock-cas-deep-equal.md` | `冪等性뿐 아니라` | `冪等性だけでなく` |
| `2026-09-25-20-doc-messaging-layer-decision-record.md` | `中立化되기前` | `中立化される前` |
| `2026-09-25-24-investigate-privacy-reconsent-ux.md` | `再利用한다。` | `再利用する。` |
| 同 | `経路は 필요하다。` | `経路は必要である。` |
| `2026-09-25-31-fix-withlock-object-conflict-policy.md` | `非突然変異形이며` | `非突然変異形であり` |
| `2026-09-28-13-refactor-layer-boundary-hygiene-bundle.md` | `直接構築を 제거し` | `直接構築を除去し` |
| `2026-09-28-20-refactor-ai-summary-cleansing-settings-delta-write.md` | `に見 구분されていた` | `に見区別されていた` |
| `2026-10-01-10-fix-bootstrapper-silent-catch.md` | `両方に 있던無言の` | `両方にあった無言の` |
| `2026-10-01-16-refactor-saved-url-retention-unification.md` | `ため 이를不変性` | `ためこれを不変性` |
| `2026-10-01-23-refactor-storage-transaction-cas-unification.md` | `追加 이유는` | `追加の理由は` |

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

- [2026-10-19-09-fix-ledger-deep-mojibake-restore.md](../dev-docs/archived/pbi/2026-10-19-09-fix-ledger-deep-mojibake-restore.md) — 発見の現場（live の深い断片を復元し、アーカイブの残存を切り出した）
- `pbi/00-INDEX.md` — 台帳
- `dev-docs/DOCUMENTATION_GUIDE.md` — ドキュメントの方針
