# PBI: アーカイブセッション再接続（reload → STATUS プローブ）の E2E 自動化（Y5'）

## ユーザーストーリー

yasumaroのユーザーとして、アーカイブを一時オープン中にオプションページを再読み込みしても、開いていたセッションが自動で復元してほしい。なぜなら、誤ってリロードしただけで編集中のアーカイブセッションへの参照が失われたように見えるのは不安だから（手動チェックリスト Y5' の自動化）。

## 背景

手動チェックリスト（`docs/MANUAL_TEST_ARCHIVE.md`）の Y5 は「file:// で開いた .db の復元」で E2E 不可が確定している。一方、2026-09-07-02 の実装時に判明した **Y5'（拡張ページ内 reload → 再接続）は E2E 化可能**:
- `archivePanel.ts` は mount 時に `archiveStatus()` を叩き、`open` なセッションがあれば一覧を再表示する（再接続プローブ）
- `archiveSessionHandlers.ts` の `resetArchiveSessionForTesting` / `handleArchiveStatus` がセッション状態を保持する
- Y5 のうち E2E で担保できる範囲を Y5' として切り出す（Y5 本体の file:// 部分は手動のまま）

## BDD受け入れシナリオ

```gherkin
Scenario: 一時オープン中にオプションを再読み込みしてもセッションが復元する
  Given 録画 2 件を seed し Phase A で staging を作成した
  And prepare_incoming → OPFS 書込 → archive_open でセッションを開いた
  When options.html を reload する
  Then archive_status の応答が open=true で stagingName を返す
  And Archive パネルのセッションセクションが再表示される
  And archive_query でレコード一覧が取得できる

Scenario: 未保存編集の dirty 状態が reload 後も保持される
  Given セッション内で archive_update を実行した（dirty=true）
  When options.html を reload する
  Then archive_status の応答が dirty=true を返す
  And 保存ボタンが有効のまま表示される
```

## 受け入れ基準

- [x] `testDir/e2e/archive-recommended-verification.spec.ts`（既存ファイル）に Y5' のシナリオを**追記**する（新規 spec ファイルは作らない）
- [x] reload 前後で `archive_status` が open/stagingName/dirty を保持することを assert
- [x] reload 後に `archive_query` が動作することを assert（セッション実体が生きている証拠）
- [x] テスト専用 subtype / フラグは追加しない（2026-09-07-01/02 と同じ方針）
- [x] `docs/MANUAL_TEST_ARCHIVE.md` を更新: Y5 の手順を Y5（file:// 部分・手動維持）と Y5'（自動化済み・対応表へ移動）に分解
- [x] `npm run validate` が通る

## 完了メモ（2026-09-07）

### Y5' E2E（archive-recommended-verification.spec.ts に追記・一発グリーン）

検証フロー:
1. Y3 流用（seedRows → runPhaseA → exportStagingBytes → stageIncomingBytes → archive_open）でセッションを開く — この間パネルは mount していない（direct message パス）
2. `archive_status`（TOKEN_EXEMPT）で open/stagingName/dirty=false を assert
3. `page.reload()` → `archive_status` で open/stagingName 保持を assert（SW・offscreen worker は生き続けるため）
4. `archive_query` が動作（セッション実体が生きている証拠）
5. **パネル再接続**: `[data-panel="panel-archive"]` を初めてクリック → mount プローブ（archivePanel.ts の mount 時 archiveStatus）が open セッションを検出 → `#archive-session-section` 表示 + `.archive-session-row` にタイトル再描画
6. dirty フロー: `archive_update`（dirty=true）→ 再 reload → `archive_status` の dirty=true 保持

### 実装確認メモ
- パネルは NavigationRegistry の navigate 時に**初回 mount**（遅延） — reload 後のタブクリックが mount プローブの発火点になる
- `archiveDirtyLocal` は閉じる確認ダイアログ用の内部状態で視覚表示なし — dirty の assert は `archive_status` レベルで実施
- dirty=true のまま reload しても SW 側 `archiveDirty` は保持される（worker のモジュール状態）

## テスト戦略

### E2Eテスト
- 既存 `archive-recommended-verification.spec.ts` の Y3 フローを再利用（seed → Phase A → export → incoming → open まで共通化し、open 後に `page.reload()` → STATUS assert に分岐）

### 単体テスト
- なし（`archiveSessionHandlers` の STATUS ロジックは既存 `archiveSessionHandlers.test.ts` でカバー済み）

## 実装アプローチ

1. Red ではなく Green 先行（既存機能の自動化であり、本番バグの予兆はない）。Y3 の helper（`stageIncomingBytes` / `exportStagingBytes`）をそのまま流用
2. `page.reload()` 後の `chrome.runtime` 再接続待ち（既存 `openOptionsPage` の waitForFunction を再利用）
3. `archive_status` 直接呼び出し（TOKEN_EXEMPT）で状態 assert → パネル UI のセッションセクション表示 assert

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-02 の完了（`stageIncomingBytes` / `dashboardSqliteHelpers` が前提）
- **テスタビリティ**: reload は `page.reload()` で忠実に再現可能（SW は生き続けるためセッションも保持される）
- **非機能要件**: なし（テストのみ）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "archiveStatus" src/dashboard/panels/diagnostic/archivePanel.ts | head -3
grep -n "handleArchiveStatus\|sessionEngine" src/offscreen/opfsWorker/archiveSessionHandlers.ts | head -5
```

### 落とし穴
- **reload 直後の chrome.runtime 未初期化**: 既存 fixture の `waitForFunction` を再利用してから STATUS を叩く
- **SW のスリープ**: テスト内の操作が連続していれば SW は眠らない。STATUS プローブ自体が worker を起こすので過度な心配は不要
- **dirty 状態の確認方法**: `archive_status` 応答の `dirty` フィールド（`archiveSessionHandlers` 参照）

## Definition of Done

- [x] Y5' シナリオが E2E として実装されパスする
- [x] `npm run validate` が通る
- [x] 全 `@extension` E2E がグリーン（35 passed / 1 skipped）
- [x] `docs/MANUAL_TEST_ARCHIVE.md` 更新済み
- [x] コードレビュー完了
