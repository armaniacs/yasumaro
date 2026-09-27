# PBI 10 調査報告: プリセットプロンプトのロケール対応方針

PBI: `pbi/2026-09-25-10-investigate-preset-prompt-locale.md`（investigate・production 変更なし）
日付: 2026-09-27

## 0. 調査台帳（現状の事実 — 実測行番号付き）

### 0.1 5プリセットの言語仕様（現状）

| id | 表示名 (name/nameJa) | userPrompt 言語 | systemPrompt 言語 | 備考 |
|---|---|---|---|---|
| default | Default / デフォルト | JA 固定コピー（`DEFAULT_USER_PROMPT_JA`） | JA 固定（`DEFAULT_SYSTEM_PROMPT_JA`） | 通常 Default（fallback）は `getDefaultUserPrompt/SystemPrompt(effectiveLocale)` で locale 対応済み。プリセット定義内のコピーは JA 固定 |
| tagged | With Tags / タグ付き要約 | JA 固定（カテゴリ候補 JA） | JA 固定 | `buildTaggedSummaryPrompt` が設定の追加カテゴリを動的反映 |
| bullet | Bullet Points / 箇条書き | JA 固定（日本語で箇条書き3点） | **EN 固定**（`DEFAULT_SYSTEM_PROMPT_EN`） | body JA × system EN の混成（現行動作） |
| english | English Summary / 英語要約 | EN 固定（`DEFAULT_USER_PROMPT_EN`） | EN 固定（`DEFAULT_SYSTEM_PROMPT_EN`） | |
| technical | Technical Focus / 技術的観点 | JA 固定（日本語で3点） | **EN 固定**（'You are a technical assistant...'） | body JA × system EN の混成（現行動作） |

出典: `src/utils/customPromptUtils.ts:123-166`。表示名分岐は `getPromptDisplayName`（`:184-191`、`name`/`nameJa` フィールド、メッセージキー不使用）。

### 0.2 保存・解決経路

- 有効化: `customPromptManager.ts:405-462` — `__preset__<id>` で upsert。**既存 entry は isActive のみ反転し、本文は現行定義で上書きしない**（スナップショット保持）。新規 entry は現行定義テキストを保存。
- 適用: `customPromptUtils.ts:applyCustomPrompt` — 保存済み custom（`__preset__*` 含む）が active なら**保存テキストを verbatim 使用**し、systemPrompt のみ fallback（`getDefaultSystemPrompt(effectiveLocale)`）。`locale` 引数あり、未指定時は `getBrowserLocale()` の暗黙参照。
- Default fallback（custom なし）: `getDefaultUserPrompt/SystemPrompt(effectiveLocale)` で locale 対応済み。
- 複製: `createPrompt`（`:358-367`）で `prompt_<timestamp>_<random>` を採番。由来・locale・version フィールドなし（`types.ts:28-37` の `CustomPrompt` に該当フィールドなし）。
- Default 複製は非推奨 JA 別名（`DEFAULT_USER_PROMPT`/`DEFAULT_SYSTEM_PROMPT` = `_JA`）を読む（manager `:484-485,571-574`）。

### 0.3 AI 反映と出力契約

- 本番反映 2 箇所: `ProviderStrategy.ts:276-280`、`BuiltInAiProvider.ts:59-70`（いずれも `applyCustomPrompt` 経由で解決済みテキストを受け取る）。
- Built-in AI: `builtInAIClient.ts:71-81` の `EXPECTED_OUTPUTS languages: ['ja']` + system prompt JA 固定。**English プリセットを built-in-ai 経由で使っても出力は日本語**（既知の制約として記録）。
- バックアップ: `custom_prompts` は暗号化バックアップの復元対象（`restorableSettings.ts:159-164`）。
- 既存テスト: `customPromptUtils.test.ts` + `customPromptManager.test.ts`（99 件 green 確認済み）。`localeParity.test.ts` 存在。
- PBI 09（popup-untranslated-title-token）はアーカイブ済み — `_locales` の共有編集競合は解消済み。表示名は name/nameJa フィールドのため `_locales` 変更自体が不要。

