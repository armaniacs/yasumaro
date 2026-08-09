# PBI: panel 層から dashboard.ts への逆依存を解消する

**作成日**: 2026-08-09
**優先度**: 中
**見積もり**: 🔴大（5pt目安）
**副作用**: 🔴あり（Dashboard 初期化経路の変更。全設定画面の回帰リスク）
**種別**: ♻️リファクタリング（refactor）

> ⚠️ **本PBIは PBI 2026-08-08-09 の Phase 2 / Phase 4 を切り出したものである。**
> 同PBIは Phase 1・3 完了で 🔶 部分実装。残り2つを最新の実測値で書き直した。
> **PBI-09 と重複して実施しないこと。** 本PBI完了時に PBI-09 を ✅ に更新する。

---

## フェーズ0: 既実装確認（実施済み・2026-08-09）

PBI-09 の Phase 1・3 は**完了済み**。本PBI着手時点の実測値:

```bash
wc -l < src/dashboard/dashboard.ts          # → 842（PBI-09執筆時は967）
ls src/dashboard/markdownExport.ts           # → 存在（Phase 1 完了）
grep -n "\.click()" src/dashboard/dashboard.ts  # → 50行の1箇所のみ（Phase 3 でフォールバック化）
```

**PBI-09 執筆時から状況が変わっているため、本PBIの数値を正とすること。**

---

## 背景

新しい panel 層が、それが置き換えるはずだった旧 god module に依存している。

### 逆依存の実態（実測）

```typescript
// src/dashboard/panels/staticForm/generalSettingsPanel.ts:6-12
import {
  loadGeneralSettings,
  handleSaveOnly, handleTestObsidian, handleTestAi, handleTestLocalMarkdown,
  handlePurgeNow, handleContentPurgeNow, handleManualLocalMarkdownExport,
  handleGenerateWeeklySummary, handleGenerateMonthlySummary,
  getAiProviderElements, syncStatusToTop,
} from '../../dashboard.js';   // ← 12個を旧 god module から輸入
```

**依存の向き**: `main.ts` → `panels/` → `dashboard.ts`
（`dashboard.ts` は panel 層が解体するはずだった 842行のモジュール）

### 重要な事実: 本番の import 元は1ファイルだけ

```bash
grep -rn "from '../../dashboard.js'\|from './dashboard.js'\|from '../dashboard.js'" src entrypoints --include='*.ts' | grep -v '__tests__'
# → src/dashboard/panels/staticForm/generalSettingsPanel.ts:12  （これ1件のみ）
```

**`generalSettingsPanel.ts` が唯一の本番 import 元。**
つまり「12個のハンドラを移す」だけで逆依存は消える。

### 二重ブートストラップ

```typescript
// entrypoints/options/main.ts
import '../../src/dashboard/dashboard.js';   // 副作用: dashboard.ts:841 の void initDashboard()
import '../../src/dashboard/main.js';        // 副作用: NavigationRegistry + 18 panels
```

**同じページに独立した初期化系が2つ並走している。**

### 順序依存が構造化されている

Phase 3 の成果として、クリック合成は「registry が未構築なときのフォールバック」に降格した。
そのコメントが**問題の核心を明示している**:

```typescript
/**
 * Prefers the NavigationRegistry, falling back to clicking the sidebar button
 * when the registry is not up yet: entrypoints/options/main.ts imports this
 * module before src/dashboard/main.ts, so at initDashboard() time the panels
 * may not be registered.
 */
```

**「dashboard.ts が main.ts より先に import される」という順序に依存している。**
この順序依存こそが Phase 4（単一ブートストラップ化）で解消すべきもの。

### なぜなぜ分析

**なぜ1**: なぜ panel が旧モジュールから import するのか
→ panel 抽象の導入時、**mount（配置）だけを移し、behaviour（振る舞い）を残した**から。

**なぜ2**: なぜ振る舞いを残したのか
→ ハンドラが `document.getElementById` で DOM を直接掴んでおり、
panel の `container` スコープに閉じていないため、移動＝書き換えになるから。

**なぜ3**: なぜ DOM を直接掴んでいるのか
→ 元々 god module 内の関数で、スコープを意識する必要が無かったから。

**なぜ4**: なぜ今も直せないのか
→ **トップレベル副作用 `void initDashboard()` があるため、
`dashboard.ts` を import した時点で初期化が走る。**
依存を切るには初期化の主体も移す必要があり、作業が連鎖する。

