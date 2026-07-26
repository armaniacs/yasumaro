# PBI-27: popupの設定UI（settingsScreen）をダッシュボードに一本化する 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-26-27-fix-popup-dashboard-settings-duplication.md`（PBI本文は「共有モジュールの依存関係が不明なため保留」としていたが、本計画のフェーズ0再調査で全依存関係を確定させた）

**Goal:** `entrypoints/popup/index.html`の`settingsScreen`（4タブ、209-657行）を、`mainScreen`はそのまま残しつつダッシュボードへの誘導リンクに置き換える。popup/dashboard間で共有されるモジュールの初期化コードをpopup.tsから安全に削除する。

**Architecture:** popup.tsが担っている責務を「mainScreen専用」と「settingsScreen専用」に明確に分離し、後者のみを削除する。dashboard側は既に独立してこれらの機能を初期化しているため、popup側の削除がdashboard側に影響しないことを事前調査で確認済み。

**Tech Stack:** TypeScript, Vitest, Chrome Extension Manifest V3, jsdom

---

## フェーズ0再調査で確定した事実（本計画作成時点、2026-07-27）

PBI本文が「未確認」としていた依存関係を全て特定した。**この調査により、PBI本文が想定していたリスク（`domainFilter.ts`型の共有モジュールを削除するとdashboard側が壊れる）は限定的であることが判明した。**

### 発見1: popup側モジュールは2つの異なる再利用パターンに分かれる

**パターンA: 「共有ロジックモジュール」型（dashboard側がpopup側の`init()`をそのまま呼ぶ）**

| モジュール | dashboard側の呼び出し元 |
|---|---|
| `src/popup/domainFilter.ts` | `src/dashboard/panels/staticForm/domainFilterPanel.ts`（`initDomainFilter`）, `src/dashboard/exportImport.ts`（`loadDomainSettings`） |
| `src/popup/customPromptManager.ts` | `src/dashboard/panels/staticForm/promptSettingsPanel.ts`（`initCustomPromptManager`） |
| `src/popup/privacySettings.ts` | `src/dashboard/panels/staticForm/privacySettingsPanel.ts`（`init as initPrivacySettings`, `loadPrivacySettings`）, `src/dashboard/exportImport.ts`（`loadPrivacySettings`） |

これら3モジュールは**削除禁止**。`document.getElementById`で該当DOM要素を取得するロジックがdashboard側`panel-domain`/`panel-prompt`/`panel-privacy`のDOM構造にそのまま依存しているため、popup.tsからの`init*()`呼び出しを削除してもファイル自体は残す。

**パターンB: 「dashboard独自実装」型（popup側とは別ファイルでdashboardが独立実装済み、機能欠落なし）**

| 機能 | popup側 | dashboard側（別実装） |
|---|---|---|
| Master Password | `src/popup/masterPasswordUi.ts`（`initMasterPasswordUi`, `loadMasterPasswordSettings`, `showPasswordAuthModal`） | `src/dashboard/masterPassword.ts`（`initMasterPasswordSettings`, `loadMasterPasswordSettings`）— **popup側と同名だが別ファイル・別実装** |
| Settings Export/Import | `src/popup/settingsExportImportUi.ts` | `src/dashboard/exportImport.ts`（`initExportImport`）+ `src/dashboard/encryptedBackupPanel.ts` + `src/dashboard/gistSettings.ts` |

**この発見の重要性**: `masterPasswordUi.ts`と`settingsExportImportUi.ts`は**popup.tsからのみimportされている**（`grep -rn`で確認済み、dashboard側からの参照ゼロ）。つまりこれらはsettingsScreen専用の機能であり、popup.tsの`initPopup()`から呼び出しを削除しても、dashboard側は自身の独立実装（`masterPassword.ts`, `exportImport.ts`）で完全に代替できる。**機能欠落は発生しない。**

### 発見2: `entrypoints/popup/index.html`のDOM構造

```
<div id="mainScreen">          ← 15行目、記録ボタン・ステータス表示（削除対象外）
<main id="settingsScreen">     ← 209〜657行、4タブ（generalTab/domainTab/promptTab/privacyTab）
  <div id="generalPanel">      ← 236行、Obsidian接続・AIプロバイダー・記録条件
  <div id="domainPanel">       ← 367行
  <div id="promptPanel">       ← 488行
  <div id="privacyPanel">      ← 552行、Privacy Mode + Master Password設定 + PII confirm
</main>
<dialog id="passwordModal">    ← 660行、settingsScreenの外側（独立ダイアログ）
<dialog id="passwordAuthModal"> ← 695行、settingsScreenの外側（独立ダイアログ）
```

