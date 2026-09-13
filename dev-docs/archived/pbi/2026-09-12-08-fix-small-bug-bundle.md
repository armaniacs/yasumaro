# PBI 2026-09-12-08 — 小型バグバンドル（6 件）

- **種別**: 🔧非機能追加（fix）
- **優先度**: 8 位 / RICE **8.0**（R15 × I1 × C80% / E1.5人日）
- **出典**: round 9 診断 候補 08（サブエージェント探索・file:line は各項に記載）

## 背景（なぜ）

探索で見つかった小型の欠陥群。単独 PBI 化するほどではないが、放置すると顕在化時に追跡コストが高い。全件「最小 fix・挙動変更は欠陥の解消のみ」で実施する。

## スコープ（6 件）

- [x] **TabCache hang**: `src/background/tabCache.ts:33-48` — `chrome.tabs.query` callback が `lastError` 未確認・reject 経路なし → 失敗時に initPromise が未解決でメッセージ応答が hang。lastError チェック + reject + 呼び出し側フォールバック
- [x] **dequeue lock bypass**: `src/background/offlineNetworkQueue.ts:91-102` — dequeue が VULN-056 の queue lock を迂回（load→filter→save 直接）。`mutate` 経由に統一
- [x] **sender.tab! crash**: `src/background/handlers/systemHandlers.ts:147` — **PBI 07 で解消済み**（同一ハンドラのため吸収・guard + 早期 return + テスト）
- [x] **cleansing feedback 二重配線**: `src/popup/statusPanel.ts:463-495` — `initCleansingFeedbackButton` に `dataset.wired` guard がなく re-init 毎に handler が積み重なる（attachPrivacyActionListeners の再帰 init で発火）。既存 2 button と同一の wired 紀律を適用
- [x] **i18n cache stale**: `src/popup/errorUtils.ts:107-133` — `messagesCache` が無効化されず locale 切替後も旧言語。`chrome.i18n.getUILanguage()` を cache key にするか cache 廃止
- [x] **ublock 無音 drop（最小 fix）**: `src/utils/ublockMatcher.ts:52-53,91-92` — 両形式（domains + rules）混在 store で legacy rule 集合が無警告で無視される。挙動は変えず（統合は別判断）警告ログ + 両形式混在 pin テストを追加

## 受け入れ基準（BDD）

### シナリオ 1: 各 fix が欠陥を解消する（ハッピーパス）
```gherkin
Given 上記 6 項目の欠陥がある
When 各 fix を適用する
Then TabCache は失敗時に reject し、dequeue は lock 内で動作し、tab 無し sender は無視され、feedback button は一度だけ配線され、locale 切替後は新言語が表示され、両形式混在は警告される
```

### シナリオ 2: 最小 fix の原則（境界）
```gherkin
Given ublock 両形式混在
When matcher が index を構築する
Then 既存の優先規則（domains 優先）は不変で、警告ログのみ追加される
```

## DoD

- [x] 6 件実装 + 各 pin/回帰テスト
- [x] 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（警告ログ追加のみ・既存挙動不変）

## 実装メモ（2026-09-12）

- **TabCache hang**: lastError チェック + reject + 失敗時に initPromise をリセット（次回呼び出しが再試行する）。回帰テスト新設（lastError 付き callback で reject・リトライで成功）
- **dequeue/peek lock**: `QueuePort` に `mutate` を追加し、dequeue/peek を lock 内 read-modify-write に統一（peek は expiry 変化なしの場合は元リストを返して実質 read-only）。NoOpQueuePort も対応
- **sender.tab!**: PBI 07 で解消（吸収記録）
- **feedback 二重配線**: `dataset.wired` guard（PBI 2026-09-11-04 と同一紀律）
- **i18n cache**: `getUILanguage()` を cache key 化。cache なしの環境（stub）では '' にフォールバック
- **ublock**: 優先規則は不変のまま、両形式混在時の logWarn を block/exception 両系に追加 + pin テスト 2 件（警告あり / 単一形式では警告なし）
- 検証: tabCache 24 / offlineNetworkQueue / statusPanel-extra / errorUtils / ublockMatcher 計 217 tests green・type-check / lint 0 errors green
