# PBI: 週次/月次の振り返りサマリ自動生成

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: A. 知識活用・検索強化
- type: feat / 優先度: ★推奨（第一弾候補）

## ユーザーストーリー

Yasumaro 利用者として、1週間（または1ヶ月）に読んだページのダイジェストを Obsidian の週次ノートに自動生成してほしい。なぜなら、日々の記録が溜まるだけでは振り返りづらく、期間単位でまとめて把握できると学びの定着や情報整理に役立つから。

## ビジネス価値

「記録した後」の価値を最大化する差別化機能。デイリーノートの断片を週次で俯瞰でき、利用継続の動機になる。測定: 週次サマリ生成の実行回数 / 生成ノートの閲覧率。

## BDD受け入れシナリオ

```gherkin
Scenario: 週次サマリが週次ノートに生成される
  Given 直近7日間に複数の閲覧履歴が記録されている
  And   週次サマリ機能が有効に設定されている
  When  週次サマリ生成がスケジュールに従って実行される
  Then  対象期間の履歴を要約したダイジェストが生成される
  And   Obsidian の週次ノートの所定セクションに追記される

Scenario: 対象期間に履歴がない場合はスキップする
  Given 直近7日間に閲覧履歴が1件も記録されていない
  When  週次サマリ生成が実行される
  Then  週次ノートへの書き込みは行われない
  And   空サマリを生成しない

Scenario: Obsidian が未起動のときは静かにスキップする
  Given Obsidian Local REST API が起動していない
  When  週次サマリ生成が実行される
  Then  エラーで停止せず処理はスキップされる
  And   次回スケジュールで再試行される
```

## 受け入れ基準

- [ ] 週次・月次の周期を設定できる
- [ ] 対象期間を SQLite の created_at で正しく抽出する
- [ ] 生成結果が週次ノートの所定セクションに追記される
- [ ] 履歴ゼロ件・Obsidian 未起動で例外を出さない
- [ ] 要約は既存プライバシーモード設定に従う

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 履歴投入 → スケジュール発火 → 週次ノート追記までの一連（happy path）

### 統合テスト
- SQLite 期間クエリが対象期間の行のみ返す
- `obsidianClient` の週次ノート追記コントラクト
- `chrome.alarms` 発火 → サマリ生成ハンドラ起動

### 単体テスト
- 期間境界（週の開始/終了、月末）の抽出ロジック
- 履歴ゼロ件時のスキップ判定
- 週次ノートパス生成（`dailyNotePathBuilder` 拡張）

## 実装アプローチ

- Outside-In: E2E(失敗) → 統合 → 単体 → 実装 → グリーン → リファクタ
- Red-Green-Refactor を各レイヤーで適用

## 見積もり

8pt（要チーム見積もり）

## 技術的考慮事項

- 依存: なし（既存資産で完結）
- 再利用: `src/background/privacyPipeline.ts`（要約）、`src/background/obsidianClient.ts`（`appendToDailyNote` の週次版）、`src/utils/dailyNotePathBuilder.ts`（週次パス対応）、`src/background/sessionAlarmsManager.ts`（alarms パターン）、SQLite 期間クエリ（`src/offscreen/sqlite.ts`）
- Service Worker はステートレスなので状態は `chrome.storage.local` に保持

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "weekly\|週次\|reviewSummary\|periodSummary" src/
grep -rn "buildDailyNotePath" src/utils/dailyNotePathBuilder.ts
grep -rn "appendToDailyNote" src/background/obsidianClient.ts
```

未実装であることを確認してから着手する。

### 落とし穴

- Service Worker は任意タイミングで終了する。`chrome.alarms` で起こす前提で設計し、メモリ状態に依存しない。
- 週の開始曜日・タイムゾーン（`ja-JP`）の扱いをテストで固定する。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] E2E/統合/単体すべてカバレッジ基準を満たす
- [ ] コードレビュー完了 / リファクタ完了
- [ ] CHANGELOG・関連ドキュメント更新
