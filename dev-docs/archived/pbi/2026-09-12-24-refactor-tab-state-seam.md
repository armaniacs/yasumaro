# PBI 2026-09-12-24 — TabState（セッション永続タブ状態の耐久性と刈り込み・実バグ 2 件解消）

- **種別**: 🔧非機能追加（fix + refactor・実バグ 2 件解消を伴う）
- **優先度**: 8 位 / RICE **3.2**（R8 × I1 × C80% / E2.0人日）
- **出典**: round 11 診断 候補 24・サブエージェント探索 + 直接検証

## 背景（なぜ）

- TabCache の session 書込（tabCache.ts:86-136）が debounced SessionStore（50ms 窓・sessionStore.ts:102-117）経由で、SW suspend に `add/update/remove` が消え得る（rateLimiter.ts:111-119 は既に `flushImmediately:true` で正解を証明）
- `AutoSavedBadgeTabs.restore()`（swStatePersistence.ts:86-103）が add-only で、SW 死中に閉じた tabId を永遠に保持 → set が無限増殖し、`resolveTabBadge({isRecorded})`（tabBadgeResolver.ts:42）が再利用 tabId に stale な recorded badge を付与し得る
- `tabEventHandlers.ts:28-32,65-66` が全 tab イベントで restore() を呼び、漏れを増幅

## スコープ

- 単一 `TabState` seam 新設（get/put/remove/prune + `TabExistencePort` adapter: prod は chrome.tabs.query、test は in-memory set）
- hot path（add/update）は debounced、remove/badge 系は `flushImmediately`
- `restore()` は wake 1 回の prune（存在しない tabId を削除）
- `tabEventHandlers` は I/O のみに

## 受け入れ基準（BDD）

### シナリオ 1: remove は suspend を生き残る（ハッピーパス）
```gherkin
Given TabState に tabId=1 がある
When remove(1) の直後に flush されずに SW が再起動する
Then tabId=1 は復元されない
```

### シナリオ 2: restore が stale tabId を刈り込む（境界）
```gherkin
Given session に tabId 2/3 が保存され、実タブは 2 のみ
When prune を実行する
Then tabId 3 は削除され、badge 判定に stale 値が渡らない
```

## DoD

- [x] TabState seam 新設・TabCache/AutoSavedBadgeTabs 委譲・prune 実装
- [x] prune + suspend 耐性テスト新設（fake adapter）
- [x] background tab 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- **prune**: `createAutoSavedBadgeTabs(tabExistence?)` に存在 adapter を追加。restore 時に alive チェックで stale tabId を刈り込み、刈り込み後の set を永続化。compositionManifest で chrome.tabs.get ベースの adapter を配線。port 無しは従来どおり add-only（後方互換）
- **耐久性**: TabCache の remove を `saveToSession(true)`（flushImmediately）+ `removeAndFlush()` 追加。add/update は debounced のまま
- テスト 3 件新設（remove 即時 flush / prune / port 無し後方互換）。service-worker の context menu テストを新契約（同一 tab join・別 tab 並行）に更新
- 検証: background 全 173 ファイル 2306 tests green・type-check green・lint 0 errors

## 見積もり

🔴高（3pt目安） / 副作用: 🟡軽微（badge の stale 付与が解消される = 正しい値への修正）
