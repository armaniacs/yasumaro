# PBI: 記録漏れの検知とリカバリ通知

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: B. 記録品質・自動化
- type: feat / 優先度: 中

## ユーザーストーリー

Yasumaro 利用者として、滞在条件を満たしたのに記録に失敗したページを一覧で確認し、ワンクリックで再記録したい。なぜなら、記録漏れに気づけないと知らないうちに履歴が欠落するから。

## ビジネス価値

記録の取りこぼしを可視化し、ユーザー自身で回復できる。測定: リカバリ実行回数 / 記録漏れ検知数。

## BDD受け入れシナリオ

```gherkin
Scenario: 記録失敗ページが pending に集約される
  Given 滞在条件を満たしたページで記録処理が失敗する
  When  ダッシュボードの pending パネルを開く
  Then  失敗したページが一覧に表示される
  And   失敗理由が確認できる

Scenario: ワンクリックで再記録できる
  Given pending パネルに失敗ページがある
  When  そのページの再記録ボタンを押す
  Then  記録処理が再実行される
  And   成功したら pending から取り除かれる
```

## 受け入れ基準

- [ ] 記録失敗を pending として集約する
- [ ] 失敗理由を保持・表示する
- [ ] ワンクリック再記録で処理を再実行する
- [ ] 成功時に pending から除去する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 記録失敗 → pending 表示 → 再記録 → 成功で除去

### 統合テスト
- `recordingLogic` 失敗フック → pending 登録
- 再記録ハンドラのコントラクト

### 単体テスト
- 失敗理由の分類・格納
- pending からの除去条件

## 実装アプローチ

Outside-In / Red-Green-Refactor。

## 見積もり

5pt（要チーム見積もり）

## 技術的考慮事項

- 依存: feature-05 と pending 機構を共有すると整合的
- 再利用: `src/dashboard/historyPendingPanel.ts`、`src/popup/pendingPages.ts`、`src/background/recordingLogic.ts`

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "pending\|pendingPages\|記録漏れ" src/popup/pendingPages.ts src/dashboard/historyPendingPanel.ts
grep -rn "catch" src/background/recordingLogic.ts
```

既存 pending 機構の役割を把握し、失敗集約に拡張する。

### 落とし穴

- Service Worker 終了で pending がメモリから消えないよう `chrome.storage.local` に永続化する。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
