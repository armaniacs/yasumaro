# PBI: visitAdmission retry/load 双子の集約（refactor）

優先度: 台帳 RICE 8.0（Reach 4 / Impact 1 / Confidence 1.0 / Effort 0.5pt）
backlog: [2026-09-18-00-backlog-holistic-0918.md](2026-09-18-00-backlog-holistic-0918.md)（台帳、候補 C3）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、visit 許可フローの retry 待機と extractor 読み込みを1箇所に集約してほしい、なぜなら現在は同一の待機・警告が2箇所に複製されており、政策変更時に乖離するリスクがあるから。

## 背景（現状と課題）

`src/content/visitAdmission.ts` に以下の双子がある（着手時に行番号を再確認すること）：

1. `checkDomainWithRetry` 内の `await sleep(200 * (attempt + 1))` が 118・121行目付近に複製（空応答枝と例外枝）
2. `resolveVisitAdmission` 内の loadExtractor try/catch（`[OWeave] Dynamic import blocked` 警告）が 142-147・162-167行目付近に複製（cache-hit 経路と background-verdict 経路）
3. 101-106行目付近の NOTE が示すとおり線形スケジュールは意図的に `backoffDelayMs` SSOT の外にあるが、手動同期の drift 余地が2箇所に分散している

対応方針: `backoffOnce(attempt, sleep)` と `loadExtractorBestEffort(deps)` の seam を新設し両箇所から委譲する。待機式・警告文言・e2e ラベル（warnLabel）の扱いは不変。NOTE は新 seam 内に移設する。

## BDD受け入れシナリオ

```gherkin
Scenario: 空応答と例外で同一の待機になる
  Given 2 回空応答の後に成功する sendCheckDomain
  When checkDomainWithRetry を呼ぶ
  Then 待機列は統合前と同一（200ms, 400ms）である

Scenario: 両経路で同一の警告になる
  Given loadExtractor が throw する deps
  When cache-hit 経路と background-verdict 経路で resolveVisitAdmission を呼ぶ
  Then 両方とも統合前と同一の警告文言・引数で warn が呼ばれる
```

## 受け入れ基準

- [x] `backoffOnce`・`loadExtractorBestEffort` が定義されている
- [x] sleep 式・警告文言が統合前と byte-identical
- [x] e2e-bypass-safety 性質（cold cache は必ず background に問う）が維持される
- [x] backoffDelayMs 非採用の NOTE が新 seam 内に残っている
- [x] `npm run type-check` が green
- [x] visitAdmission 関連 vitest が green

## テスト戦略

- parity テスト（新規）: sleep 列・warn 呼び出しを pin してから集約する
- 既存テストの維持: visitAdmission・loader 系テストが無修正でパスすること

## 見積もり

0.5pt（2 seam + parity test。小規模）。

## 実装ガイド

- 着手時点での確認ポイント: `src/content/visitAdmission.ts:99-168`、`src/content/loader.ts` の deps 組み立て
- 待機式・警告文言の整形は行わないこと
- フルテストスイートは統合側が行う。担当検証は type-check + 関連 vitest に絞る