**なぜ5（根本）**
**「配置」と「振る舞い」と「初期化」の3つが1モジュールに癒着しており、
panel 抽象は配置だけを剥がしたため、残り2つが旧モジュールに取り残されているから。**

---

## ユーザーストーリー

**開発者**として、**設定パネルをそれ単体で読み・テストできる状態**がほしい、
なぜなら**現在は panel を理解するのに 842行の旧モジュールを併読する必要があり、
初期化順序への暗黙の依存があるため単体テストも書けないから**。

## ビジネス価値

- **テスタビリティ**: `generalSettingsPanel`（205行）は現在テスト0件。
  逆依存を切ると単体テストが書けるようになる。
- **初期化の一本化**: 順序依存によるバグ（過去に `initDashboard` の名前衝突事故あり／commit f43c749）を構造的に防ぐ。
- **測定方法**: `dashboard.ts` を import する本番ファイル数（1 → 0）、
  `entrypoints/options/main.ts` の import 数（2 → 1）。

---

## BDD受け入れシナリオ

```gherkin
Scenario: panel 層が旧 god module に依存しない
  Given generalSettingsPanel が自己完結している
  When import 文を確認する
  Then dashboard.ts からの import が存在しない

Scenario: 初期化が1系統になる
  Given entrypoints/options/main.ts を確認する
  When import 文を確認する
  Then dashboard.ts の import が存在しない

Scenario: 初期化順序に依存しない
  Given panel 遷移が NavigationRegistry を通る
  When 設定パネルを開く
  Then クリック合成のフォールバックが使われない

Scenario: 設定画面の動作が変わらない
  Given 利用者が設定画面を開く
  When 保存・接続テスト・パージなどの操作を行う
  Then リファクタリング前と同一の結果になる

Scenario: generalSettingsPanel が単体テスト可能になる
  Given 逆依存が解消されている
  When generalSettingsPanel のテストを書く
  Then dashboard 全体の初期化なしに検証できる
```

---

## 受け入れ基準

- [ ] `generalSettingsPanel.ts` から `dashboard.js` の import が消えている
- [ ] `entrypoints/options/main.ts` の import が `main.js` 1本になっている
- [ ] `dashboard.ts` のトップレベル副作用 `void initDashboard()` が消えている
- [ ] `navigateToPanel` のクリック合成フォールバックが不要になり削除されている
- [ ] `generalSettingsPanel` に単体テストが追加されている（現在0件）
- [ ] 共有される関数（popup 等から使われるもの）は適切な共有モジュールに残っている
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` が通る
- [ ] **手動確認**: 設定画面の全操作（保存・各種テスト・パージ・エクスポート）

---

## テスト戦略（t_wadaスタイル / Outside-In）

### E2Eテスト（最小限）
- 設定画面を開き、保存・接続テストが動作する（既存E2E 185件で担保）
- **Phase 4 完了後は初期化経路が変わるため、E2E の再実行が必須**

### 統合テスト（中程度）
1. `generalSettingsPanel.mount()` が単独で動作する（dashboard.ts 非依存）
2. `NavigationRegistry` 経由の遷移でフォールバックが使われない
3. i18n 初期化が1回だけ走る

### 単体テスト（多数）
1. 移動した各ハンドラが単体で動作する
2. `getAiProviderElements` / `syncStatusToTop` の DOM 操作
3. 保存パイプライン（`saveDashboardSettings`）の呼び出し

### Outside-In の進め方
1. `generalSettingsPanel` の単体テストを書く（現在0件）→ 逆依存があるため書けないことを確認
2. ハンドラを1つずつ移す → テストが書けるようになる
3. 最後に初期化を移す

---

## 実装アプローチ

**Phase A（逆依存の解消）→ Phase B（単一ブートストラップ化）の順。**
Phase A 単独でマージ可能。

詳細は実装計画:
`dev-docs/plans/2026-08-09-pbi24-dashboard-reverse-dependency-plan.md`

---

## 見積もり

🔴大（5pt目安）— Phase A: 3pt、Phase B: 2pt。

---

## 技術的考慮事項

### 依存関係
- **PBI 2026-08-08-09 の Phase 1・3 が完了済みであること** — 済
- PBI 2026-08-09-22（単純委譲パネルの表化）とは**対象が異なるため競合しない**
  （22は9件の単純パネル、本PBIは `generalSettingsPanel`）
- ただし**22を先にやると `staticForm/` の見通しが良くなる**ため、順序としては 22 → 24 が望ましい

### テスタビリティ
`generalSettingsPanel`（205行）・`markdownTemplateManager`（410行）・
`settingsPipeline`（122行）はいずれもテスト0件。逆依存解消が前提条件になっている。

### 非機能要件
- **初期化順序**: Phase B で `dashboard.ts` を消すと i18n 初期化の実行位置が変わる。
  `setHtmlLangDir()` / `applyI18n()` の呼び出し順序に注意

---

## 実装者向け注記

### 着手前に必ず実行

```bash
# 1. 唯一の本番 import 元を確認する（1件しかない）
grep -rn "from '.*dashboard\.js'" src entrypoints --include='*.ts' | grep -v '__tests__'

