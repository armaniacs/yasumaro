# Backlog: Checking Team ラウンド 2026-10-10（checking-team-1010）

Checking Team skill（22 観点・3 Wave）によるブランチ `1007z` vs `main` の差分レビュー結果を
10 個の独立実装単位に分解し RICE 採点して PBI 化（NN01-10）。

- レビュー報告書: [dev-docs/archived/plans/2026-10-10-2320-review-1007z.md](../dev-docs/archived/plans/2026-10-10-2320-review-1007z.md)（総合評価 86/100・ランク A。作業用コピーは `plans/2026-10-10-2320-review-1007z.md`。`plans/` は gitignore 対象）
- レビュー対象: `git diff main...HEAD`（57 commits / 199 files / +9155-1791、うちコード 137 files）
- 実行方式: 並列（Wave 1: 5観点 / Wave 2: 4クラスタ 11観点 / Wave 3: Test Experts）
- 実行済み 17 観点の平均 86/100。未完了 4 観点（Code Quality クラスタ）は平均から除外
- Wave 3 の独立検証: V1（非ASCII チャンクシーム）CONFIRMED / V2（末尾ピリオド email）CONFIRMED / V3（Red Team の chunk-seam teardown）REFUTED

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 今後1年の保守・利用での関与頻度（相対 1-10）
Impact: 3=実害解消 / 2=大きい / 1.5=中（部分的に実害） / 1=中（重複削減・規範化） / 0.5=小
Confidence: 1.0=コード・実測で確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 01 | [pii-core-detection-parity](2026-10-11-01-fix-pii-core-detection-parity.md) | fix | 9 | 3 | 0.9 | 3.0 | 8.1 | 3.0 | なし（09 の先行） |
| 02 | [privacy-mode-fail-closed](2026-10-11-02-fix-privacy-mode-fail-closed.md) | fix | 4 | 3 | 0.9 | 1.5 | 7.2 | 1.5 | なし |
| 03 | [sanitize-title-line-separators](2026-10-11-03-fix-sanitize-title-line-separators.md) | fix | 3 | 1.5 | 0.8 | 0.5 | 7.2 | 0.5 | なし |
| 04 | [i18n-keys-and-locale-ssot](2026-10-11-04-fix-i18n-keys-and-locale-ssot.md) | fix | 5 | 2 | 1.0 | 1.5 | 6.7 | 1.5 | なし（messages.json 独占） |
| 05 | [settings-toplevel-repair](2026-10-11-05-fix-settings-toplevel-repair.md) | fix | 5 | 3 | 0.8 | 2.0 | 6.0 | 2.0 | なし |
| 06 | [docs-release-notes-and-guides](2026-10-11-06-docs-release-notes-and-guides.md) | docs | 3 | 1 | 1.0 | 0.5 | 6.0 | 0.5 | なし（CHANGELOG 独占） |
| 07 | [status-type-and-focus-trap](2026-10-11-07-fix-status-type-and-focus-trap.md) | fix | 4 | 2 | 1.0 | 1.5 | 5.3 | 1.5 | なし（connectionTests 独占） |
| 08 | [e2e-probe-exposure](2026-10-11-08-fix-e2e-probe-exposure.md) | fix | 3 | 2 | 0.9 | 1.5 | 3.6 | 1.5 | なし（testDir を触る唯一） |
| 09 | [wasm-artifact-size-and-ci-gate](2026-10-11-09-chore-wasm-artifact-size-and-ci-gate.md) | chore | 3 | 1 | 1.0 | 1.0 | 3.0 | 1.0 | **01 の後**（wasm 再ビルドの共有） |
| 10 | [archive-wire-validation-ssot](2026-10-11-10-fix-archive-wire-validation-ssot.md) | fix | 2 | 1 | 0.8 | 2.0 | 0.8 | 2.0 | なし |

RICE = R × I × C / E。値は各 PBI 内「RICE」行と一致。

## 実行順（確定）とバッチ計画

