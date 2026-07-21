# PBI: 信頼性ハードニング — 競合状態・リソース枯渇の解消

## ユーザーストーリー
拡張機能の利用者として、通常のブラウジングや設定操作を行っている最中に、競合状態（レースコンディション）や巨大な入力による処理停止（DoS/ReDoS）でService Workerがハング・クラッシュしたり、意図しない重複データが記録されたりしないことを望む。なぜなら、拡張機能はバックグラウンドで常時動作する性質上、些細なタイミングの偶然や単一の悪意あるインポートファイルによって全機能が止まってしまうのは許容できないためである。

## ビジネス価値
- **可用性**: Service Workerは記録・AI要約・Obsidian連携・全メッセージハンドリングを担う単一障害点であり、ここがハング/クラッシュすると拡張機能全体が機能停止する
- **データ整合性**: 「1URLにつき1日1回」という重複排除保証や、保存済みブラウジング履歴の一貫性を守る
- **コスト**: TOCTOUレースによるAIプロバイダAPIの重複呼び出しは、利用者自身のAPI利用料増加に直結する

## 対象Finding（VulnHunter監査結果より）
監査結果一式: `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-21-000000/README.md`

| VULN | CWE | Severity | 説明 | PoC | Exploit Test |
|---|---|---|---|---|---|
| VULN-003 | CWE-367/362 | Medium | 同日重複チェック（`checkDuplicateStep.ts`）と書き込み（`saveMetadataStep.ts`）の間に7ステップ・2回のネットワーク呼び出しの隙間があり、TOCTOUレースでN回の重複AI/Obsidian/SQLite書き込みが発生しうる | `poc/VULN-003_duplicate_check_toctou_race.md` | `exploit_tests/test_vuln_003_duplicate_check_race.test.ts` |
| VULN-008 | CWE-400 | Medium | `restore_db`のサイズ上限チェック（100MB）が最終消費者（offscreenドキュメント）でのみ行われ、Service Worker内でのbase64デコード・配列変換・IPC転送は無制限に実行される | `poc/VULN-008_restore_db_unbounded_decode.md` | `exploit_tests/test_vuln_008_restore_db_unbounded_decode.test.ts` |
| VULN-011 | CWE-1333 | Medium | `matchesPattern`（`domainUtils.ts:56-69`）がワイルドカード数無制限のパターンを正規表現に変換し、破局的バックトラッキング（実測: n=20で約108秒）を引き起こす | `poc/VULN-011_redos_wildcard_domain_matching.md` | `exploit_tests/test_vuln_011_redos_matches_pattern.test.ts` |
| VULN-012 | CWE-400 | Medium | uBlockフィルタリストのfetch→parseパイプラインに、レスポンスサイズ上限・行数上限が一切無い | `poc/VULN-012_unbounded_filter_list_fetch_parse.md` | `exploit_tests/test_vuln_012_unbounded_filter_list_parse.test.ts` |
| VULN-014 | CWE-367 | Medium | `saveSettings()`内部の`getSettings()`呼び出しが保存直前のデータで`cachedSettings`を再汚染し、保存完了後も最大約1秒間、除外設定した直後のドメインが「許可」扱いされうる | `poc/VULN-014_settings_cache_revocation_window.md` | `exploit_tests/test_vuln_014_settings_cache_revocation_window.test.ts` |
| VULN-016 | CWE-362 | Medium | offscreenドキュメントの`handleOffscreenMessage`が並行メッセージごとに独立した非同期IIFEを発行し、単一のSQLite接続に対する`BEGIN IMMEDIATE`/`ROLLBACK`が競合し、他ハンドラのトランザクションを誤って巻き戻しうる | `poc/VULN-016_opfs_worker_unsynchronized_writes.md` | `exploit_tests/test_vuln_016_opfs_worker_race.test.ts` |

## BDD受け入れシナリオ

