# PBI: デッドコード削除 — optimisticLock conflictStats とドキュメント整備

元指摘: Checking Team (High: System Architect; Medium: Documentation Architect)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

## ユーザーストーリー

開発チームとして、`src/utils/optimisticLock.ts` の `conflictStats` / `getConflictStats` / `resetConflictStats` を削除し、`AGENTS.md` のアーキテクチャ図とコマンド表記を実態に合わせて修正したい。なぜなら、`conflictStats` は module-level の可変状態で Service Worker 再起動時に消失し、かつプロダクションコードから参照されておらず事実上デッドコードであり、AGENTS.md は WXT 構成（`entrypoints/`）を反映していないから。

## ビジネス価値

- Service Worker ステートレス原則への準拠
- コードベースの保守性向上
- 新規開発者のオンボーディング改善

## 前提・制約

- `conflictStats` は `src/utils/optimisticLock.ts:19` で定義
- `getConflictStats()` / `resetConflictStats()` はテストファイルのみで使用（`optimisticLock.test.ts`, `optimisticLock-security.test.ts`, `storage-locking.test.ts`）
- `AGENTS.md:40` の `npm build` は正しくは `npm run build`
- `AGENTS.md:71-76` の Dashboard パスは `src/dashboard/dashboard.html` とあるが実際は `entrypoints/options/index.html`

## BDD受け入れシナリオ

```gherkin
Feature: Dead code removal and doc cleanup

  Scenario: conflictStats no longer exists
    Given `optimisticLock.ts` is searched
    Then `conflictStats`, `getConflictStats`, `resetConflictStats` are not found

  Scenario: Tests no longer rely on conflictStats
    Given the test files run
    Then they pass without referencing conflictStats

  Scenario: AGENTS.md reflects actual WXT structure
    Given a developer reads AGENTS.md
    Then Dashboard is described as `entrypoints/options/` + `src/dashboard/`
    And the build command is `npm run build`
```

## 受け入れ基準

- [ ] `src/utils/optimisticLock.ts` から `conflictStats` / `getConflictStats` / `resetConflictStats` を削除
- [ ] 使用箇所がある場合は `optimisticLock.ts` 内の内部統計も削除
- [ ] 依存するテストファイルから `getConflictStats` / `resetConflictStats` のインポートとテストケースを削除
- [ ] `AGENTS.md` のアーキテクチャ図を WXT 構造に修正
- [ ] `AGENTS.md:40` の `npm build` → `npm run build` に修正
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `optimisticLock.test.ts` から conflictStats 関連テストを削除
- `optimisticLock-security.test.ts` から削除
- `storage-locking.test.ts` から `resetConflictStats` 呼び出しを削除

### 統合テスト
- なし

## 実装アプローチ

- **Inside-Out**: まず `optimisticLock.ts` から統計機能を削除 → テスト更新 → ドキュメント修正
- `getConflictStats` を削除する際、テストで利用されていた競合検出の補助確認は、直接 `withOptimisticLock` の戻り値やエラーで代替

## 見積もり
2pt（デッドコード削除 + テスト3件更新 + ドキュメント修正）

## 副作用
🟢 なし — プロダクションコードで使用されていない機能の削除のみ。

## 落とし穴
- `storage-locking.test.ts` の `resetConflictStats()` はテスト間のクリーンアップ用途かもしれない。削除後にテストが flaky にならないか注意。
- `optimisticLock-security.test.ts` で `conflictStats` がセキュリティ確認（例: 競合発生確認）に使われている場合、別の方法で検証する。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
