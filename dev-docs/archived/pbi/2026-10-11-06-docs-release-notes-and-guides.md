# PBI: CHANGELOG 6.9.40 の PII 修正記載・PII 機能ガイドの現行仕様化・clearElement 正典の追随

- 種別: docs
- RICE: 6.0（R3 × I1 × C1.0 / E0.5）
- 依存: なし（他 PBI とファイル非重複で並列可。CHANGELOG を触る唯一の PBI）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）Ethics & Bias Medium 1件 + Documentation Architect Medium 1件 + System Architect Low 1件

## ユーザーストーリー

利用者として、プライバシー挙動が変わる修正が出荷されたことをリリースノートで知りたい。なぜなら PII のマスク漏れ修正や長トークン検出の修正は「自分のデータがどう扱われたか」に関わる情報で、記載漏れは情報開示の非対称を生むから。あわせて開発者として、ドキュメントと正典パスが実装に追随していてほしい。

## 背景（現状・証拠）

### CHANGELOG 6.9.40 の記載漏れ

- `CHANGELOG.md:38-46` の `## [6.9.40] - 2026-10-10` はアーキテクチャ系 13 件のみを列挙している。
- バージョン bump と CHANGELOG 追記は `46069dda` で完了し、その後に同一リリース単位で以下が積まれた:
  - `088423cf` — SAVE_RECORD 経路の PII マスク漏れ修正（未マスク本文がクラウド AI へ送信されていた）
  - `bb93d482` / `7e328646` — 重なり付きチャンク走査による長トークン中間 PII の検出回避の修正（TS → WASM 移植）
  - `6a9da7d6` / `1bc43c2d` — `sanitizeTitle` の改行・CR 正規化による Markdown リンク注入対策
- `grep -in "pii\|マスク" CHANGELOG.md` の 6.9.40 節に該当記述は無く、AGENTS.md のリリースチェックリスト「CHANGELOG.md updated」を満たさないまま、ユーザーのプライバシー挙動が変わる修正が無告知で出荷される。
- バージョンは `package.json` / `package-lock.json` / `docs/version.json` で 6.9.40 に上がっており（manifest は `wxt.config.ts:14-21` 経由で同値を生成）、そのまま出荷される。

### PII 機能ガイドの陳腐化

- `docs/PII_FEATURE_GUIDE.md:113`（日本語）と `:326`（英語ミラー）の表に「ReDoS 長トークンガード | 100文字超の非空白連続はサンプリング走査 | 検出精度を保ったまま正規表現エンジンの暴走を防止」とある。
- 本ブランチの `src/utils/piiSanitizer.ts` から `neutralizeLongNonWhitespaceRuns` / `sampleMiddleForScan` は削除され（`grep` で src/ に残存 0 件）、PBI-16 で OVERLAP=200 の重なり付きチャンク走査（`wasm/pii-sanitizer/src/lib.rs`）＋ WASM コアへ置換されている。
- 防衛機構の説明が実装と食い違い、**現在は存在しない挙動**を読者（特に PII 挙動の監査者）に示している。英語側も同様。
- `docs/PII_FEATURE_GUIDE.md` は本ブランチの変更ファイルに含まれておらず、更新が漏れている。

### clearElement の正典が AGENTS.md で更新されていない

- `AGENTS.md:116` は「For element clearing, use `clearElement` from `src/popup/domUtils.ts`」と旧 shim を指している。
- 実際の正典は `src/utils/domClear.ts:1-16`（`// @layer 0`）で、`src/popup/domUtils.ts:2` は互換 shim、ゲート側 `scripts/check-innerhtml-escape.mjs:7` は更新済み。
- 次の実装者が shim 経由の import を増やすと、PBI 2026-10-09-15 が消したかった sibling 依存が再導入される。

## BDD 受け入れシナリオ

```gherkin
Scenario: 6.9.40 にプライバシー修正が記載されている
  Given CHANGELOG.md の 6.9.40 節を読む
  When 保存経路の PII マスク・長トークン PII 検出・タイトル注入対策の記載を探す
  Then 3 件すべてが「修正・改善」に列挙されている

Scenario: PII 機能ガイドが現行実装を説明している
  Given docs/PII_FEATURE_GUIDE.md を読む
  When 長トークンガードの説明を確認する
  Then 重なり付きチャンク走査（OVERLAP=200、WASM コア）として説明され、サンプリング走査の記述が残っていない
  And 日本語・英語の両方が同じ内容になっている

Scenario: clearElement の正典が AGENTS.md と実装で一致する
  Given AGENTS.md の DOM 節を読む
  When clearElement の正典パスを確認する
  Then src/utils/domClear.ts が正典、src/popup/domUtils.ts が互換 shim と記載されている
```