```gherkin
Scenario: 同一URLへの高速連続アクセスでも重複記録が発生しない（VULN-003）
  Given 利用者が同一URLに対して短時間に複数回の記録リクエスト（連続リロード等）を発生させた
  When RecordingPipeline が並行して複数実行される
  Then その日1回分の記録のみが確定し、2回目以降はロック競合により拒否またはキューイングされる
  And AIプロバイダへのAPI呼び出し・Obsidian書き込み・SQLite挿入がそれぞれ1回のみ発生する

Scenario: 巨大なリストア用バックアップファイルがService Workerを停止させない（VULN-008）
  Given 利用者が意図的または誤って数百MB〜GB規模のbase64エンコード済みバックアップファイルでリストアを実行しようとした
  When restore_db ハンドラがpayloadを受け取る
  Then base64デコードや配列変換を行う前に、raw文字列のサイズが上限を超えていれば即座に拒否される
  And Service Workerは他の記録・メッセージ処理を継続できる

Scenario: 多数のワイルドカードを含むドメインフィルタルールがページ遷移をブロックしない（VULN-011）
  Given 利用者が多数の `*` ワイルドカードを含むドメインパターン（例: 20個以上）を含むuBlockフィルタリストをインポートした
  When 利用者が任意のページに遷移し、ドメインフィルタのマッチングが実行される
  Then マッチング処理が数秒以内（例: 100ms未満）に完了する
  And Service Workerの応答性が損なわれない

Scenario: 巨大なフィルタリストのフェッチがメモリを枯渇させない（VULN-012）
  Given 攻撃者が異常に大きな（例: 数GB）フィルタリストを配信するURLを「おすすめフィルタリスト」として共有した
  When 利用者がこのURLをuBlockインポート機能で読み込もうとする
  Then レスポンスサイズまたは行数が上限を超えた時点で処理が中断され、明確なエラーが表示される
  And Service Workerがクラッシュ・ハングしない

Scenario: プライバシー設定を保存した直後は必ず新しい設定が反映される（VULN-014）
  Given 利用者がドメインを除外リストに追加する設定を保存した
  When 保存完了直後（1秒以内）に別のコンテキストから getSettings() が呼ばれる
  Then 常に保存後の最新設定（除外済みドメイン情報を含む）が返される

Scenario: 並行するSQLite書き込みトランザクションが互いのデータを破壊しない（VULN-016）
  Given 通常の記録処理によるSQLite挿入と、バックグラウンドのクリーンアップ処理による削除が同時に実行された
  When 両方が同じoffscreenドキュメントの共有接続にトランザクションを開こうとする
  Then 片方のROLLBACKがもう片方の正常なトランザクションを巻き込んで失敗させない
  And どちらの操作も最終的に正しく完了する（データロスが発生しない）
```

## 受け入れ基準
- [ ] `src/background/recordingLogic.ts` の `record()` 呼び出し全体（重複チェック開始〜メタデータ保存完了まで）が、URL単位のロック（Mutex/optimisticLock相当）で保護される
- [ ] `src/background/handlers/dashboardSqliteHandlers.ts` の `restore_db` ケースで、`base64ToBytes` 呼び出し前に生のbase64文字列長のチェックが行われる
- [ ] `src/utils/domainUtils.ts` の `matchesPattern`（または `src/utils/ublockParser/validation.ts` の `validateDomain`）で、ワイルドカード数または総パターン長に上限が設けられる
- [ ] `src/background/handlers/messageHandlers.ts`（uBlockフェッチ経路）でレスポンスサイズ上限が、`src/utils/ublockParser/index.ts` で行数上限がそれぞれ導入される
- [ ] `src/utils/storage/settingsStore.ts` の `saveSettings()` 内部の `getSettings()` 呼び出しが `cachedSettings` を再汚染しない、または保存完了直後に `cachedSettings` が再度nullされる
- [ ] `src/offscreen/offscreen.ts` の `handleOffscreenMessage` から発行される全てのトランザクション開始ハンドラが、単一のMutex/キューでシリアライズされる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] （任意）VULN-011のReDoS再現をブラウザ環境で計測するE2E（実行時間が閾値以下であることを確認）

### 統合テスト
- [ ] `RecordingPipeline` を通したTOCTOU再現テスト（並行呼び出しで重複が起きないことを確認、VULN-003）
- [ ] `offscreen`の並行SQLite書き込みテスト（VULN-016）

