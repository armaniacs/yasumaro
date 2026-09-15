# PBI: ArchiveSessionStore 抽出 — 500行 mount の状態機械化

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、アーカイブの staging ライフサイクルが状態機械として表現されていてほしい。なぜなら現在は3つの nullable 変数 + dirty フラグに分散した状態が約500行の mount クロージャで管理されており、staging 不整合（open 前の render 等）のバグが順序制約の見落としから生じているから。

## 優先度

- 順位: 1 / 本バッチ4件中
- RICEスコア: 10.0（Reach=8 / Impact=2 / Confidence=50% / Effort=0.8人週）
- 根拠: archivePanel は過去の QA で staging 順序バグ（sessionStaging が open 前に設定されず一覧が空）を経験した領域。抽出後は遷移表1箇所の修正に収束する。Confidence 50% は 500行 mount の抽出リスクを反映

## 背景（診断結果）

- `src/dashboard/panels/diagnostic/archivePanel.ts:30-68` — staging ライフサイクルの状態が nullable 変数（sessionStaging / currentSessionId 等）+ dirty フラグに分散
- `archivePanel.ts:215-256` — busy スコープ内での sessionStaging 引き継ぎ（過去の修正箇所）
- `archivePanel.ts:366-380,432-495` — sessionStaging は renderSessionList の前に設定されるという順序制約がコメントのみ
- 状態機械: idle → staged → open → dirty の遷移が明示されていない

## 実装ガイド

1. **`ArchiveSessionStore` を新設**（`src/dashboard/panels/diagnostic/archiveSessionStore.ts`）:
   ```ts
   export type ArchiveLifecycleState = 'idle' | 'staged' | 'open' | 'dirty';
   interface ArchiveSessionStore {
     getState(): ArchiveLifecycleState;
     stageSession(name: string): void;       // idle → staged
     markOpen(): void;                        // staged → open
     markDirty(): void;                       // open → dirty（illegal なら no-op + log）
     clear(): void;                           // → idle
     getSessionName(): string | null;
     isDirty(): boolean;
   }
   ```
2. **archivePanel が状態変数の代わりに store を参照**: `sessionStaging` 等の nullable 変数を store への委譲に置換。mount クロージャの該当行を store 呼び出しに置換（500行 mount は保持、状態管理のみ抽出）
3. **遷移の illegal ガード**: store 内部で遷移の妥当性を検査し、不正遷移はログ + no-op（現行の防御的 null チェックの置換先）
4. **モーダルの抽出は別 PBI**（診断ではモーダル分離も推奨されたが、本 PBI は状態機械のみ — 範囲爆発を防ぐ）

### 触ってはいけないもの

- `archiveEditModal.ts`（独立モジュール）
- e2e の archive-required-verification の契約（R1-R3 の検証内容）

## BDD受け入れシナリオ

```gherkin
Scenario: staging → open の遷移が記録される
  Given store が staged 状態で session 名を持つ
  When  markOpen が呼ばれる
  Then  状態が open になり、session 名は保持される

Scenario: dirty 遷移の illegal ガード
  Given store が idle 状態
  When  markDirty が呼ばれる
  Then  状態は変わらず警告ログが出る

Scenario: 過去の退行が pin される
  Given store が staged 状態
  When  open 後に renderSessionList が呼ばれる
  Then  sessionStaging の値が引き継がれ一覧が空にならない（過去バグ 6.8.11 の回帰）
```

## 受け入れ基準

- [x] `archivePanel.ts` から staging セッションライフサイクルの nullable 状態変数（`sessionStaging` / `archiveDirtyLocal`）が消え、store への委譲になっている
- [x] 不正遷移（idle からの markDirty / markOpen 等）がログ付き no-op になる（遷移表テストで pin）
- [x] archivePanel.test.ts / archiveEditModal.test.ts 全件 green（11 passed）
- [x] 新規 store テスト 9件 green（遷移表・reconnect・6.8.11 退行 pin 含む）
- [ ] archive-required-verification e2e（R1-R3）— Phase 3 の一括 e2e で確認

実装メモ: 「作成→ダウンロード→クリーンアップ」フローの `lastStagingName`/`lastFileName` は線形フローで分岐を持たないため状態機械の対象外（パネル内ローカル変数のまま・コメントで記録）。

## テスト戦略

- 単体: ArchiveSessionStore の遷移表テスト（新規）
- e2e: 既存 archive-required-verification（R1-R3）+ dashboard issue-report が回帰網

## 見積もり

3-5日（ Confidence 50% はこの抽出のスパイク要因 — mount 内の状態参照箇所が想定より多い場合あり）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（store 先頭コメントに遷移表）