`passwordModal`/`passwordAuthModal`は`</main>`（657行）より後にあり、**`settingsScreen`要素の外側**に定義されている。これらは`masterPasswordUi.ts`が操作するダイアログであり、settingsScreen削除時に一緒に削除してよい（トリガーとなる`changeMasterPassword`ボタンが`privacyPanel`内にあり、privacyPanel削除により到達不能になるため）。

### 発見3: `masterPasswordEnabled`のID重複に注意

`entrypoints/popup/index.html`には`id="masterPasswordEnabled"`が**615行目にも存在する**ように見えたが、実際は`privacyPanel`（552-657行）の範囲内の1箇所のみ（615行はprivacyPanel内の相対位置）。重複はない。ただしdashboard側`entrypoints/options/index.html:1512`にも同一IDが存在し、これは別のDOM（別ページ）のため問題ない。

### 発見4: `popup.ts`の`initPopup()`は`mainScreen`専用の機能とも密結合している

`initPopup()`は`settingsScreen`関連の初期化だけでなく、Onboarding Wizard・Pending Pages Dialog・Privacy Consent・Tranco通知など**`mainScreen`側の機能の初期化も同じ関数内で行っている**（`src/popup/popup.ts:112-247`）。したがって`initPopup()`関数自体は削除せず、関数内から`settingsScreen`専用の初期化呼び出しのみを取り除く。

---

## Task 1: settingsScreen専用の初期化コードをpopup.tsから削除する

**Files:**
- Modify: `entrypoints/popup/index.html`
- Modify: `src/popup/popup.ts`
- Modify: `src/popup/navigation.ts`

- [ ] **Step 1: 削除対象の初期化呼び出しを`popup.ts`内で正確に特定する**

`src/popup/popup.ts`の`initPopup()`内で、settingsScreen専用と判定できるブロック:
- `initSettingsExportImportUi(load, showPasswordAuthModal)`（114行、Export/Import UI = settingsScreen専用）
- `initMasterPasswordUi()`（117行、Master Password UI = settingsScreen専用）
- `initDomainFilter()`（142行、DOM要素は`domainPanel`内のみ = settingsScreen専用の**呼び出し**。ただし`domainFilter.ts`ファイル自体は削除しない、Task 2で扱う）
- `initPrivacySettings()`（149行、`privacyPanel`内のみ）
- `initCustomPromptFeature()`（155行、内部で`initCustomPromptManager`を呼ぶ、`promptPanel`内のみ）
- `initTabNavigation()`（135行、settingsScreenのタブ切り替え専用）
- `load()`（159行、`getSettingsFormElements()`経由でsettingsScreen内のフォーム要素を読み込む処理。**要確認**: `load`がmainScreen側の要素も読むかどうかは`settingsForm.ts`を先に確認すること）
- `setupAIProviderChangeListener`, `setupAllFieldValidations`, `setupSaveButtonListener`, `setupOllamaPresetListener`（164-196行、全てgeneralPanel内のフォーム要素専用）
- `loadMasterPasswordSettings()`（213行）

`mainScreen`専用として**残す**もの:
- `setHtmlLangDir()`, `initNavigation()`, `initPrivacyConsent()`, `setupPrivacyConsentListeners()`, `initTrancoUpdateNotification()`, `loadPendingPages()`+関連のPending Pages処理, Onboarding Wizard処理

- [ ] **Step 2: `settingsForm.ts`の`load()`と`getSettingsFormElements()`がmainScreen側のDOM要素を扱っていないか確認する**

```bash
grep -n "getElementById\|querySelector" src/popup/settingsForm.ts | head -30
```

全てgeneralPanel内のID（`apiKey`, `protocol`, `port`, `dailyPath`, `aiProvider`等）のみであることを確認する。もしmainScreen側の要素（例: 記録ステータス表示）も混在していたら、その部分だけ残すよう関数を分割する必要がある。

- [ ] **Step 3: 既存テストを確認し、削除対象コードに依存するテストを洗い出す**

```bash
find src/popup/__tests__ -iname "*popup*"
grep -rln "initPopup\|initSettingsExportImportUi\|initMasterPasswordUi\|initDomainFilter\|initPrivacySettings\|initCustomPromptFeature" src/popup/__tests__/
```

- [ ] **Step 4: 失敗するテストを書く（settingsScreen削除後の`initPopup()`の期待動作）**

既存の`popup.test.ts`（該当ファイルが見つかった場合）に、以下を追記する:

```typescript
it('does not initialize settingsScreen-only modules (Export/Import, Master Password, Domain Filter, Privacy Settings, Custom Prompt)', async () => {
  // settingsScreen が index.html から削除された後の initPopup() が
  // これらのモジュールを呼ばないことを、各initXxx関数のモック呼び出し回数で検証する
});

it('still initializes mainScreen-only modules (Navigation, Privacy Consent, Tranco Notification, Pending Pages, Onboarding Wizard)', async () => {
  // mainScreen 側の初期化は引き続き行われることを検証する
});
```