# 2. dashboard.ts の export 22件を確認する
grep -n "^export" src/dashboard/dashboard.ts

# 3. 各 export の他の利用者を調べる（移動先の判断材料）
for h in loadGeneralSettings handleSaveOnly handleTestObsidian handleTestAi \
         handleTestLocalMarkdown handlePurgeNow handleContentPurgeNow \
         handleManualLocalMarkdownExport handleGenerateWeeklySummary \
         handleGenerateMonthlySummary getAiProviderElements syncStatusToTop; do
  echo "--- $h"
  grep -rn "\b$h\b" src entrypoints --include='*.ts' | grep -v '__tests__' | grep -v "^src/dashboard/dashboard.ts"
done

# 4. テストがどれだけ dashboard.ts に依存しているか
grep -ln "from '../dashboard.js'" src/dashboard/__tests__/*.ts
```

### 落とし穴: 12個すべてが「移すべき」とは限らない

Step 3 の調査で**他の利用者がいる関数**が見つかったら、
それは共有モジュールに置くのが正しい。
「`generalSettingsPanel` に全部移す」と決め打ちしないこと。

**判断基準**:
| 利用者 | 移動先 |
|---|---|
| `generalSettingsPanel` のみ | panel 内へ移動 |
| 複数の panel / popup | 共有モジュール（新規 or 既存）へ |
| `dashboard.ts` 内部のみ | そのまま（export をやめる） |

### 落とし穴: トップレベル副作用の除去は最後

`dashboard.ts:841` の `void initDashboard()` を先に消すと、
**i18n 初期化やイベント登録が一切走らなくなり画面が壊れる。**
必ず「移動 → 新しい呼び出し元を作る → 旧副作用を消す」の順。

### 落とし穴: クリック合成フォールバックは Phase B まで消せない

`dashboard.ts:44-51` の `navigateToPanel` は、
「registry 未構築時のフォールバック」として**現在は必要**。
Phase B で初期化順序が一本化されて初めて不要になる。
**Phase A の段階で消さないこと。**

### 落とし穴: テストが dashboard.ts を import している

```bash
grep -ln "from '../dashboard.js'" src/dashboard/__tests__/*.ts
```

これらのテストは import した時点で `void initDashboard()` が走る前提で書かれている
可能性がある。移動に伴い**テスト側の修正も必要**。

### 落とし穴: 手動確認が必須

`generalSettingsPanel` はテスト0件、`dashboard.ts` も主要部分が未テスト。
自動テストだけでは回帰を検出できない。**設定画面の全操作を手で確認すること。**

---

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `generalSettingsPanel` の単体テストが追加されている
- [ ] `grep -rn "from '.*dashboard\.js'" src entrypoints --include='*.ts' | grep -v '__tests__'` が0件
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` が通る
- [ ] **手動確認**: 設定画面の保存・接続テスト・パージ・エクスポート
- [ ] コードレビュー完了
- [ ] **PBI 2026-08-08-09 を ✅ 完了に更新し、本PBIへの参照を追記する**

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補05）
- **PBI 2026-08-08-09（dual bootstrap）— 本PBIはその Phase 2/4 を切り出したもの**
- PBI 2026-08-09-22（単純委譲パネルの表化）— 先に実施すると見通しが良い
- 過去の事故: commit f43c749（`initDashboard` の名前衝突）
- ADR 2026-07-13 #1（Panel 抽象の導入）
