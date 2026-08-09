# PBI-24: panel 層から dashboard.ts への逆依存解消 実装計画

> **Source PBI:** `pbi/2026-08-09-24-refactor-dashboard-reverse-dependency.md`（フェーズ0調査済み・2026-08-09）
> **前提:** PBI 2026-08-08-09 の Phase 1・3 完了済み（本PBIはその Phase 2/4）

**Goal:** `generalSettingsPanel` を自己完結させ、
`entrypoints/options/main.ts` の二重ブートストラップを一本化する。

**Tech Stack:** TypeScript (nodeNext ESM), Vitest, jsdom

**所要目安:** 5pt（Phase A: 3pt / Phase B: 2pt）

---

## 現状の正確な把握（PBI-09 執筆時から変化している）

| 項目 | PBI-09 執筆時 | **現在（2026-08-09 実測）** |
|---|---|---|
| `dashboard.ts` 行数 | 967 | **842** |
| Markdown エクスポート業務ロジック | 同居（約150行） | **`markdownExport.ts` へ分離済み** |
| クリック合成 | 主経路 | **registry 優先・フォールバックに降格** |
| `void initDashboard()` | あり | **あり（未解決）** |
| panel→dashboard の逆依存 | あり | **あり（未解決）** |

**本PBIが扱うのは下2つ。**

---

## 最重要の発見: 移すべきは12個すべてではない

`generalSettingsPanel.ts` が import する12個のうち、
**2個は `dashboard.ts` 内部で多用されている共有ユーティリティ**である（実測）。

| 関数 | `dashboard.ts` 内部での使用 | 判断 |
|---|---|---|
| `syncStatusToTop` | **9箇所**（299, 306, 344, 348, 467, 492, 505, 553, 557行） | **共有モジュールへ** |
| `getAiProviderElements` | **1箇所**（197行） | **共有モジュールへ** |
| `handleSaveOnly` ほか10個 | 0箇所（panel からのみ） | **panel へ移動** |

**「12個全部を panel に移す」と決め打ちすると、
`dashboard.ts` 内部が壊れるか、循環 import が生まれる。**

---

## Step 0: 現状確認（実装ではない・必須）

- [ ] 唯一の本番 import 元を自分の目で確認する

```bash
cd /Users/yaar/Playground/obsidian-smart-history
grep -rn "from '.*dashboard\.js'" src entrypoints --include='*.ts' | grep -v '__tests__'
# → src/dashboard/panels/staticForm/generalSettingsPanel.ts の1件だけ
```

- [ ] 12個それぞれの利用者を調べ、**下表を自分で埋める**

```bash
for h in loadGeneralSettings handleSaveOnly handleTestObsidian handleTestAi \
         handleTestLocalMarkdown handlePurgeNow handleContentPurgeNow \
         handleManualLocalMarkdownExport handleGenerateWeeklySummary \
         handleGenerateMonthlySummary getAiProviderElements syncStatusToTop; do
  echo "=== $h"
  grep -rn "\b$h\b" src entrypoints --include='*.ts' | grep -v '__tests__'
done
```

| 関数 | dashboard.ts 内部 | panel | その他 | 移動先 |
|---|---|---|---|---|
| （自分で埋める） | | | | |

- [ ] `dashboard.ts` を import しているテストを確認する

```bash
grep -ln "from '../dashboard.js'" src/dashboard/__tests__/*.ts
```

- [ ] **手動で現状を記録**: `npm run build` → Chrome で設定画面を開き、
      保存・接続テスト・パージの動作を確認・スクリーンショット

---

## Phase A: 逆依存の解消（3pt・単独マージ可）

### Step A-1: `generalSettingsPanel` のテストを書こうとして失敗を確認（Red）

- [ ] `src/dashboard/panels/staticForm/__tests__/generalSettingsPanel.test.ts` を作成

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';