Run: `npm test -- popup.test`
Expected: FAIL（現時点では`initPopup()`がまだsettingsScreen初期化を含むため、「呼ばれない」ことを期待するテストが失敗する）

- [ ] **Step 5: `popup.ts`の`initPopup()`からsettingsScreen専用の初期化呼び出しを削除する**

Step 1でリストした呼び出しを`initPopup()`から削除し、`import`文も未使用になったものを削除する。`initCustomPromptFeature`関数自体（98-106行）も呼び出し元がなくなるため削除する。`initTabNavigation`（38-79行）も同様。

- [ ] **Step 6: `entrypoints/popup/main.ts`のimportを整理する**

```typescript
// entrypoints/popup/main.ts
import './styles.css';
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../../src/utils/i18n-dom.js';
import '../../src/popup/navigation';
import '../../src/popup/main';
import '../../src/popup/popup';
import '../../src/popup/domainFilter';  // ← この行を削除するか要検討（Step 7参照）
```

`'../../src/popup/domainFilter'`の直接importは、`domainFilter.ts`のトップレベルコード（`document.getElementById`呼び出し等）がpopup.html読み込み時に実行されることを期待している可能性がある。`domainFilter.ts`の`init()`がpopup.ts経由で呼ばれなくなった後もこの直接importが必要か、`domainFilter.ts`の実装を確認して判断する（Task 2 Step 1で確認する）。

- [ ] **Step 7: `entrypoints/popup/index.html`から`settingsScreen`（209-657行）と関連ダイアログ（660-731行付近、`passwordModal`/`passwordAuthModal`）を削除し、ダッシュボードへの誘導リンクに置き換える**

削除範囲を正確に把握するため先に全体を確認する:

```bash
grep -n "<main id=\"settingsScreen\"\|</main>\|<dialog id=\"passwordModal\"\|<dialog id=\"passwordAuthModal\"\|</dialog>\|</body>" entrypoints/popup/index.html
```

`settingsScreen`本体（`<main id="settingsScreen">` 〜 対応する `</main>`）を、以下のような誘導リンクに置き換える（既存の`#menuBtn`が既に`showSettingsScreen()`経由でダッシュボードを開く導線を持っているため、`settingsScreen`表示部分自体は不要。誘導メッセージのみ残す場合の例）:

```html
<!-- Settings have moved to the dashboard. #menuBtn opens it in a new tab (see navigation.ts). -->
<div id="settingsMovedNotice" class="hidden" role="note">
  <p data-i18n="settingsMovedToDashboard">Detailed settings are now available in the dashboard.</p>
</div>
```

**この誘導リンクを実際に表示するかどうかは実装アプローチ次第。** `#menuBtn`が既にクリック一発でダッシュボードを新規タブで開き`window.close()`する実装（`navigation.ts:60-70`）になっているため、そもそも`settingsScreen`表示状態に遷移するUIパス自体が存在しない（`showSettingsScreen()`は画面遷移ではなくダッシュボードへのリダイレクトとして機能している）。したがって、**`settingsScreen`のDOM自体を完全に削除し、誘導リンクの新規UI要素も追加しない**のが最もシンプルな対応である（受け入れ基準のGherkinシナリオが求める「案内とリンクの表示」は、既存の`#menuBtn`がその役目を既に果たしていると解釈する）。この判断をPBIのDefinition of Doneと照らして矛盾しないか、着手時に確認すること。

- [ ] **Step 8: `navigation.ts`の`showSettingsScreen()`を確認し、`settingsScreen` DOM削除後も安全に動作するか確認する**

```typescript
// src/popup/navigation.ts:60-70 付近（既存コード、要Read確認）
export function showSettingsScreen(): void {
  // settingsScreen要素へのdocument.getElementById呼び出しがある場合、
  // nullチェックがあるか確認する。既にダッシュボードを新規タブで開く実装であれば
  // settingsScreen要素への参照が不要になっているはずなので、その行も削除する。
}
```

不要になった`settingsScreen`関連のDOM参照コードを削除する。

- [ ] **Step 9: テストを実行し、Step 4で書いたテストがパスすることを確認する**

```bash
npm test -- popup.test navigation.test
```
Expected: PASS

---

## Task 2: 共有モジュール（domainFilter.ts / customPromptManager.ts / privacySettings.ts）がpopup.ts経由の呼び出しなしでも動作することを確認する

**Files:**
- Verify only（コード変更なし、または`entrypoints/popup/main.ts`のimport整理のみ）