RICE 降順（依存を尊重）。同点の裁定:
- **7.2 の 2-way**: NN02（privacy fail-open、I=3 の実害解消）を先頭。以後 NN03（I=1.5）
- **6.0 の 2-way**: NN05（fix、実害解消）を先頭。以後 NN06（docs）
- NN09 は NN01 の成果物（wasm バイナリ）に依存するため RICE 順位より後（W3）。**CI の paths フィルタ追加だけは NN01 と独立に先行してよい**

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 / 02 / 03 / 04 | PII 走査コア（wasm + TS sanitizer + corpus + bench）/ privacyPipeline + storage/types / markdownFormatter / messages.json + locale | 4 群が互いに非重複。04 は `public/_locales/*/messages.json` を独占 |
| W2 | 05 / 06 / 07 / 08 | settingsMigration + recordingTriggerManager / CHANGELOG + docs + AGENTS.md / settingsUiHelper + connectionTests + focusTrap / contentKernel + e2eTestState + testDir | 4 群が互いに非重複。08 は `testDir/` を触る唯一の PBI |
| W3 | 09 / 10 | wasm 成果物 + CI（01 着地後）/ archive wire 検証 | 09 は 01 の成果物に依存。10 は messaging 内で完結 |

**共通ファイル（統合側がバッチ境界で 1 回だけ更新）**: `pbi/00-INDEX.md`、本台帳。
NN01 と NN09 がどちらも wasm を再ビルドするため、**必ず直列（01 → 09）**にする。
NN01 は `Cargo.toml` を触らない（strip 設定は NN09）。`src/utils/piiSanitizer.ts` は NN01 のみが触る。

## 台帳送り（見送り・トリガー管理）

| # | テーマ | 理由 | 再検討トリガー |
|---|---|---|---|
| C1 | `scripts/check-innerhtml-escape.mjs` の検出範囲拡張（`el.innerHTML = <変数>` / `insertAdjacentHTML` / `outerHTML` / `srcdoc`） | ゲートを広げると既存コードベース全体に新規違反が出る可能性があり、自動実装での修正範囲が読めない。本ブランチが追加した `src/dashboard` の 2 箇所（`connectionTests.ts:347` / `:415`）はいずれも安全な DOM ビルドの読み戻しで生きた XSS ではない | 次に `innerHTML` 代入を新規追加する時、または dashboard の DOM 生成規約を触る時 |
| C2 | レイヤーゲートの盲点（`src/utils/cleansingBadge.ts:1` の `// @layer 0` が LAYERS.md 未登録の `contentExtractor/cleansedReason.js` を実行時 import。ゲートは明示登録パスのみ照合） | 現時点の推移的実害は型 import のみで小さい。ゲートを「未分類パス検出」に広げる改修は影響範囲が広い | `contentExtractor/` 側に実行時依存が入る時、または `eslint/rules/utils-layer-boundary.mjs` を触る時 |
| C3 | マッチ数上限 1000 到達時に記録全体が失敗し、理由がユーザーに見えない（`dispatch.rs:25,58-60` / `lib.rs:52,183-185` / `piiSanitizer.ts:21`） | 設計意図（部分マスク済みテキストを成功として出荷しない）は明記済みで本ブランチ由来ではない。UX 改善は別設計が必要 | 保存失敗の理由表示を触る時、または上限値を見直す時 |
| C4 | `\b` 前提により「非単語文字に直接隣接する IBAN」が TS/WASM 両方で未検出（Red Team 提示例の真因） | パターン設計の受容判断であり chunk 走査とは別件。検出を広げると誤検出が増える | PII パターン定義（`PII_PATTERNS` / `patterns/`）を改訂する時 |
| C5 | WASM バイナリの byte 再現性（toolchain / wasm-pack / Cargo.lock の固定） | 既存台帳 [2026-09-25-26-backlog-wasm-binary-reproducibility-watch.md](2026-09-25-26-backlog-wasm-binary-reproducibility-watch.md) の監視対象。NN09 は strip を入れるが byte 来歴の保証は主張しない | 同台帳のトリガー（toolchain / Cargo.lock / wasm-pack / build script / ship manifest の変更、供給網監査で byte provenance が要求された時） |
| C6 | `PrivacyPipeline.process(content, { alreadyProcessed: true })` のマスク無効化スイッチ本体（`privacyPipeline.ts:106,182,185`） | source policy からは到達不能。NN02 で「テスト専用」の JSDoc 明示までは行った。フラグ自体の削除は source 追加時に判断 | 次に `source` を追加する時 |
| C7 | `bench/micro/c8-pii-sanitize.bench.mjs` に「400文字超の空白なしトークン内部に email/電話を埋めた」フィクスチャを追加し、`docs/PERFORMANCE_TEST.md` の c8 数値を再計測して更新する（NN01 から分離） | 実測でチャンク重なり走査のコストが長トークン入力で WASM 2.8〜4.3 倍 / TS フォールバック最大 7.4 倍になるが、現行の記事フィクスチャでは +23% しか出ず回帰検知できない。`bench/baselines/micro.json` はマシン依存で `--update-baseline` は全指標を書き換えるため、性能 baseline の更新は性能専用の意図的な作業として行う必要がある（検出漏れ修正とは独立） | 次に性能 baseline を更新する時、または PII 走査の性能を再計測する時 |

