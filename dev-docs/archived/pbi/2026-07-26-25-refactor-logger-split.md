# PBI: logger.tsを型定義・コアAPI・高レベルラッパーの3ファイルに分割する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（ファイル分割のみでロジック変更なしだが、importパスが変わるため広範囲の呼び出し元修正が必要）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Maintainability Guardian, Refactoring Evangelist（重複）からの指摘。`src/utils/logger.ts`（現状755行）にエラーコード定義・型定義・ログバッファリング管理・高レベルログ関数7種・ログ取得/削除・ソース解決が1ファイルに混在している。認知負荷が高く、`logSanitize`/`logCritical` は呼び出しがそれぞれ2回のみと利用頻度に偏りがある。

**2026-07-26時点で `logger.ts` は755行のままであることを確認した。**

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/utils/logger.ts
grep -n "^export" src/utils/logger.ts
```

`logger.ts` の全exportを洗い出し、型定義（ErrorCode等）・コアAPI（addLog, flushLogs等）・高レベルラッパー（logInfo, logWarn, logError, logDebug, logSanitize, logCritical等）にどう分類できるか設計する。他のPBI（PBI-07: addLogメッセージサニタイズ、PBI-16: pendingSqliteQueueリトライ等）が `logger.ts` に変更を加える可能性があるため、実装順序を調整する（本PBIを他のlogger.ts変更PBIの後に実施するか、逆に先に構造整理してから他の変更を乗せるかを検討する）。

## 受け入れ基準（BDD）

```gherkin
Scenario: logger.tsが3ファイルに分割される
  Given logger.ts（755行）が型定義・コアAPI・高レベルラッパーを混在させている
  When logger/types.ts, logger/core.ts, logger/api.ts に分割する
  Then 各ファイルが単一責任（型定義のみ/コアAPIのみ/高レベルラッパーのみ）を持つ

Scenario: 既存の呼び出し元が回帰しない
  Given logger.tsをimportしている全ファイル
  When 分割後のモジュール構成に対応するようimport文を更新する
  Then npm run type-check と既存テストが全てパスする

Scenario: 後方互換のためのバレルファイルを検討する
  Given 分割後、既存の import { addLog } from '../utils/logger.js' という呼び出しパターンが多数存在する
  When 全呼び出し元を一度に変更するのが困難な場合
  Then logger.ts自体をバレル（re-export）として残し段階的に移行できるようにする（ただしPBI-22のバレル禁止ポリシーとの整合性を検討する）
```

## 受け入れ基準
- [ ] `src/utils/logger/types.ts`（ErrorCode等の型定義）、`src/utils/logger/core.ts`（addLog, flushLogs, scheduleFlush等のコアAPI）、`src/utils/logger/api.ts`（logInfo, logWarn, logError, logDebug, logSanitize, logCritical等の高レベルラッパー）に分割する
- [ ] 全呼び出し元のimportパスを更新する（バレルファイルとして `logger.ts` を一時的に残す場合はPBI-22との整合性を明記する）
- [ ] `npm run type-check` と既存テストスイートが全てパスする

## テスト戦略

### 単体テスト
- 分割後の各モジュールが独立してimport可能であることを確認
- 既存の `logger.test.ts` が分割後も全てパスする

## 実装アプローチ

1. `logger.ts` の全exportを型定義・コアAPI・高レベルラッパーに分類
2. 3ファイルに分割し、内部依存関係（`core.ts` が `types.ts` に依存、`api.ts` が `core.ts` に依存等）を整理
3. 全呼び出し元のimportパスを更新
4. `npm run type-check` とテストで確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: プロジェクト全体（loggerを使う全ファイル）
- テスタビリティ: 既存の `logger.test.ts` が土台
- 非機能要件: 保守性

## Definition of Done
- [ ] logger.tsが3ファイルに分割されている
- [ ] 全呼び出し元のimportが更新されている
- [ ] `npm run type-check` と既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Maintainability Guardian, Refactoring Evangelist指摘、重複統合）
- 対象コード: `src/utils/logger.ts`（755行）
- 関連PBI: `2026-07-26-07-fix-addlog-message-sanitization.md`（logger.tsへの別変更、実施順序を要調整）

## 実装メモ（2026-07-26完了）

- `src/utils/logger/types.ts`（108行: ErrorCode, LogType, LogEntry等の型定義）、
  `src/utils/logger/core.ts`（403行: isDevelopment, flushLogs, addLog, getLogs, clearLogs等の
  コアAPI）、`src/utils/logger/api.ts`（265行: logInfo/logWarn/logError/logDebug/logSanitize/
  logCritical等の高レベルラッパー）に分割
- 呼び出し元が120ファイルと非常に多く、全件のimportパス変更は現実的でないと判断。
  `src/utils/logger.ts`はバレル（re-export）として残し、既存の呼び出し元は変更不要とした
  （PBI-22のバレル禁止ポリシーとは別枠として扱う。理由: PBI-22は「新規に安易なバレルを増やさない」
  ことが目的であり、本PBIは755行の単一ファイルを整理した上でのbackward-compatな移行パス）
- `resolveLogSource`のスタックフレームスキップ条件に`logger/api.ts`のパスを追加
  （分割後もロガー自身のフレームを正しくスキップするため）
- `manifest.json`（`wxt.config.ts`）の`web_accessible_resources`は`chunks/*.js`ワイルドカードで
  ビルド後のチャンクを自動カバーするため、個別追加は不要と確認
- `npm run type-check`・全7267テスト・`npm run build`とも成功
