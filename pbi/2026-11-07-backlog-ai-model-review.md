# PBI: AIモデル定期レビュー (四半期プロセス + 初回分実施済み)

**状態: 初回分 (docs の死んだモデル参照 4 箇所の置換) は本 PBI 起票時に実施済み。四半期チェックリストとして継続するバックログ。**

## ユーザーストーリー

保守者として、Groq のモデル退役サイクルに合わせて AI 関連の既定値と文書を四半期ごとに点検したい。なぜなら、モデル ID は予告なく廃止され (例: `llama-3.1-8b-instant` / `llama-3.3-70b-versatile` は 2026-08-16 に停止)、死んだ既定値や文書の記載は新規ユーザーの接続失敗と問い合わせを生むため。直近の関連決定 (AI 接続テストの adaptive retry、モデル別表を持たない方針、issue #202) を踏まえ、本 PBI はコード変更ではなく運用プロセスとして四半期チェックを定義する。

## 背景

- Groq はモデルを定期的に退役させる。退役表: https://console.groq.com/docs/deprecations。2026-08-16 の例では `llama-3.1-8b-instant` と `llama-3.3-70b-versatile` が停止し、qwen 系もローテーション対象になった。モデル固有の仮定は腐る。
- リポジトリ内の既に腐った証拠 (初回分の対象):
  - `docs/FAQ.md` Q15 (日英 2 箇所): Groq 設定例の Model Name が `llama-3.3-70b-versatile`
  - `docs/SETUP_GUIDE.md` (日英 2 箇所): OpenAI Compatible の Model Name 例が `llama-3.3-70b-versatile`, `gpt-4o-mini`
- リポジトリ既定の OpenAI モデルは `openai/gpt-oss-20b` (`src/utils/storage/defaults.ts:53`、reasoning モデル)。初回置換はこの既定と整合する live モデルを選んだ。
- 関連する直近決定: AI 接続テストは adaptive retry 方式となり、モデル別の上限表は持たない。本 PBI はその実装ではなく、既定値・文書・上限・プロバイダー数の四半期点検プロセスを担う。

## 四半期チェックリスト (毎回実施)

1. **既定モデル ID の有効性**: `src/utils/storage/defaults.ts` の `OPENAI_MODEL` (`openai/gpt-oss-20b`)、`GEMINI_MODEL` (`gemini-3.1-flash-lite`)、`OPENAI_2_MODEL` (`llama3`) が Groq deprecations ページおよび各プロバイダーの現行モデル一覧に存在するか確認する。死んでいれば live モデルへ更新する (コード変更は別 PBI 化してよい)。
2. **文書のモデル名と退役表の突合**: `docs/FAQ.md`・`docs/SETUP_GUIDE.md` (日英) および他のガイド内のモデル名例を Groq deprecations ページと突き合わせ、死んだ ID を live モデルへ置換する。
3. **接続テスト上限の確認**: `src/utils/limits.ts` の `MAX_AI_HTTP_RESPONSE_BYTES` (現行 10 MiB、summary + testConnection 共通) が adaptive retry の実測と矛盾しないか確認する。矛盾があれば別 PBI 化する (本 PBI では変えない)。
4. **プロバイダー数の sanity check**: `docs/SETUP_GUIDE.md` の「サポートされているAIプロバイダー」表の行数・ドメインが、コード側の許可リスト (CSP 関連) および `src/utils/storage/providerDefaultBaseUrls.ts` の既定表と一致しているか確認する。ずれがあれば別 PBI 化する。
5. **CHANGELOG 記録**: 上記で変更が発生したら `CHANGELOG.md` の `[Unreleased]` に「四半期 AI モデルレビュー (YYYY-MM-DD)」として 1 行で記録する。変更なしでも本 PBI に実施日と結果 (変更なし) を追記する。

実施時期の目安: 1月・4月・7月・10月の各月初。Groq の臨時退役発表があれば随時前倒ししてよい。

## 初回分 (本起票時に実施済み)

- `docs/FAQ.md` Q15 (日英): Groq 設定例 `llama-3.3-70b-versatile` を `openai/gpt-oss-20b` に置換した。理由: リポジトリ既定 (`defaults.ts:53`) と同一の live モデルで、Groq 設定文脈に最も適合するため。
- `docs/SETUP_GUIDE.md` OpenAI Compatible の Model Name 例 (日英): `llama-3.3-70b-versatile`, `gpt-4o-mini` を `openai/gpt-oss-120b`, `gpt-4o-mini` に置換した。理由: 同行は Groq と OpenAI の両例を示す文脈のため、Groq 側の例だけを live な大規模モデル (`openai/gpt-oss-120b`) に替え、OpenAI 側の `gpt-4o-mini` は温存した。
- 日英の対応行は両言語で同一モデル ID になるよう揃えた。

## BDD受け入れシナリオ

```gherkin
Scenario: 四半期レビューで死んだモデル参照を見つける
  Given 前回のレビューから 3 か月が経過した
  And Groq deprecations ページに新たな退役モデルが載っている
  When 四半期チェックリストの 1 と 2 を実施する
  Then 死んだ ID の全箇所 (コード既定・docs 日英) が列挙される
  And 置換または別 PBI 化のいずれかが記録される

Scenario: 四半期レビューで変更がない
  Given チェックリスト 1〜4 を実施した
  And 死んだ参照も上限の矛盾もプロバイダー数のずれもない
  When チェックリスト 5 に従う
  Then 本 PBI に実施日と「変更なし」が追記される

Scenario: 初回分の置換が両言語で一致する
  Given docs/FAQ.md と docs/SETUP_GUIDE.md の日英の対応行
  When モデル ID を読む
  Then 日英で同一の live モデル ID が記載されている
  And `llama-3.3-70b-versatile` の文字列が両ファイルに残っていない
```

## 受け入れ基準

- [x] 初回分: `docs/FAQ.md` (日英 2 箇所) の死んだ参照を live モデルへ置換した
- [x] 初回分: `docs/SETUP_GUIDE.md` (日英 2 箇所) の死んだ参照を live モデルへ置換した (OpenAI 側の例は温存)
- [x] 初回分: `node scripts/check-docs-chars.mjs` が対象ファイルで exit 0
- [x] 初回分: locale 未変更 (docs のみ) のため `npm run check-i18n` 対象外であることを確認した
- [ ] 四半期チェックリスト 1〜5 が本 PBI に定義されている (起票済み)
- [ ] 次回レビュー (2027-01 目安) の実施時にチェックリスト 1〜5 を回し、結果を本 PBI に追記する

## テスト戦略 (t_wadaスタイル)

- docs のみの変更のため新規テストは追加しない。
- `node scripts/check-docs-chars.mjs <touched files>` で Shift-JIS 範囲外文字の混入を検査する (exit 0 が合格)。
- locale (`_locales/`) に触れていないため `npm run check-i18n` は対象外。触れた場合のみ実行する。
- 既存テストへの影響はない (docs のみ)。そのため追加のテスト実行は不要と判断した。

## 見積もり (RICE-lite)

- RICE: 1.0 (Reach 2 × Impact 1 × Confidence 0.5 / Effort 1.0)。到達は新規 Groq ユーザーに限定、影響は接続失敗の回避、確信度は退役ペースの読みの不確かさで中、工数は文書 4 行のため小。
- SP: S (docs のみ、初回分は起票時に対応済み)。

## 決定事項

1. **なぜプロセス PBI なのか**: モデル退役は繰り返す外部変化であり、一度のコード修正では終わらないため。実装 (adaptive retry) は別決定済み (issue #202) で、本 PBI は点検運用だけを担う。
2. **なぜ初回分を起票時に直すのか**: 死んだ参照は既に確認済みで、置換先の live モデルも確定しているため、別 PBI に分けず本起票で実施した。
3. **なぜ FAQ と SETUP_GUIDE で置換先が違うのか**: FAQ Q15 は Groq 設定の文脈なので既定と同一の `openai/gpt-oss-20b` を、SETUP_GUIDE は Groq/OpenAI 両例の文脈なので Groq 側だけ `openai/gpt-oss-120b` を選んだ。両方 live であることはタスク指示の deprecations 要約で確認済み。
4. **なぜ `gpt-4o-mini` を残すのか**: OpenAI 公式 API の現行モデル例であり、Groq 退役の影響を受けないため。
5. **なぜ root CHANGELOG.md なのか**: `docs/CHANGELOG.md` は存在しないため、四半期記録先は root の `CHANGELOG.md` とする。

## Definition of Done

- [x] 初回分の docs 置換 (4 箇所) が適用されている
- [x] docs 文字種チェックが exit 0
- [x] `pbi/00-INDEX.md` に本 PBI の行が追加されている
- [ ] 次回四半期レビューの結果追記 (継続運用)
