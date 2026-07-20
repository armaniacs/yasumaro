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

### 調査で判明した事実（設計・実装前に必読）

#### 1. 既存の pending 機構はヘッダーブロック専用であり、記録失敗はカバーしていない

`src/utils/pendingStorage.ts` の `PendingPage.reason` は `'cache-control' | 'set-cookie' | 'authorization'` の閉じた union 型で、`src/background/pipeline/steps/checkPrivacyHeadersStep.ts` からのみ `addPendingPage()` が呼ばれている。これは「プライバシーヘッダーにより記録前にブロックされたページ」専用であり、実際の記録処理の失敗（本PBIの対象）は一切扱っていない。

`recordingLogic.ts` 冒頭で `addPendingPage` を import しているが、実際には呼ばれていない（デッドインポート）。

#### 2. `RecordingPipeline.ts` には2種類の「記録漏れ」が既に存在する

`src/background/pipeline/RecordingPipeline.ts` の現状:

- **FATAL/RETRY 戦略のステップ**（`domainFilter`, `permission`, `trust`, `duplicate` 等）が失敗すると `buildErrorResult()`（310-336行目）が呼ばれ、Chrome通知を出すだけで `success: false` を返す。**この失敗はどこにも永続化されず、通知を見逃すと記録漏れに気づけない。**
- **BEST_EFFORT 戦略の `saveObsidian` ステップ**（112-115行目）が失敗しても `context.errors` に積まれるだけで、パイプライン全体は `buildResult()`（341-368行目）により `success: true` を返す。**Obsidianへの書き込みが実際には行われていないのに、UI上は成功したように見える。**

この2パターンを `pipeline-error` / `obsidian-write-failed` という新しい `reason` 値として、既存の `PendingPage` 型・ストア（`osh_pending_pages`）に統合するのが本PBIの中心的な変更。

#### 3. 既存の「今すぐ記録」ボタンは既にURL再取得＋パイプライン全体再実行を行っている（重要）

`src/dashboard/historyPendingPanel.ts` と `src/popup/pendingPages.ts` の再記録ボタン（`executeRecord`）は、**既に** `content: ''` で `MANUAL_RECORD` メッセージを送信しており、`src/background/service-worker.ts` の `handleManualRecord()` が `manualContentFetcher.fetchContent(url)` でページ本文をURLからライブ再取得してからパイプライン全体を再実行している。

つまり、失敗したページの本文やAI要約済みデータを `PendingPage` に事前保存しておく必要はない。**`pipeline-error` と `obsidian-write-failed` のどちらのケースも、既存の再記録ボタンをそのまま使い回せば「URL再取得 + パイプライン全体を再実行」で回復できる。** AI要約が再度実行される（コスト・レイテンシが再発生する）が、実装を一元化しシンプルに保つ方針とした（当初検討していた `recordingData`/`resumeData` の個別保存方式は不要と判断し廃棄）。

#### 4. 詳細設計・実装計画

上記の調査結果を反映した設計・実装計画を以下に作成済み:

- 設計: [docs/superpowers/specs/2026-07-05-missed-record-recovery-design.md](../../docs/superpowers/specs/2026-07-05-missed-record-recovery-design.md)
- 実装計画: [docs/superpowers/plans/2026-07-05-missed-record-recovery.md](../../docs/superpowers/plans/2026-07-05-missed-record-recovery.md)

変更は以下の4タスクに分解される:

1. `PendingPage` 型に `errorMessage` フィールドと `pipeline-error` / `obsidian-write-failed` reason値を追加（`src/utils/pendingStorage.ts`）
2. `RecordingPipeline.buildErrorResult()` から `addPendingPage({ reason: 'pipeline-error', ... })` を呼ぶ
3. `RecordingPipeline.buildResult()` で `saveObsidian` 由来のエラーのみを判定し `addPendingPage({ reason: 'obsidian-write-failed', ... })` を呼ぶ
4. `src/dashboard/historyFilters.ts` の `renderPendingReason()` と `_locales/{ja,en}/messages.json` に新しい理由の表示ラベルを追加

再記録UI（`historyPendingPanel.ts` / `pendingPages.ts`）自体の改修は不要。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
