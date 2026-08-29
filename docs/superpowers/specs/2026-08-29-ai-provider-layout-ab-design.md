# AIプロバイダ設定 A/B 比較実験 — 設計書

- Date: 2026-08-29
- Topic: AIプロバイダ設定のA（優先度一体型：現行）とB（優先度と設定を分離）のトグル比較
- Approach: 案2 単一状態＋二つのレンダラー
- Status: Draft — 要レビュー

## 1. 背景と目的

現行のAIプロバイダ設定（A）は、優先度1〜3の各カードの中にプロバイダ選択＋接続情報（Base URL / API Key / モデル）が一体で入り、`aiProviderLayoutManager` がDOMをカード間で `appendChild` 移動させる方式。機能は満たすが「どの順で使うか」と「各プロバイダの接続情報をどう持つか」が結合しており、見通しが悪い。

Bでは「①優先度（フェイルオーバー順）」と「②プロバイダ別設定（常設）」を分離し、優先度は `provider + model上書き` の軽いリスト、接続情報はプロバイダごとに一元管理する。どちらが分かりやすいかを実地で比較するため、初期設定画面（Initial Setup / panel-general）のAIセクション内でA/Bをトグル切替できる実験を実装し、後で勝者を残して敗者を削除する（X）。

## 2. 全体アーキテクチャ（案2）

```
chrome.storage.local
  - ai_provider_priority_list: ProviderSlot[]  // A/B共通、長さ0-3
  - gemini_api_key / gemini_model / gemini_api_version
  - openai_base_url / openai_api_key / openai_model
  - openai_2_*, lm_studio_*, ollama_*, provider_*
  + ai_provider_layout: 'a'|'b'               // 新規、実験用
        ↕
SettingsRepository + settingsFormBinding (GENERAL_SETTINGS_SCHEMA駆動)
        ↕
generalSettingsPanel.ts
  - ヘッダートグル（segmented control）→ ai_provider_layout保存 → refreshAIProviderLayout()
  - if (layout==='b') renderB() else renderA()
        ↕
Background: RemoteAIService.resolveProviderSlots() / FallbackAIService（変更なし）
```

- ストレージとBackgroundは一切変更しない。
- Dashboardの `generalSettingsPanel.ts` 内でのみ分岐。
- トグル切替はDOM再生成のみで保存データは不変（Save押下までstorageを汚さない）。

## 3. 要件サマリ（ヒアリング結果）

| 項目 | 決定 |
|------|------|
| Bの分離イメージ | 優先度は `provider + model上書き` のみ、Base URL/API Key/ベースモデルは下の常設エリアで一元管理 |
| トグル配置 | AIプロバイダーセクションの `<h3>` 右側、segmented control（`button[aria-pressed]`×2） |
| 優先度スロット数 | 3固定（Aと同じ、P1必須 / P2,P3任意） |
| 重複扱い | 同一 `provider+model` の完全一致のみ警告、同プロバイダでもモデルが異なれば重複許可 |
| プロバイダ別設定の見せ方 | アコーディオン常設（7種を縦並び、使うものだけ開く） |
| モデル上書き | Bでも優先度スロット側に残す（同じプロバイダで別モデルを試すため） |
| 初期値 | 新規ユーザー（`onboardingWizardCompleted==false && priorityList.length===0`）→ `b`、既存ユーザー→ `a`、以降は手動切替を尊重 |
| 永続化 | `chrome.storage.local` に `ai_provider_layout` を保存、再起動後も保持（Yes） |
| 実験終了後 | 敗者のコードを削除（X） |

## 4. コンポーネント設計

### 4.1 Aレンダラー（既存ラップ）

- `renderA()` は既存の `updateAIProviderVisibilityMulti(selectedSet)` + `updateProviderSettingsLayout(slots)` をラップして呼ぶだけ。
- 追加コードは `hideBContainers()` と分岐のみ。
- 既存のHTML（`details.priority-details`×3、`#geminiSettings`等）、CSS、テストはそのまま活きる。
- ファイル変更は `generalSettingsPanel.ts` の分岐追加のみ。

### 4.2 Bレンダラー（新規）

#### PriorityListView

- 3行固定。各行: 左ドラッグハンドル `≡` + `select`（7種+未設定） + `input`（モデル上書き、placeholder「モデル名（省略可、デフォルト使用）」）。
- HTML5 Drag & Dropで順序入替。DnD不可環境では各行に `↑` `↓` ボタンで代替（a11y対応）。
- 変更時は `ProviderSlot[]` を再構築し、ヘッダーの `priority-provider-name` 表示と `updateProviderSettingsLayout` 相当のサマリを更新。
- 重複検証: `provider+model` の完全一致が2つ以上あれば該当行を赤枠＋警告メッセージ。保存はブロックしない（Aに合わせて警告のみ）。
- 必須検証: P1が未設定のまま保存しようとしたら `aiProviderPriority1Required` エラー表示。