describe('generalSettingsPanel', () => {
  it('dashboard 全体の初期化なしに mount できる', async () => {
    document.body.innerHTML = '<div id="panel-general"></div>';
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);
    expect(panel.id).toBe('panel-general');
  });
});
```

- [ ] 実行する → **`dashboard.ts` の import により `void initDashboard()` が走り、
      chrome API 未定義などで失敗することを確認**。これが逆依存の実害

### Step A-2: 共有ユーティリティを切り出す

- [ ] `src/dashboard/statusView.ts`（新規）に `syncStatusToTop` を移す

```typescript
/**
 * Mirrors the bottom status element into the sticky top bar.
 *
 * Lives here rather than in dashboard.ts because both dashboard.ts (9 call
 * sites) and generalSettingsPanel need it; leaving it in dashboard.ts is what
 * forced the panel layer to import from the module it was meant to replace.
 */
export function syncStatusToTop(): void { /* dashboard.ts から移動 */ }
```

- [ ] `src/dashboard/aiProviderElements.ts`（新規）に `getAiProviderElements` を移す
      **既存の `aiProviderLayoutManager.ts` / `settings/aiProvider.ts` に
      置くのが自然でないか先に検討すること**

```bash
# 既存の置き場所候補を確認
grep -n "AIProviderElements" src/dashboard/settings/aiProvider.ts src/dashboard/aiProviderLayoutManager.ts
```

- [ ] `dashboard.ts` を新モジュールから import するよう書き換える
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(dashboard): 共有UIユーティリティをdashboard.tsから切り出す`

### Step A-3: ハンドラ10個を panel へ移す

**1つずつ移す。まとめて移さない。**

- [ ] 移動順（依存の少ない順）:
  1. `handleGenerateWeeklySummary` / `handleGenerateMonthlySummary`（薄いラッパー）
  2. `handleManualLocalMarkdownExport`
  3. `handlePurgeNow` / `handleContentPurgeNow`
  4. `handleSaveOnly`
  5. `handleTestObsidian` / `handleTestLocalMarkdown`
  6. `handleTestAi`（**126行・最大。最後に**）
  7. `loadGeneralSettings`

各関数について:
- [ ] `dashboard.ts` から `generalSettingsPanel.ts` へ移動
- [ ] `dashboard.ts` の `export` を削除
- [ ] `dashboard.ts` 内部で使われていないことを確認（Step 0 の表）
- [ ] `npm run validate`
- [ ] コミット

- [ ] **落とし穴**: `handleTestAi`（126行）は
      `createConnectionStatusElement` / `testAiConnection` / `formatProviderHeadline` 等を使う。
      これらも移すのか共有にするのか、Step 0 の表で判断すること

- [ ] **落とし穴**: `generalSettingsPanel.ts` が肥大化する（205行 + 移動分）。
      **500行を超えるようなら、panel 配下にサブモジュールを作って分割する**
      （例: `generalSettings/connectionTests.ts`）

### Step A-4: 逆依存が消えたことを確認

- [ ] import が消えていることを確認

```bash
grep -rn "from '.*dashboard\.js'" src entrypoints --include='*.ts' | grep -v '__tests__'
# → 0件になっているべき
```

- [ ] Step A-1 のテストを実行 → **通ること**（Green）
- [ ] `generalSettingsPanel` の単体テストを充実させる（現在0件だった）
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(dashboard): panel層からdashboard.tsへの逆依存を解消する`

**ここで Phase A 完了。単独マージ可。**

---

## Phase B: 単一ブートストラップ化（2pt）

**Phase A 完了が前提。** 初期化経路を変えるため回帰リスクが最も高い。

### Step B-1: `initDashboard` の中身を棚卸しする

- [ ] `src/dashboard/dashboard.ts:819-841` の `initDashboard()` を読む
- [ ] 何をしているか列挙する（i18n 初期化・イベント登録・パネル遷移など）

```bash
sed -n '805,842p' src/dashboard/dashboard.ts
```

- [ ] `entrypoints/options/main.ts` が既に行っている処理と**重複していないか**確認

```typescript
// entrypoints/options/main.ts の現状
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
import '../../src/dashboard/dashboard.js';   // ← 副作用で initDashboard() が走る
import '../../src/dashboard/main.js';
setHtmlLangAndDir();
applyI18n();
translatePageTitle('dashboardTitle');
```

**`setHtmlLangDir()` が dashboard.ts にもある（805行）。二重実行の可能性を確認すること。**

### Step B-2: 初期化を `main.ts` へ移す

- [ ] `src/dashboard/main.ts` に、`initDashboard()` の残存処理を移す
- [ ] **順序に注意**: パネル登録 → i18n → 初期パネル遷移 の順が壊れないこと

```typescript
// src/dashboard/main.ts（Phase B 後のイメージ）
const registry = new NavigationRegistry();
setRegistry(registry);
const bootstrapper = new DashboardBootstrapper(registry);
bootstrapper.registerPanels([...]);