- [ ] **Step 1: `domainFilter.ts`のトップレベルコードを確認する**

```bash
grep -n "^const\|^let\|document.getElementById" src/popup/domainFilter.ts | head -20
```

トップレベルで`document.getElementById('domainList')`等を実行し、moduleスコープの変数に保持しているか（`popup.ts`が`init()`を呼ばなくても、importされた時点でDOM参照が発生する設計か）を確認する。もしトップレベルで完結する初期化がある場合、`entrypoints/popup/main.ts`の`import '../../src/popup/domainFilter';`は残す必要がある。

- [ ] **Step 2: dashboard側の該当パネルが、popup.tsの初期化に依存せず独立して動作することを確認する**

```bash
npm test -- domainFilterPanel promptSettingsPanel privacySettingsPanel
```

これらのテストは`popup.ts`をimportしていないはず。パスすることを確認し、popup.ts側の変更の影響を受けないことを実証する。

- [ ] **Step 3: popup側の`domainPanel`/`promptPanel`/`privacyPanel` DOM削除後、`domainFilter.ts`等のトップレベルコードが`null`を安全に扱うか確認する**

Task 1 Step 7でDOM削除後、`document.getElementById('domainList')`等が`null`を返すようになる。`domainFilter.ts`が`null`チェックをせずに`.value`等にアクセスしていればランタイムエラーになる。

```bash
grep -n "getElementById" src/popup/domainFilter.ts src/popup/privacySettings.ts src/popup/customPromptManager.ts
```

**ここが最大の落とし穴**: これらのモジュールはpopup.htmlとdashboard(options.html)の両方から読み込まれる共有モジュールのため、popup.html側でDOM要素が消えても、dashboard(options.html)側では引き続き同じ要素が存在する。**問題は「popup.htmlのコンテキストで、このモジュールがimportされた際にnullを渡されてクラッシュしないか」**。既存のnullチェック実装で対応できていれば変更不要。対応できていない場合、Task 2はこの防御コードの追加を含める。

- [ ] **Step 4: 型チェック・全テストで検証する**

```bash
npm run type-check
npm test
```

---

## Task 3: 手動ブラウザ確認と全体検証

**Files:** なし（手動確認のみ）

- [ ] **Step 1: `npm run build`でビルドが通ることを確認する**

- [ ] **Step 2: 実Chromeブラウザで拡張機能を読み込み、以下を確認する**
  1. popupを開き、`mainScreen`（記録ボタン・ステータス表示）が正常に表示・動作する
  2. `#menuBtn`をクリックし、ダッシュボードが新規タブで開き、popupが閉じることを確認する
  3. ダッシュボードの各パネル（General/Domain Filter/Prompt/Privacy/Export-Import）を開き、設定の保存・読み込みが正常に動作することを確認する
  4. ダッシュボードでMaster Passwordの有効化・無効化、パスワード変更ダイアログが正常に動作することを確認する（dashboard独自実装の`masterPassword.ts`経由）
  5. ダッシュボードでExport/Import機能が正常に動作することを確認する

- [ ] **Step 3: 既存の全自動テストがパスすることを確認する**

```bash
npm run validate
```

- [ ] **Step 4: `pbi/00-INDEX.md`の該当行を更新する**

---

## コミット方針

Task単位で個別コミットする:
1. `refactor(popup): settingsScreen専用の初期化コードをpopup.tsから削除`（Task 1）
2. `refactor(popup): 共有モジュールのDOM参照をnull安全に整理`（Task 2、変更が発生した場合のみ）
3. `refactor(popup): settingsScreenのDOMをentrypoints/popup/index.htmlから削除`（Task 1 Step 7、Task 1に含めても可）

## 実装者への注記

- **最大のリスクはTask 2 Step 3**。`domainFilter.ts`/`privacySettings.ts`/`customPromptManager.ts`はpopup/dashboard両方から読み込まれる共有モジュールであり、popup側のDOM削除後にnullを安全に扱えるかが安全な削除の鍵となる。ここを飛ばして進めないこと。
- **Master Password / Export-Import機能は機能欠落しない**（Task 1着手前の調査で確定済み）。dashboard側は`src/dashboard/masterPassword.ts`と`src/dashboard/exportImport.ts`という独立実装を既に持っているため、popup側の`masterPasswordUi.ts`/`settingsExportImportUi.ts`の呼び出し削除はdashboard側に一切影響しない。
- PBI本文のGherkinシナリオ「案内とダッシュボードへのリンクが表示される」は、既存の`#menuBtn`の動作（クリックで即座にダッシュボードへ遷移）で実質的に満たされていると解釈する。新規UI（案内メッセージ画面）を追加するかどうかは実装時にDefinition of Doneと照らして最終判断すること。
