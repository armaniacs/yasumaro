# PBI 04: recordingCache の live-view 互換層を削除

優先度: 4 位 / RICE 15.0 = (3 × 0.5 × 100%) / 0.1w / Strength: Strong（deletion-first）
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
キャッシュ基盤を保守する開発者として、`getCacheState()` の live-view（`Object.defineProperties` による 7 getter/setter :112-173）が削除されてほしい。なぜなら約60行の記述子は旧テストが `cacheVersion` を直接書き換えるためだけに残る互換層で、3 つの型付きストア（SettingsCache/UrlCache/PrivacyCache）が既に `getState` / `setState` の typed seam を持つから。

## BDD受け入れシナリオ

```gherkin
Scenario: live-view なしにキャッシュ状態を読み書きできる
  Given typed seam（getState/setState）だけの facade
  When  settings/url/privacy の各状態を読み書きする
  Then  従来の getCacheState 読みと等価な値が得られる

Scenario: 旧 overflow テストが typed seam 経由で通る
  Given live-view に依存していた overflow テスト
  When  setState 経由に書き換える
  Then  同一のアサーションが green になる
```

## 受け入れ基準
- [x] `getCacheState()` の `Object.defineProperties` ブロック（:112-173）が削除される
- [x] live-view に依存するテストが typed seam 経由に移行し green（settings 状態読みは cache-hit 読み・refetch 振る舞いアサーションに、書き込みは `setPrivacyCacheEntry` / `invalidate*` / `resetCacheState` に、TTL 操作は fake timers に。旧 overflow テストは version seam 撤去に伴い smoke 化）
- [x] `resetCacheState()`（:175-179）は typed seam への純粋委譲として残る
- [x] 永続化（load/TTL-gate/redacted save/microtask coalescing :310-365）は本 PBI では触らない（lost-write 報告が再発した場合のみ別 PBI で seam 化）
- [x] 既存 cache suite が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 移行した overflow テスト + typed seam の読み書きテスト
### 統合テスト
- `getSettingsWithCache` 経路の既存テストは無修正で green
### 例外ハンドリング
- live-view の setter 経由でのみ成立していた書き込みがないことを grep で確認（`getCacheState().x = `）

## 実装アプローチ
- **Deletion-first**: 依存テストの洗い出し → typed seam 移行 → live-view 削除 → green 確認

## 見積もり
0.1w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: typed seam は既存（getState/setState）。新規テストは不要な場合もある
- 非機能要件: 削除のみ。永続化の順序・TTL・redaction は不変

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "getCacheState\(\)\.[a-zA-Z]+ =" src/ testDir/ --include="*.ts" | head -20
rg -n "getCacheState|resetCacheState" src/background/recordingCache.ts
```
2026-09-05 時点: live-view 7 プロパティ（settingsCache/cacheTimestamp/cacheVersion/urlCache/urlCacheTimestamp/privacyCache/privacyCacheTimestamp）。setter は `getState`→`setState` の薄いラッパーであり、削除は移動ではなく消滅（deletion test 合格）。

### 実装手順
1. live-view setter への書き込み箇所を `rg` で全洗い出し
2. 各箇所を typed `setState` に移行（1 箇所ずつテスト green）
3. `getCacheState()` の defineProperties を削除（読み取り専用の薄い view にするか、不要ならメソッドごと削除）
4. 全 cache テスト green

### 落とし穴
- `cacheVersion` を直接書き換える overflow テストが少なくとも1件ある — 先に移行すること
- `resetCacheState` の呼び出し側は残す（純粋委譲であり削除対象外）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] cache 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS §5.3 の Cache Strategy 節から live-view 言及があれば除去）
