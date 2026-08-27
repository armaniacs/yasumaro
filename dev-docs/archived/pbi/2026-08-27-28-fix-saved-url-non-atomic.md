# PBI: savedUrlRepository 非原子更新

## ユーザーストーリー
開発者として、`savedUrlRepository` の二重ストレージ更新が非原子で中間状態を露出しないようにしたい、なぜなら `setSavedUrlsWithTimestamps` と `updateUrlTimestamp` が `savedUrlsWithTimestamps` と `savedUrls` に対して別々の `withOptimisticLock` を実行するため、並行する読み取りや2回目の書き込みが片方だけ更新された不整合な中間状態を観測し、LRU 削除や重複判定が誤動作する競合ウィンドウになるから。

## 優先度
- 順位: 8 / 17
- RICEスコア: 140（Reach=20 / Impact=1 / Confidence=70% / Effort=0.1）
- 根拠: 保存URL操作を行う全ユーザーに影響 (Reach=20)。不整合は一時的な LRU 誤削除や重複保存に留まるため Impact は低 (1)。競合ウィンドウは理論的に確実だが再現頻度は中程度のため Confidence=70%。`withOptimisticLock` の統合は中規模リファクタで Effort=0.1。

## なぜなぜ分析
- なぜ非原子か: `src/utils/storage/savedUrlRepository.ts:210-240` の `setSavedUrlsWithTimestamps` が `savedUrlsWithTimestamps` と `savedUrls` を2回の独立した `withOptimisticLock` で更新するため
- なぜ2回に分けたか: `savedUrls`（Set<string>）と `savedUrlsWithTimestamps`（SavedUrlEntry[]）が別キーとして `chrome.storage.local` に保存されており、各キー単位で CAS する設計をそのまま踏襲した
- なぜ気づかなかったか: 単一タブ・単一操作のテストでは競合が発生せず、並行書き込みのインターリーブを検証するテストがなかった
- 解: 両キーを単一の `withOptimisticLock` トランザクションに統合するか、`chrome.storage.local` の複数キー CAS を1回の `withOptimisticLock` でアトミックに扱う

## BDD受け入れシナリオ
Scenario: ハッピーパス — 単一更新で両キーが一致する
  Given 空のストレージ
  When `setSavedUrlsWithTimestamps(map)` で `https://example.com` を保存
  Then `savedUrls` と `savedUrlsWithTimestamps` の両方に同URLが存在する

Scenario: 競合 — 並行更新でも中間状態が観測されない
  Given `updateUrlTimestamp` を2並行で実行（`urlA` と `urlB` を同時追加）
  When 両方の `Promise.all` が完了する
  Then `savedUrls` のサイズと `savedUrlsWithTimestamps` の件数が一致し、どちらも両URLを含む

Scenario: 競合 — LRU 削除が両キーで一貫する
  Given `MAX_URL_SET_SIZE` 直前の状態で2並行追加
  When 同時に `addSavedUrl` を呼ぶ
  Then 古いエントリの削除が両キーで同一のURLに対して行われる

Scenario: エッジ — 片方の CAS リトライでもう片方が重複更新されない
  Given `withOptimisticLock` が1回リトライする条件
  When `setSavedUrlsWithTimestamps` を呼ぶ
  Then リトライ後も両キーが単一トランザクションとして再実行され、二重書き込みが発生しない

## 受け入れ基準
- [ ] `setSavedUrlsWithTimestamps` が `savedUrls` と `savedUrlsWithTimestamps` を単一の `withOptimisticLock`（または複数キーを扱う単一 CAS）に統合している
- [ ] `updateUrlTimestamp` も同様に両キーの更新が同一トランザクションで行われる
- [ ] 既存の `spreadExistingFields` / `content` 保持 / 7日 cutoff / LRU eviction ロジックが維持される
- [ ] 並行実行テストで `savedUrls.size === savedUrlsWithTimestamps.length` が常に成立する
- [ ] `npx vitest run src/utils/storage/__tests__/savedUrlRepository.test.ts` がパスする

## テスト戦略
- 単体: `withOptimisticLock` をモックし、2回呼ばれていた箇所が1回に統合されたことを検証（呼び出し回数アサーション）
- 統合: `Promise.all` で並行 `addSavedUrl` を実行し、両キー一致を検証する競合テスト
- E2E: 不要

## 見積もり
0.1pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