## 1. 5 Whys

### Q1: なぜ en で日本語が送られるのか

- **事実**: プリセット定義の本文 4/5 が JA 固定であり（§0.1）、保存済み `__preset__*` は verbatim 使用される（§0.2）。en locale ユーザーが tagged/bullet/technical/default-preset を選ぶと JA 指示が送られる。
- **判断材料**: UI locale 追従 / feature 固定 / English 固定の 3 候補（§2）。
- **裁定**: §2 のプリセット別裁定に従う。
- **残存リスク**: 旧スナップショット保持者は裁定後も旧本文のまま（§3 の更新 affordance で解消）。

### Q2: なぜ Default の locale 対応が直らないのか

- **事実**: fallback の Default 関数は locale 対応済みだが、active な保存済み prompt（`__preset__default` 含む）が fallback より優先される（`applyCustomPrompt`）。
- **判断材料**: fallback 関数の修正 / 保存済み snapshot の扱い変更。
- **裁定**: fallback 関数は正しいため触らない。保存済みの扱いは §3（stable ID resolve + 更新 affordance）で解決する。
- **残存リスク**: なし（原因特定済み）。

### Q3: なぜ更新後に自動修復されないのか

- **事実**: `__preset__*` は定義参照ではなく保存済みスナップショット。有効化時の upsert も既存 entry の本文を更新しない。
- **判断材料**: stable ID 実行時 resolve / 保持 / 自動置換。
- **裁定**: §3 — 自動置換は不採用（カスタマイズ意図の破壊）。stable ID resolve は「保存テキストが現行定義と byte-identical の場合のみ定義を使用」とし、それ以外は保存維持＋更新 affordance。
- **残存リスク**: byte-identical 判定は「ユーザーが1文字でも編集したら更新対象外」を意味するが、それは正しい（カスタマイズの保護）。

### Q4: なぜ全データを機械移行できないのか

- **事実**: 複製済み `prompt_<timestamp>` は通常 custom と同一構造で由来を判別できない（§0.2）。
- **判断材料**: ID による推定移行 / 一律保持。
- **裁定**: 一律保持（ユーザー所有スナップショット）。ID だけを根拠に `__preset__*` へ移行しない。
- **残存リスク**: なし。

### Q5: 最適仕様は何か

- **事実**: §0.1 の言語表 + §0.3 の出力契約。
- **判断材料**: 下記 §2 の候補比較。
- **裁定**: §2 の通り。
- **残存リスク**: Built-in AI 経由の English プリセットは日本語出力のまま（別 PBI として記録）。

## 2. プリセット別言語裁定

| プリセット | 裁定 | 根拠 |
|---|---|---|
| Default | **UI locale に従う**（現行 fallback 関数の動作をプリセット定義にも拡張） | Default は feature identity を持たない汎用要約。`getDefaultUserPrompt/SystemPrompt(effectiveLocale)` が既存の正本 |
| Tagged | **feature 固有言語（JA）で固定** | カテゴリ候補が JA。英訳するとタグ抽出の契約（`#タグ1 #タグ2 \| 要約` の JA カテゴリ照合）が壊れる |
| Bullet | **feature 固有言語（JA）で固定**（body も system も現状維持） | 「日本語で箇条書き3点」が feature。本体 EN system との混成は現行動作として変更しない（出力への影響が未知数） |
| English | **英語固定**（現状維持） | プリセットの存在意義そのもの。HTTP provider 経路では EN 出力になる |
| Technical | **feature 固有言語（JA）で固定**（body も system も現状維持） | 「日本語で3点」が feature。EN system との混成は現行動作として変更しない |