#### ProviderAccordionView

- 7プロバイダの設定群を常設アコーディオンで表示。
- 既存の `#geminiSettings` 等のDOMを**移動せず**、B用コンテナ `#bProviderAccordion` に初期配置し `hidden` で開閉。
- A→B切替時に `restoreAll()` で一旦元の位置に戻してからBコンテナへ再配置。`appendChild` はイベントリスナを保持するため値・リスナは維持。
- 各アコーディオンの中身は既存の `data-storage-key` 付き `input` をそのまま流用。新規DOMは作らない（バリデーション・i18n・暗号化が自動で効く）。

#### 新規ファイル（案）

```
src/dashboard/aiProviderB/priorityListView.ts
src/dashboard/aiProviderB/providerAccordionView.ts
src/dashboard/aiProviderLayoutToggle.ts
```

既存ファイルへの変更は最小限（`generalSettingsPanel.ts` の分岐、`storage/types.ts`・`defaults.ts`・`settingsSchemas.ts` に1キー追加、`_locales` に5キー追加）。

### 4.3 トグル

- `#aiProviderSection .settings-section-title` の横に `role="group" aria-label="AI provider layout"` 内の `button[aria-pressed]`×2。
- ラベル: `A 一体型` / `B 分離型`（i18n: `aiProviderLayoutA` / `aiProviderLayoutB`）。
- クリックで `await repo.set(AI_PROVIDER_LAYOUT, value)` → `refreshAIProviderLayout()`。
- キーボード: `Tab` でフォーカス、`Space`/`Enter` で切替。

## 5. データモデルとストレージ

### 5.1 共通（変更なし）

- `ai_provider_priority_list: ProviderSlot[]`（`{provider: ProviderId|string, model?: string}`）。A/Bとも長さ0-3、空文字は無視、trim。
- 各プロバイダ別: `gemini_api_key` / `gemini_model` / `openai_base_url` 等は `ProviderRegistry` がSSOT。

### 5.2 新規

- `StorageKeys.AI_PROVIDER_LAYOUT = 'ai_provider_layout'`
- `defaults.ts`: `AI_PROVIDER_LAYOUT: 'a'`（コード上のデフォルトは安全側）
- `GENERAL_SETTINGS_SCHEMA` に `AI_PROVIDER_LAYOUT` を追加（`settingsFormBinding` と `SettingsRepository` はスキーマ駆動で自動対応）。

### 5.3 初期値ロジック

`loadGeneralSettings()` 内、初回のみ:

```ts
let layout = await repo.get(StorageKeys.AI_PROVIDER_LAYOUT);
if (layout == null) {
  const all = await repo.getAll();
  const isNewUser = !all[StorageKeys.ONBOARDING_WIZARD_COMPLETED] && (all[StorageKeys.AI_PROVIDER_PRIORITY_LIST]?.length ?? 0) === 0;
  layout = isNewUser ? 'b' : 'a';
  await repo.set(StorageKeys.AI_PROVIDER_LAYOUT, layout);
}
```

以降はユーザーの手動切替を尊重し再判定しない。

### 5.4 保存フロー

- A: `collectProviderPrioritySlots()`（既存、3 select/modelを走査）
- B: `collectBProviderPrioritySlots()`（同型、Bの3 select/modelを走査）
- どちらも `newSettings[AI_PROVIDER_PRIORITY_LIST] = slots` → `saveSettingsWithAllowedUrls()` で同一キーへ保存。

### 5.5 削除時（X）

- B勝利: `renderA()` とA用HTML（`details.priority-details`×3の移動ロジック呼出）、分岐 `if(layout==='b')`、トグルUI、`AI_PROVIDER_LAYOUT` 定義を削除。
- A勝利: B用3ファイルとB用HTMLコンテナを削除。
- どちらでも1コミットで完結する粒度。

## 6. エラーハンドリングとエッジケース

