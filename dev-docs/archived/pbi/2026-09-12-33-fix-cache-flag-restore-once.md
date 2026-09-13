# PBI 2026-09-12-33 — CacheInitializedFlag の restore-once（round 12 PBI 25 の half-fix 解消 + Proxy echo 除去）

- **種別**: 🔧非機能追加（fix・perf 回帰修正）
- **優先度**: 1 位 / RICE **40.0**（R25 × I1 × C80% / E0.5人日）
- **出典**: round 13 診断 候補 33・サブエージェント探索 + 直接検証

## 背景（なぜ）

round 12 PBI 25 の restore-once は `AutoSavedBadgeTabs` にのみ適用され、`CacheInitializedFlag` は対象外だった。`messageHandler.ts:30` は**全メッセージ**で `isCacheInitialized.restore()` を await し、その restore は無条件に `chrome.storage.session.get` を叩く（swStatePersistence.ts:48-50）。さらに `createCacheInitializedFlag` の Proxy set trap（:54-61）が `restore()` 自身の `flag.value = ...` 代入も横取りし、読み込んだ直後の同一 boolean を書き戻す（コールドスタート毎に load→store の往復）。

## スコープ

- `createCacheInitializedFlag` に RestoreOnce を実装（AutoSavedBadgeTabs と同一紀律・初回のみ fan-out）
- Proxy を廃止し明示的 `set()` メソッドにして echo 書込を構造的に排除（呼び出し側は `flag.value = x` から `flag.set(x)` へ）

## 受け入れ基準（BDD）

### シナリオ 1: 2 通目以降のメッセージで session.get が呼ばれない（ハッピーパス）
```gherkin
Given 最初の restore が完了している
When 2 回目以降の restore を呼ぶ
then chrome.storage.session.get が呼ばれない
```

### シナリオ 2: restore が echo 書込を行わない（境界）
```gherkin
Given コールドスタート直後
When restore が完了する
then load は 1 回、set は 0 回（value 代入による書き戻しがない）
```

## DoD

- [x] RestoreOnce 実装・Proxy 廃止
- [x] restore 回数 + echo 書込 pin テスト
- [x] background 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし

## 実装メモ（2026-09-12）

- `createCacheInitializedFlag` を restore-once 化（AutoSavedBadgeTabs と同一紀律）。`ResetRestoreOnce` は将来の prune 発火点用
- Proxy を廃止し明示的 `set()` メソッドに（`flag.value = x` の echo 書込を構造排除）。`lifecycleHandlers` の唯一の value writer を `set(true)` に移行
- 追加修正: `CACHE_INITIALIZED_KEY` を export（module-private のままだったため、テストの直接代入がキー "undefined" に書き込んでいた）
- 検証: swStatePersistence flag テスト更新（restore-once・echo なし・set 経由永続化）+ restoreOnce 3 tests。background/content/popup/dashboard 5,852 tests green・type-check green・lint 0 errors