const sidebar = document.getElementById('sidebar');
if (sidebar) bootstrapper.wireSidebar(sidebar);

// initDashboard() から移した処理をここに
await initDashboardChrome();   // i18n・グローバルイベント等

bootstrapper.start('panel-general');
```

- [ ] `dashboard.ts:841` の `void initDashboard()` を削除
- [ ] `entrypoints/options/main.ts` の `import '../../src/dashboard/dashboard.js';` を削除
- [ ] `npm run validate`

### Step B-3: クリック合成フォールバックを削除

**Phase B で初期化順序が一本化されて初めて安全に消せる。**

- [ ] `dashboard.ts:44-51` の `navigateToPanel` を確認
- [ ] registry が必ず構築済みになったので、フォールバックを削除する

```typescript
function navigateToPanel(panelId: string): void {
  getRegistry().navigate(panelId);
}
```

- [ ] `tryGetRegistry` が他で使われていなければ削除する
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(dashboard): 初期化を単一ブートストラップに統合する`

### Step B-4: `dashboard.ts` の残骸を整理

- [ ] `dashboard.ts` に何が残っているか確認する

```bash
wc -l src/dashboard/dashboard.ts
grep -n "^export" src/dashboard/dashboard.ts
```

- [ ] 残りが「どこからも使われない」なら削除、
      共有されるものが残るならファイル名を実態に合わせて改名を検討する
      （**改名は任意。無理にやらない**）

---

## Step C: 検証（必須）

- [ ] `npm run validate`
- [ ] `npm run build`
- [ ] `npm run test:e2e` — **Phase B で初期化経路が変わるため必須**
- [ ] **手動確認**（自動テストでは不足）

| 操作 | 確認内容 |
|---|---|
| 設定画面を開く | 一般設定タブが初期表示される |
| 保存 | 設定が保存され、ステータスが上下バーに出る |
| Obsidian 接続テスト | 結果が表示される |
| AI 接続テスト | 進捗と結果が表示される |
| ローカルMarkdownテスト | 結果が表示される |
| パージ実行 | 実行され件数が出る |
| 週次/月次サマリー生成 | 動作する |
| 全18パネルの遷移 | すべて開く |

- [ ] Step 0 で撮ったスクリーンショットと比較
- [ ] CHANGELOG.md に記載
- [ ] **`pbi/00-INDEX.md` の PBI 2026-08-08-09 を ✅ に更新し、本PBIへの参照を追記**

---

## 完了確認チェックリスト

- [ ] `grep -rn "from '.*dashboard\.js'" src entrypoints --include='*.ts' | grep -v '__tests__'` が **0件**
- [ ] `entrypoints/options/main.ts` の dashboard.js import が無い
- [ ] `void initDashboard()` が無い
- [ ] `generalSettingsPanel` に単体テストがある
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` すべて成功
- [ ] 手動確認8項目すべて完了

---

## 困ったときの判断基準

| 状況 | 判断 |
|---|---|
| 12個全部を panel に移したくなった | **移さない。** `syncStatusToTop`(9箇所) / `getAiProviderElements` は共有モジュールへ |
| 循環 import が発生した | 共有すべきものを panel に入れた証拠。共有モジュールへ切り出す |
| `generalSettingsPanel` が肥大化した | panel 配下にサブモジュールを作って分割する |
| `void initDashboard()` を先に消したくなった | **消さない。** 画面が壊れる。移動 → 新呼び出し元 → 削除 の順 |
| クリック合成を Phase A で消したくなった | **消さない。** Phase B まで必要（registry 未構築時の保険） |
| Phase B が終わらない | **Phase A だけでマージしてよい。** 逆依存解消だけでも価値がある |
| E2E が落ちた | 初期化順序を疑う。特に i18n の実行位置 |