- `pbi/` に残る他ラウンドの台帳送り（backlog-future 統合台帳、holistic-1009 の F 系、archloop-1010 の G1-G17、archloop-1007 の L2-L8）はトリガー未発火のため維持。
- 着手ゲート付きの未完了 PBI 2 件（`2026-09-05-32-refactor-wasqlite-sunset.md` は ADR-014 の 2026-12-17 ゲート、`2026-09-25-30-refactor-utils-namespace-reorg.md` は専用ブランチ + 着手トリガー）は未完了ではなく**ゲート待ち**であり、本ラウンドの対象外。

## 5 Whys サマリー（主要テーマ）

- **なぜ非ASCII 本文の継ぎ目で PII が落ちたのか** → Rust は UTF-8 バイト境界でチャンクを切るため `ceil_char_boundary` でチャンク開始を後方へずらしたが、重複スキップの閾値は「元の 200 グリッド + OVERLAP」を前提にしたままだった。なぜ前提を再計算しなかったか → クランプを「パニック回避の実装詳細」と捉え、TS との**グリッド同一性の主張（`lib.rs:138-141` のコメント）を検証しなかった**から。解: NN01（前チャンクの実カバー終端基準へ変更 + 非ASCII 回帰をコーパスに追加）
- **なぜ TS/Rust の email マッチャが乖離したのか** → TS 正規表現のバックトラック意味論を、Rust の非バックトラック実装（`rposition` で最後のドット固定）へ対応付けたが、末尾 `.` / `-` の形状が parity コーパスに無かった。なぜ無いまま「等価」と主張したか → parity ゲートの根拠が「収集済み入力の一致」であり、**意味論の網羅（バックトラックの有無が効く形状）を設計していない**から。解: NN01（右から候補ドットを試す最長一致 + 形状をコーパス・Rust テストに追加）
- **なぜ既移行インストールの設定が救われないのか** → `TOP_LEVEL_ONLY_KEYS` への追加を「移行ロジックの一部」として捉え、`isSettingsMigrationComplete` の完了ガードの外にある**既移行層の復旧を設計しなかった**から。なぜ気づけなかったか → allowlist の意味を「今後の移行の正しさ」としてのみ検証し、`main` のテストが `isMigratableStorageKey(RECORDING_TRIGGERS) === true` と表明していた事実（= 既に畳まれた）を反転させた影響を追わなかったから。解: NN05（移行フラグと独立した冪等リペアまたは blob リーダー）
- **なぜ wasm が 2.16 倍になったのか** → 移植でコードが純増したのに加え、`custom:name`（38.6KB）が付いたまま出荷され、**その存在を検知するゲートが CI に無かった**（唯一のサイズゲートは release 時の 15MB バンドル上限）。なぜ無いまま出荷できたか → wasm ゲートの責務を「挙動等価」に限定して設計し、成果物のバイト・サイズを責務に入れなかったから。解: NN09（Cargo strip + crate 単位サイズ上限 + paths フィルタに `public/wasm/**`）
- **なぜ archive の検証が二重定義のままなのか** → 境界値（8MB / 500）は SSOT 化したが、検証**規則**（必須性・ペア整合・query 長）は別ラウンドで別々に作られ、差分を「意図的に閉じない」テストで固定してしまった。なぜ固定したか → 差分を解消する工程を PBI に切らず、現状維持を明示する手段としてテストを使ったから。解: NN10（規則を 1 箇所から導出 + メッセージ修正）

