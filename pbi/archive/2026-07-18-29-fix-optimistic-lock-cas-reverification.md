# PBI: optimisticLock CAS操作の書き込み後再検証ステップ追加

## ユーザーストーリー
開発チームとして、`optimisticLock` の CAS (Compare-And-Swap) 操作が真の意味での競合検出を保証してほしい、なぜなら `chrome.storage.local` はネイティブのCAS機能を提供しないため、READと WRITEの間に競合ウィンドウが存在し、2つの同時書き込みが両方ともバージョンチェックを通過してしまう可能性があるから

## ビジネス価値
- 楽観的ロックが保護しようとしているデータ（設定、URLキャッシュ等）の整合性をさらに強化
- 既に二重チェック実装済みのため、追加の検証は防御を1段階厚くする位置づけ（side-effects.md M6判定: 副作用軽微）

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/utils/optimisticLock.ts:134-167`（`performCasUpdate`）— 既に「二重チェック」実装済み: READ(142-146行目付近)でバージョン検証を行い、その後WRITE(163-167行目)を実行する構造
- 現状の実装は「READで検証 → WRITE」の1回のみで、WRITE**後**の再検証は行われていない
- 対処案（親レポートより）: 書き込み後に即座に再検証（re-read + compare）する検証ステップを追加。または不要な楽観的ロック呼び出しを削除して競合機会を減らす
- side-effects.md M6判定: 「追加検証はI/O呼び出し1回増でレイテンシ微増程度」— 副作用は軽微だが、コストとのトレードオフを踏まえた判断が必要

```bash
# 実装前の再確認コマンド
sed -n '130,175p' src/utils/optimisticLock.ts
grep -rn "performCasUpdate\|withOptimisticLock" src/ --include="*.ts" | grep -v __tests__
```

**設計判断が必要**: 親レポートは「再検証追加」と「不要呼び出し削除」の2案を提示している。M32（`saveSqliteStep`の楽観的ロック削除）が既に別PBIとして進行する場合、`withOptimisticLock`の呼び出し箇所自体が減るため、本PBIでは「再検証追加」による防御強化を採用する（削除は個別ケースごとに判断済みのため）。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常のCAS更新は従来通り成功する
  Given 単一プロセスからのCAS更新リクエスト
  When performCasUpdateを実行する
  Then バージョンチェックが通過し、書き込みが成功し、書き込み後の再検証でも一致が確認される

Scenario: 書き込み後の再検証で競合が検出される
  Given 2つの並行するCAS更新（A, B）が同じキーに対して実行される状況
  When Aの書き込み完了直後にBが書き込みを行い、Aが書き込み後の再検証を行う
  Then Aの再検証で自分の書き込んだ値と異なることを検出し、ConflictErrorがthrowされる
```

## 受け入れ基準
- [ ] `performCasUpdate`（`src/utils/optimisticLock.ts:134-167`）の書き込み処理後に、再度 `chrome.storage.local.get` で値・バージョンを読み取り、自分が書き込んだ値と一致するか検証するステップを追加
- [ ] 不一致が検出された場合は `ConflictError` をthrowする
- [ ] 既存の呼び出し元（`withOptimisticLock` 経由の全箇所）の挙動に予期しない変化がない（リトライロジックとの整合性を確認）

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- `withOptimisticLock` を使う既存の呼び出し元（例: 設定更新処理）で、正常系の動作が変わらないことを回帰確認

### 単体テスト
- `performCasUpdate` に対して:
  - 正常系（書き込み後の再検証が一致）でエラーが発生しないことを検証
  - 書き込み直後に別の値で上書きされた状況をモックし、再検証で `ConflictError` がthrowされることを検証

## 実装アプローチ
- **Outside-In**: 「書き込み後に他プロセスが割り込んだ場合に再検証でConflictErrorが検出される」単体テストをRedで書き、再検証ステップ実装でGreenにする

## 見積もり
2pt（半日。既存のリトライロジック（`maxRetries`, `initialDelay`）との整合性確認を含む）

## 技術的考慮事項
- 依存関係: `withOptimisticLock` の全呼び出し元に影響するため、変更後は既存テストスイート全体での回帰確認が必要
- テスタビリティ: `chrome.storage.local.get/set` のモックで競合状況を再現可能
- 非機能要件: レイテンシ微増（I/O呼び出し1回増）とのトレードオフ

## 落とし穴
- 再検証ステップ追加によりリトライ回数が実質的に増える可能性があるため、`maxRetries` のデフォルト値が妥当か合わせて確認すること
- 既存の呼び出し元でこの追加I/Oによるレイテンシ増が許容範囲か、特に頻繁に呼ばれる箇所（記録処理のホットパス）への影響を確認すること

## Definition of Done
- [ ] 書き込み後再検証ステップが実装されている
- [ ] 単体テストで競合検出が正しく動作することを確認
- [ ] 既存の全呼び出し元での回帰テストがパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