| ケース | 扱い |
|--------|------|
| 同一provider+同一modelの重複 | 赤枠＋警告 `aiProviderPriorityDuplicateWarning`、保存はブロックしない（Test AI時も警告再表示） |
| 同一provider+異なるmodel | 許可（例: `groq/gemma-4-31B` と `groq/gemma-2-9B`） |
| P1が未設定 | エラー表示 `aiProviderPriority1Required`、保存を止める（Aのフォールバック `gemini` は残すがBではUIで防ぐ） |
| A→B/B→A切替直後 | `restoreAll()` 経由でDOM所有権を明確化、未保存入力値はDOMに残るため消失しない。切替自体はstorageを汚さない |
| ドラッグ不可環境 | 各行の `↑` `↓` ボタンで順序入替 |
| 権限/CSP | Bでも `select` 変更時に `permissionManager` の動的権限要求を発火。`conditional_csp_providers` は `priority_list` を見るためA/B共通で動作 |
| i18n未追加 | ビルド時に `_locales` のキー不足はCIで検出（既存の `validate` がカバー） |
| a11y | トグルは `aria-pressed`、優先度リストは `aria-label` とキーボード代替を提供 |

## 7. UI詳細

### 7.1 A（現行）

- `entrypoints/options/index.html` の `#aiProviderSection` 内、`details.priority-details`×3 + `#priorityXProviderSettings` + 既存の `#xxxSettings` を `aiProviderLayoutManager` が移動。変更なし。

### 7.2 B（新規）

- `#aiProviderSection` 内に `#bPriorityList`（優先度3行）と `#bProviderAccordion`（7アコーディオン）を追加。A表示時は `hidden`、B表示時はAの `details` を `hidden`。
- Bのアコーディオンは既存の `#geminiSettings` 等を内包するラッパ `details.b-provider-details` で再利用。CSSは既存の `dashboard.css` の `priority-details` を流用し、B用に `.b-priority-row` 等を数行追加。

### 7.3 トグル

- `dashboard.css` に `.ai-layout-toggle`（segmented control）を追加。既存のトークン（`--color-primary` 等）に準拠。

## 8. テスト計画

### Unit (Vitest)

- `priorityListView.test.ts`: 重複許可/禁止、ドラッグ順序、空スロット、collectBSlotsのtrim/空無視
- `providerAccordionView.test.ts`: 開閉、A↔B切替で値保持、data-storage-keyの保持
- `layoutToggle.test.ts`: 初期値出し分け（新規/既存/既に設定済み）、永続化、aria-pressed

### Integration

- `saveDashboardSettings` がA/Bどちらからでも同じ `ai_provider_priority_list` に保存されること
- `Test AI` ボタンがA/Bどちらでも正しい slotsで `RemoteAIService.testConnection` を呼ぶこと（`generalSettings/connectionTests.ts` の `handleTestAi` はslotsを直接参照しないため、保存後の `getAll()` 経由で正しく動作することを確認）

### Manual / E2E (Playwright)

- Dashboardで A↔Bを10回切替 → 入力値が消えない
- 新規プロファイル（storageクリア）でBが初期表示、既存プロファイルでAが維持
- 同一provider+異なるmodelの重複が保存できること、同一modelの重複で警告が出ること

## 9. 実装順序（writing-plansで詳細化）

1. `StorageKeys` / `defaults` / `GENERAL_SETTINGS_SCHEMA` / `_locales` に `ai_provider_layout` 追加
2. `aiProviderLayoutToggle.ts` と `#aiProviderSection` ヘッダーへのトグル挿入
3. `aiProviderB/priorityListView.ts` + `providerAccordionView.ts`（Bレンダラー）
4. `generalSettingsPanel.ts` の分岐 `renderA`/`renderB` と `restoreAll` 連携
5. `entrypoints/options/index.html` にB用コンテナ追加、`dashboard.css` に最小CSS追加
6. 初期値ロジック（新規/既存出し分け）を `loadGeneralSettings` に追加
7. Unit/Integrationテスト追加、手動確認

## 10. やらないこと（YAGNI）

- 4位以上の優先度追加（3固定を維持）
- プロバイダごとの有効/無効トグル（優先度リストで代替）
- スロットごとのBase URL上書き（共通化の利点を損なうため、モデル上書きのみ許可）
- Background / RemoteAIService の変更

## 11. リスクと対策

- **既存ユーザーの混乱**: 既存はAがデフォルトでBは手動切替のため、意図せずレイアウトが変わることはない。トグルは小さくAIセクション内に留める。
- **DOM移動の競合**: AとBで所有権を明確に分離し、切替時は必ず `restoreAll()` を経由。Bでは `appendChild` 移動をしない。
- **削除コスト**: 案2のため敗者削除は1コミットで完結。A/Bどちらが勝っても差分は小さい。

## 12. 決定ログ

- 2026-08-29: ヒアリングでBの分離定義、トグル配置A、重複はモデル差異があれば許可、プロバイダ表示はアコーディオン、初期値は新規B/既存A、永続化Yes、実験後X（削除）を決定。
- 2026-08-29: アプローチ案2（単一状態＋二つのレンダラー）を採用。