## レビュー報告書サマリー

- **総合評価 86/100（A）**。実行済み 17 観点の平均（未完了 4 観点は除外）。
- **High 3 件**: (1) 非ASCII チャンクシームで PII 未マスク（本ブランチ regression、実測・独立検証済み）(2) 末尾ピリオド/ハイフン付き email が WASM 経路で未マスク（main からの既存バグ、parity 主張の穴）(3) 既移行インストールの自動保存トリガー設定が無言で既定値に巻き戻る。
- **Medium 15 件**: privacy_mode の fail-open、WASM の timeout 不在、E2E プローブの設定露出、Unicode 行区切り、i18n 未定義キー・キー流用・ロケール三系統、ステータス型の誤用、focusTrap の disabled、PII 機能ガイドの陳腐化、CHANGELOG 未記載、跨実装ゲート未更新、走査ループ構造、wasm サイズ・CI ゲート、archive 契約二重定義、チャンク重なり走査のコスト。
- **主な良好点**: PII ハイブリッドの fail-closed、SAVE 経路のマスク復活、`computeScopeHash` のバイト等価移設、`clearElement` 統一完了、purge の `runPurgeSequence` SSOT 化、`alarmRegistryRefs` 廃止による明示 DI、ja/en 1566 キー一致、PRIVACY.md byte 一致、依存追加ゼロ、SW リーク源の新規追加なし、レイヤー境界の改善（messaging → background の辺削除）。
- **棄却した指摘**: Red Team の [High]「chunk-seam teardown で長さ200未満の PII が丸ごと未マスク」は System Architect の裁定 + Wave 3 の独立掃引（開始位置 180..260 の 1 文字刻み）で REFUTED。提示例はパディング `'z'` が単語文字で `\b` が消えることが原因で、TS/WASM 両方が同じく不検出。真因は台帳送り C4。

## 実装状況

| NN | PBI | 状態 |
|---|---|---|
| 01 | pii-core-detection-parity | ✅ 完了・アーカイブ済み（`bd09e5a2`） |
| 02 | privacy-mode-fail-closed | ✅ 完了・アーカイブ済み（`481fc530`, `bd198de0`） |
| 03 | sanitize-title-line-separators | ✅ 完了・アーカイブ済み（`df91afb2`） |
| 04 | i18n-keys-and-locale-ssot | ✅ 完了・アーカイブ済み（`a8f1daba`, `bd198de0`） |
| 05 | settings-toplevel-repair | ✅ 完了・アーカイブ済み（`0f96cd4c`） |
| 06 | docs-release-notes-and-guides | ✅ 完了・アーカイブ済み（`a088ec4f`） |
| 07 | status-type-and-focus-trap | ✅ 完了・アーカイブ済み（`541fead2`） |
| 08 | e2e-probe-exposure | 未着手 |
| 09 | wasm-artifact-size-and-ci-gate | ✅ 完了・アーカイブ済み（`beb98820`） |
| 10 | archive-wire-validation-ssot | 未着手 |

### 完了分の検証（2026-10-11）

- 01: `cargo test` 54 passed / `npm run test:wasm` green / parity 223 + extended 59 green / `piiSanitizer.test.ts` 75 green / wasm src↔public byte 一致
- 02: 関連 13 ファイル 256 passed / インポート値域検証 12 ケース / `type-check` exit 0
- 03: `markdownFormatter.test.ts` 26 passed（新規 4 件）/ 関連 7 ファイル 108 passed
- 04: `npm run check-i18n` ALL PASSED（ja/en 1566 一致、ソース 597 キー全て存在）/ 関連 6 ファイル 215 passed
- 06: docs 系ゲート 4 種 green（JSON / layers / ADR / privacy）
- すべて `npm run validate` exit 0（1055 files / 15933 tests passed）
- 副次: closer の検証で露見した flaky 2 件（trustSettings の書き込み settle 漏れ・ReDoS 性能の単発サンプル）を `d44aa940` で原因側から修正。テスト型エラー baseline を 467 → 463 に返済（`bd198de0`）

