# PBI: 記録状態のリソース管理と永続化を修正する

## ユーザーストーリー
ユーザーとして、長時間ブラウジングしても Service Worker のメモリや chrome.storage.session のクォータを圧迫せず、キャッシュされた状態が正しく永続化・復元されるようにしたい。

## ビジネス価値
- SW の安定稼働時間を延ばす
- 重複チェックとプライバシー判定の正確性を維持する
- データ損失を防ぐ

## BDD受け入れシナリオ

```gherkin
Scenario: URL 別 Mutex が不要になったら解放される
  Given 多数の URL を記録する
  When 各 URL の処理が完了する
  Then urlRecordMutexes からエントリが削除される

Scenario: SW 再起動後もプライバシーキャッシュが復元される
  Given プライバシー判定キャッシュがある状態
  When Service Worker が30秒後に再起動する
  Then キャッシュが session storage から復元される

Scenario: SessionStore の書込が確実にフラッシュされる
  Given 50ms 以内に Service Worker が終了する
  When set() が呼ばれる
  Then データが失われない
```

## 受け入れ基準
- [ ] `urlRecordMutexes` に TTL または完了後削除が実装される
- [ ] `RecordingLogic.loadCacheFromSession()` が SW 起床時にも呼ばれる
- [ ] `privacyCache` の session fallback で TTL を検証する
- [ ] `SessionStore` のデバウンスより確実なフラッシュ機構（例: onSuspend 対応、write-through オプション）
- [ ] 二重 Mutex (`RecordingLogic` と `RecordingPipeline`) の非対称を整理する

## テスト戦略（t_wadaスタイル）

### 統合テスト
- SW 再起動後のキャッシュ復元
- 多数 URL 記録後のメモリ使用量

### 単体テスト
- `Mutex` の解放ロジック
- `SessionStore` のフラッシュ動作
- `privacyCache` TTL 検証

## 実装アプローチ
- **Outside-In**: SW 再起動シナリオから内部設計を洗い出す
- **Red-Green-Refactor**: リソースリークのテストを先に書く

## 見積もり
3pt

## 技術的考慮事項
- MV3 SW は onSuspend が確実でない
- `chrome.storage.session` は 1MB 制限

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "urlRecordMutexes\|loadCacheFromSession\|privacyCache" src/background/recordingLogic.ts
grep -n "SessionStore" src/background/sessionStore.ts
```

### 実装手順
1. `urlRecordMutexes` に完了後削除または LRU を追加
2. `lifecycleHandlers` で SW 起床時にもキャッシュ復元
3. `SessionStore.set()` に強制フラッシュオプションを追加
4. 二重 Mutex の責務を整理

### 落とし穴
- 削除タイミングが早すぎると並行処理で競合
- session storage 容量制限

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/background/recordingLogic.ts`, `src/background/pipeline/RecordingPipeline.ts`, `src/background/sessionStore.ts`, `src/background/Mutex.ts`, `src/background/handlers/lifecycleHandlers.ts`
- **関連する過去PBI**:
  - `2026-07-25-21-fix-ai-call-deduplication`
  - `2026-07-25-22-fix-duplicate-check-race-condition`
  - `2026-07-25-35-fix-service-worker-state-persistence`
- **補足**: `RecordingLogic.urlRecordMutexes` と `RecordingPipeline` 内の URL Mutex が二重に存在する。本PBIでは責務を整理し、片方を削除または統合する。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