### 単体テスト
- [ ] `restore_db` ハンドラのサイズ上限境界値テスト（VULN-008）
- [ ] `matchesPattern` のワイルドカード数上限テスト・パフォーマンス測定テスト（VULN-011、PoCで実測した n=10/15/20 のタイミングを参考に）
- [ ] uBlockフェッチ/パースのサイズ・行数上限テスト（VULN-012）
- [ ] `settingsStore.ts` の保存直後キャッシュ整合性テスト（VULN-014）

## 実装アプローチ
- **Outside-In**: 各VULNは独立した根本原因を持つため、6件は並行して着手可能（クラスタ内の依存関係は無い）
- **Red-Green-Refactor**: 各VULNごとに個別にRED→GREENサイクルを回す
- **推奨着手順**: VULN-003（利用者体験・コストに直結）→ VULN-016（データロス）→ VULN-008/012（DoS）→ VULN-011（ReDoS）→ VULN-014（プライバシー設定の即時性）

## 見積もり
8pt（6件の独立した中規模修正。それぞれは小さいが合計すると1スプリントの大部分を占める規模）

## 技術的考慮事項
- VULN-003の修正は、既存の `withOptimisticLock` パターン（`src/utils/optimisticLock.ts`）や `Mutex.ts` を再利用することが望ましい。新規ロック機構を実装しない
- VULN-016も同様に、`ObsidianClient` の `globalWriteMutex` パターンを参考にする
- VULN-011のワイルドカード上限は、正当なフィルタルールの表現力を損なわない範囲（3〜5個程度）に設定する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること — 2026-07-21監査時点で以下が該当することを確認済み）
```bash
grep -n "getSavedUrlsWithTimestamps\|urlMap.get" src/background/pipeline/steps/checkDuplicateStep.ts
grep -n "restore_db\|data.length === 0" src/background/handlers/dashboardSqliteHandlers.ts
grep -n "regexPattern\|new RegExp" src/utils/domainUtils.ts
grep -n "text.split('\\\\n')" src/utils/ublockParser/index.ts
grep -n "cachedSettings = null\|const currentSettings = await getSettings" src/utils/storage/settingsStore.ts
grep -n "handleOffscreenMessage\|BEGIN IMMEDIATE" src/offscreen/offscreen.ts src/offscreen/opfsWorker.ts
```

### 実装手順
1. VULN-003: `recordingLogic.ts`の`record()`をURL単位のin-flightロックでラップ（重複チェック開始前に取得、メタデータ保存完了後に解放）
2. VULN-008: `dashboardSqliteHandlers.ts`の`restore_db`ケース冒頭に `data.length` の上限チェックを追加（100MBのbase64換算値）
3. VULN-011: `domainUtils.ts`の`matchesPattern`またはパターン検証時点でワイルドカード出現数をカウントし、閾値超過を拒否
4. VULN-012: `messageHandlers.ts`のfetch箇所で`Content-Length`チェック＋ストリーミング読み取りの早期中断、`ublockParser/index.ts`で行数カウントの上限
5. VULN-014: `settingsStore.ts`の内部`getSettings()`呼び出し結果を`cachedSettings`に書き戻さないようにする、または`withOptimisticLock`の書き込み完了直後に無条件で`cachedSettings = null`を再実行
6. VULN-016: `offscreen.ts`の`handleOffscreenMessage`にトランザクション開始前のMutex取得を追加

### 落とし穴
- VULN-003のロックを record() 全体にかけると、正当な連続記録（別々のURL）まで不必要に直列化しないよう、ロックの粒度は必ず「URL単位」にすること（グローバルロックにしない）
- VULN-011のワイルドカード上限を厳しくしすぎると、実際に使われている複雑なフィルタルールが拒否される可能性がある。既存のuBlockフィルタリストサンプルで上限値を検証すること
- VULN-016のMutex導入により、通常の記録処理のレイテンシがわずかに増加する可能性がある。パフォーマンステストで許容範囲を確認する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 対応する6件のexploit testファイル（`test_vuln_003/008/011/012/014/016_*.test.ts`）の内容に基づく回帰テストがプロジェクトに追加されPASSする
- [ ] `npm run type-check` と `npm test` が全てパスする
- [ ] コードレビュー完了
- [ ] `pbi/00-INDEX.md` を更新し、本PBIをアーカイブ対象として記録する