表示名（`getPromptDisplayName` の name/nameJa 分岐）は表示責務であり本文責務と独立 — 現状維持。本文の locale 分岐を `customPromptManager` に持ち込まない（責務境界維持）。

## 3. 保存済みスナップショットの移行方針

- **自動置換: 不採用**。保存テキストと現行定義の差分は「定義更新」と「ユーザーカスタマイズ」を区別できないため。
- **stable ID resolve: 条件付き採用**。`applyCustomPrompt` で `__preset__<id>` の保存テキストが現行定義と byte-identical の場合のみ現行定義を使用（等価なので挙動不変）。それ以外は保存維持。
- **更新 affordance（新規 UI）**: 保存テキストが現行定義と異なる `__preset__*` に対し、プリセット一覧へ「更新あり」表示 + ユーザー操作による「最新定義に更新」ボタンを追加する。明示的操作以外で置換・再関連付けを行わない（BDD シナリオ 3 の条件）。
- **複製済み `prompt_<timestamp>`**: ユーザー所有として保持。移行・置換の対象外。
- **バックアップ互換**: `custom_prompts` の復元内容を書き換えない。解決は実行時（runtime resolve）のため、旧 backup 復元後も同じ選択が再現される。新規フィールド（locale/version/由来）を保存型に追加しない。
- **復元後の再現条件**: 同一 `__preset__<id>` + 同一保存テキスト → 同一解決結果。byte-identical 規則は決定的。

## 4. 後続 PBI 仕様（`feat` 1 件・推定 2 SP）

**種別**: `feat`（ユーザー可視の仕様変更: Default の locale 追従拡張 + 更新 affordance UI の新設）。

**実装範囲**:
1. Default プリセット定義の locale 対応（`getDefaultUserPrompt/SystemPrompt(effectiveLocale)` の結果を定義解決時に使用。`customPromptUtils` 内に閉じる）
2. `applyCustomPrompt` の stable ID resolve（byte-identical 時のみ定義使用）+ locale 引数の明示化（呼び出し側で locale を渡す。`getBrowserLocale()` fallback は後方互換のため残す）
3. 更新 affordance UI（`customPromptManager` の DOM/event のみ。定義解決は `customPromptUtils` の関数として提供し、manager に本文分岐を持ち込まない）
4. en/ja parity 維持（`localeParity.test.ts` green 維持。`_locales` 変更は不要の見込み — 表示名は name/nameJa フィールド）

**BDD（Outside-In）**:
- en/ja ロケール × 5 プリセットの有効化 → 送信 `userPrompt`/`systemPrompt` と要約言語の言語表どおり（§2）
- 旧 `__preset__*` スナップショット・複製 `prompt_<timestamp>`・暗号化 backup 復元後の 3 ケースで選択が再現される
- 更新 affordance の明示操作なしに置換・再関連付けが起きない
- Built-in AI 経路は対象外（日本語固定の既知制約としてテストで pin する）

**制約**: `customPromptUtils`（定義・解決）と `customPromptManager`（DOM・event・persistence）の責務境界維持。機械向け本文は locale 明示。`types.ts` の保存型にフィールド追加しない。Built-in AI の `expectedOutputs`/system は触らない（別 PBI 化を明記）。

## 5. PBI 10 DoD との対応

- 5プリセットの言語関係: §0.1 ✅
- 5 Whys（事実・根拠・裁定・残存リスク）: §1 ✅
- 候補のプリセット別採否: §2 ✅
- 移行方針（stable ID / 保持 / 自動置換）: §3 ✅
- 複製のユーザー所有扱い: §3 ✅
- 3 種バックアップの非破壊条件: §3 ✅
- Built-in AI の出力契約: §0.3・§4 ✅
- 責務境界・locale 明示・parity・共有競合: §2・§4（PBI 09 アーカイブ済みのため競合なし）✅
- `feat` 1 件への分離: §4 ✅
- production 変更なし: 本報告書のみ ✅