## 受け入れ基準

- [x] `CHANGELOG.md` の 6.9.40 節に「保存（SAVE_RECORD）経路でもクラウド AI 送信前に PII をマスクする」「タイトルの改行・CR を正規化し Markdown リンクへの注入を防ぐ」「長トークン内に埋め込まれた PII を WASM コアの重なり付きチャンク走査で検出する」の 3 件を追記する（既にリリース済みなら次版エントリに移す）
- [x] `docs/PII_FEATURE_GUIDE.md:113` / `:326` の長トークンガード説明を、OVERLAP=200 の重なり付きチャンク走査（`wasm/pii-sanitizer/src/lib.rs`）＋ 200 字超の残存リスクの記述に書き換える（日英同時）
- [x] `docs/PII_FEATURE_GUIDE.md` の他の記述で本ブランチの変更（WASM 優先・TS フォールバックの経路、`[MASKED:type]` 形式）と食い違う箇所が無いか確認する
- [x] `AGENTS.md:116` の `clearElement` を `src/utils/domClear.ts`（canonical）/ `src/popup/domUtils.ts`（compatibility shim）に書き換える
- [x] `public/PRIVACY.md` と `docs/PRIVACY.md` が引き続き byte 一致している（本 PBI では触らないが確認する）
- [x] ドキュメント整合ゲート（`npm run lint:layers-docs` / `lint:adr-links` / `validate:json`）が green
- [x] `npm run validate` が green

## テスト戦略

- 静的: `npm run lint:layers-docs` / `npm run lint:adr-links` / `npm run validate:json`
- 手動: 日英の PII 機能ガイドが同じ内容になっていること、CHANGELOG の 3 件が読み手に意味が通る文になっていること
- 回帰: `node scripts/release-checks/check-privacy.mjs` が PASS

## 見積もり

0.5 SP

## 技術的考慮事項

- `docs/PII_FEATURE_GUIDE.md` は日英ミラー構成のため、片方だけ直すと乖離が残る。同時に更新する
- CHANGELOG の既存文体（箇条書きの粒度・動詞の形）に合わせる
- 6.9.40 が既にリリース済みの場合は次版（6.9.41）のエントリとして書く。判断は `docs/version.json` と git タグで確認する
- AGENTS.md の該当行は 1 行の修正。他の正典パス（`escapeHtml` / `markdownSanitizer`）も同時に実装と一致しているか確認する

## 実装者向け注記

### 実装手順

1. `git log --oneline 46069dda..HEAD` で 6.9.40 に載るべきコミットを列挙する
2. CHANGELOG に 3 件を追記
3. `grep -n "サンプリング\|sampling" docs/PII_FEATURE_GUIDE.md` で陳腐化箇所を洗い、日英とも書き換える
4. AGENTS.md:116 を修正
5. `npm run validate`（docs 系ゲートを含む）

### 落とし穴

- CHANGELOG のアンカーやバージョン見出しの体裁を崩さない（`## [6.9.40] - 2026-10-10` の形式を維持）
- PRIVACY.md は触らない（触る場合は 2 ファイル同時更新が必須）

## Definition of Done

- [x] 6.9.40 に 3 件の PII 修正が記載されている
- [x] PII 機能ガイドの日英が現行実装と一致している
- [x] AGENTS.md の clearElement 正典が実装と一致している
- [x] docs 系ゲートと `npm run validate` が green
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 / commit `a088ec4f`）

| コマンド | 結果 |
|---|---|
| `npm run validate:json` | All JSON validations passed |
| `npm run lint:layers-docs` | layer lists in sync |
| `npm run lint:adr-links` | 61 ADRs — all implements references valid |
| `node scripts/release-checks/check-privacy.mjs` | PASS（PRIVACY.md は未変更） |
| `npm run validate` | exit 0（1055 files / 15933 tests passed） |

**追加で見つけた陳腐化**: `docs/assets/pii-sandbox.js`（追跡対象のビルド成果物）が削除済みの
サンプリング走査を含んだままだったため、`npm run build:docs-pii` で再ビルドし残骸を除去した。

