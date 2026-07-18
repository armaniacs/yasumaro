# PBI: モバイル環境向けOffscreen Mutexキュー上限の調整可否検討と実装

## ユーザーストーリー
モバイル版拡張機能ユーザーとして、メモリ制約の厳しい環境でOffscreen Mutexのキューが過度にメモリを消費しないでほしい、なぜなら現状のキュー上限200件はデスクトップ環境を前提にしており、モバイルでは過大な可能性があるから

## ビジネス価値
- モバイル環境（Android Chrome等）でのメモリ使用量削減
- Edge & Mobile Strategist観点での指摘に対応

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/background/sqliteClient.ts` の `SqliteClient` コンストラクタ内: `this.requestQueue = new Mutex({ maxQueueSize: 200, timeoutMs: MESSAGE_TIMEOUT_MS * 2 });`（親レポート記載の行番号78とは若干のズレがあるが、該当箇所は特定済み）
- 現状 `maxQueueSize: 200` はハードコードされた定数であり、環境（モバイル/デスクトップ）による分岐は存在しない
- 対処案（親レポートより）: モバイルでは上限を50に、リングバッファに変更

```bash
# 実装前の必須調査コマンド（モバイル判定の既存パターンの有無を確認）
grep -n "maxQueueSize" src/background/sqliteClient.ts src/background/Mutex.ts
grep -rn "isMobile\|Android\|navigator.userAgent" src/ --include="*.ts" | grep -v __tests__
```

**要検討事項**: 「モバイル環境」をどう判定するか（`navigator.userAgent`、Chrome拡張のフォームファクタAPI等）が現状のコードベースに存在しない場合、判定ロジックの新規設計が必要になる。実装着手前にモバイル判定手段の有無を確認すること。

## BDD受け入れシナリオ

```gherkin
Scenario: デスクトップ環境では従来通りの上限が適用される
  Given デスクトップ版Chromeで拡張機能が実行されている
  When SqliteClientが初期化される
  Then Mutexのmax QueueSizeは200のまま変更されない

Scenario: モバイル環境ではキュー上限が引き下げられる
  Given モバイル版Chrome（Android）で拡張機能が実行されている
  When SqliteClientが初期化される
  Then Mutexのmax QueueSizeは50に設定される
```

## 受け入れ基準
- [ ] モバイル環境判定ロジックを追加（既存パターンがなければ `navigator.userAgent` ベースの簡易判定を新設）
- [ ] モバイル環境判定時は `maxQueueSize: 50` を、それ以外は従来の `maxQueueSize: 200` を使用する
- [ ] 既存のデスクトップ環境での動作に影響がない

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要（実機モバイルChromeでのテストは手動確認）

### 統合テスト
- `SqliteClient` の初期化テストに、モバイル判定時/デスクトップ判定時でMutexの `maxQueueSize` が異なることを検証するケースを追加

### 単体テスト
- モバイル判定関数（新設する場合）に対して、様々な `userAgent` 文字列でのモバイル/デスクトップ判定を検証

## 実装アプローチ
- **Outside-In**: 「モバイル環境判定時にmaxQueueSizeが50になる」統合テストをRedで書き、判定ロジックと設定値の条件分岐を実装してGreenにする

## 見積もり
2pt（半日。モバイル判定ロジックの新設を含むため、既存パターンがない場合は設計判断が必要）

## 技術的考慮事項
- 依存関係: モバイル判定に `navigator.userAgent` を使う場合、Service Worker内での利用可否を確認（Service WorkerからNavigator APIの一部が制限されている可能性）
- テスタビリティ: `userAgent` はテスト内でモック可能
- 非機能要件: メモリ使用量削減（モバイル環境）

## 落とし穴
- Service Worker（`src/background/`）は`navigator.userAgent`にアクセスできるが、Manifest V3のService Worker環境での挙動を事前に確認すること
- 「リングバッファへの変更」は親レポートの対処案に含まれるが、`Mutex`クラスの内部実装変更を伴う可能性があり、`maxQueueSize`の値変更のみよりスコープが大きい。本PBIでは値変更（50への引き下げ）のみをスコープとし、リングバッファ化は別途検討する

## Definition of Done
- [ ] モバイル環境判定ロジックが実装されている
- [ ] モバイル環境で`maxQueueSize: 50`が適用されることが確認できる
- [ ] 単体・統合テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
