# PBI 2026-09-12-25 — メッセージ毎 restore() ファンアウトの削減（round 11 prune の hot-path 回帰修正）

- **種別**: 🔧非機能追加（fix・perf 回帰修正）
- **優先度**: 1 位 / RICE **40.0**（R25 × I1 × C80% / E0.5人日）
- **出典**: round 12 診断 候補 25・サブエージェント探索 + 直接検証

## 背景（なぜ）

`messageHandler.ts:30` が**全メッセージ**で `Promise.all([isCacheInitialized.restore(), autoSavedBadgeTabs.restore()])` を実行する。round 11（PBI 24）の prune port 追加後、`AutoSavedBadgeTabs.restore()` は保存済み tabId 毎に `chrome.tabs.get` を fan-out し（swStatePersistence.ts:99-122）+ 永続化書込を行う。`CHECK_DOMAIN` は `MIGRATION_SKIP_TYPES`（envelopePolicy.ts:93-98）でマイグレーションを skip するが restore は skip されず、loader のコールドパスが毎回 tabs RPC × N を払う。

## スコープ

- restore を SW 起動 1 回 + `handleTabRemoved` 後に限定（prune も同時）
- `messageHandler` の per-message restore を削除（isCacheInitialized は初回のみでよく、restore は冪等）
- restore 済みフラグで 2 回目以降を no-op 化（必要最小限の変更）

## 受け入れ基準（BDD）

### シナリオ 1: 2 通目以降のメッセージで restore が発火しない（ハッピーパス）
```gherkin
Given 最初のメッセージで restore が完了している
When 2 通目のメッセージを受信する
then chrome.tabs.get が呼ばれない（handler は直接実行される）
```

### シナリオ 2: tabRemoved 後は prune が走る（境界）
```gherkin
Given タブが閉じられた
When handleTabRemoved が完了する
then prune を含む restore が 1 回実行され stale tabId が初期化される
```

## DoD

- [x] per-message restore 削除・起動/tabRemoved 限定化
- [x] restore 呼び出し回数 pin テスト
- [x] background 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `RestoreOnce` seam 新設: `restoredOnce()` / `resetRestoreOnce()`。`createAutoSavedBadgeTabs` が restore-once 化（1 回目のみ fan-out・以後 no-op）
- `messageHandler` の per-message restore は削除せず no-op 化（restore-once により 2 回目以降は即 return — MessageHandlerDeps の interface 変更を避ける最小修正）
- `handleTabRemoved` が `resetRestoreOnce()` + `removeAndFlush` を実行（prune 再発火点）
- ctx 型は `resetRestoreOnce?` オプショナル（既存 test mock 互換）・tabCache は `removeAndFlush?` オプショナル参照
- 検証: restoreOnce 3 tests 新設・tab 3 ファイル 41 tests green・type-check green・lint 0 errors

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし（restore の意味論は不変・発火点のみ変更）
