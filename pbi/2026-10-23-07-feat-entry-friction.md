# PBI: 受け口の摩擦除去 ― omnibox・サイドパネル・一括操作

## ユーザーストーリー
使う人として、開かずに残し、選ばずに飛びたい、なぜなら新機能の利用率は入口の摩擦で決まるから

## 優先度
- 順位: 02 / 5候補
- RICEスコア: 480 (Reach=900 / Impact=1 / Confidence=0.8 / Effort=1.5人週)
- 根拠: 到達が最も広くEffort小。M2と独立のため並列着手可
- 依存: なし

## 背景・制約
- `navigateToHistory` と右クリック記録(`src/background/handlers/contextMenuHandlers.ts`)はある。足りない「開かずに残す」動線(omnibox・サイドパネル・一括・キーボード)を揃える
- MV3制約(権限・CSP・alarms粒度)を守る。追加権限が必要な案は段階化し、まず権限不要分から出す
- プライベート判定・ドメインフィルタを迂回させない。一括操作も確認と取消を付ける

## BDD受け入れシナリオ
Scenario: 開かずに残す
  Given 記事タブを開いている
  When omniboxまたはキーボードで記録した
  Then ダッシュボードを開かずに記録され、件名で確認できる

Scenario: 一括で飛ぶ
  Given 履歴一覧で複数件を選んだ
  When 一括操作を実行した
  Then スター・タグ・コレクション追加のいずれかが適用され、取消ができる

## 受け入れ基準
- [ ] omnibox・サイドパネル・右クリック・キーボードのうち権限不要分が動く
- [ ] 一括操作に確認と取消がある
- [ ] プライベート判定記録の一括適用が除外できる
- [ ] ja/enの文言漏れがない

## テスト戦略
## 実装記録（2026-10-23・権限不要分のWave A）
- omnibox: 完了。`wxt.config.ts` の manifest fn に `omnibox: { keyword: 'y' }` と `commands: { 'record-current-page': { suggested_key: 'Alt+Shift+Y' } }` を追加（どちらもマニフェストキーであって権限ではない。サイドパネルは `sidePanel` 権限が要るため段階外）
- 共有コア: 完了。`src/background/handlers/activeTabRecorder.ts` の `recordTabContent` に右クリック記録の抽出+検証+記録呼び出しを集約（コンテンツスライス上限・payload形状・sender構築が入口間で drift しない）。`contextMenuHandlers.ts` はこのコアに委譲、不安定URLゲート・per-tab SingleFlight・エラーログは入口ローカルに維持（pin済みログ文は入口ラベルで不変）
- omnibox/キーボード入口: 完了。`src/background/handlers/entryFrictionHandlers.ts` が `createOmniboxInputHandler`（Enterで常時アクティブタブを記録、タイポした語は検索語ではなくトリガー）と `createKeyboardCommandHandler`（所有コマンド以外は無視）を提供。成功時は `NotificationHelper.notifySuccess` で件名確認（BDD「件名で確認できる」）、失敗はパイプラインのoutcome policyが通知済みのため二重通知しない
- service-worker 配線: 完了。`chrome.commands.onCommand` と `chrome.omnibox.onInputEntered` を既存リスナ群と同じ guard 包装で登録（API 不在環境は early return）
- 型baseline: 増加なし（pin 451維持）。validate exit 0（1132 files / 16800 tests、commit 734f1633）
- ja/en: 完了。`commandRecordPage`（commands説明）・`omniboxRecordDefault`・`recordSuccessTitle`・`recordSuccessBody` の4キーを双側追加
- pin: `src/background/handlers/__tests__/entryFrictionHandlers.test.ts` 9テスト（コマンドルーティング・不安定URL・通知条件・共有コアの縮退）。既存 service-worker 169テスト・background 全体 3227テスト green
- 再開点: (1) 一括スター（BDD「スター・タグ・コレクション追加のいずれかが適用され、取消ができる」）: history panel の bulk bar にスター適用+取消を追加、プライベート判定記録（`cleansed_reason` 設定行）の除外を付ける (2) omnibox の検索語ハンドオフ（`?q=` deep link → history panel の searchDomain）は M1/M3 入力選択と同じ機構のため棚上げ (3) サイドパネルは `sidePanel` 権限の段階判断が先
- E2E: omnibox記録→履歴表示、一括適用→取消の通し
- 統合: 権限不足時の縮退表示テスト
- 単体: キーバインド・選択集合操作のテーブルテスト

## 見積もり
1.5人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(操作一覧を含む)
