# PBI: Utils Layer Boundary Formalization

**Date:** 2026-08-22  
**Priority:** Medium (foundation for future refactoring)  
**Estimation:** 2 points

---

## ユーザーストーリー

**As a** チーム開発者  
**I want to** `src/utils/` の層構造（Layer 0/1/2）を形式化し、命名規則と dependency ルールを明確にする  
**So that** 新規ファイル配置時に迷わず、無意識エラーを減らせる

---

## ビジネス価値

### 主要価値
1. **Onboarding 効率化**: 新規開発者が「utils/ 配下のどこに置くべきか」判断できる
2. **循環依存検出**: trustDb ↔ settingsStore の既存循環依存を明記し、将来の無意識削除を防止
3. **Re-export barrel 管理**: storage.ts の 17+ import を 3 層に整理

### 測定方法
- ✓ dev-docs/LAYERS.md または docs/ARCHITECTURE.md に層構造ドキュメント化
- ✓ Layer 0/1/2 の境界を形式化（ディレクトリ分割または comment marking）
- ✓ 循環依存を ADR に記録

---

## 現状とリスク分析

### 現在の実装状況
```
src/utils/
  ├── logger/         (Layer 0: no deps)
  ├── crypto/         (Layer 0)
  ├── errorUtils.ts   (Layer 0)
  ├── storage/        (Layer 1: Layer 0 のみに依存)
  ├── trustDb/        (Layer 1: Layer 0 + storage に依存 ← 循環あり with storage!)
  ├── repositories/   (Layer 2: Layer 0/1 に依存)
  ├── pageContentPipeline.ts (Layer 2)
  ├── aiSummaryCleaner/ (Layer 2)
  └── ... (混在状態)
```

### なぜなぜ分析: なぜ層構造を形式化するのか？

**Question 1: 現在、層が de facto で機能しているなら、形式化のコストに見合う価値があるのか？**
- **Answer**: 無意識エラーのリスク
  - 情報が暗黙的 → 新規開発者が LayerX に依存するコード を LayerY に置く
  - 循環依存が comment で隠蔽 → リファクタ時に「なぜこんな複雑な import?」と削除試行
  - runtime エラー → デバッグ困難

- **根本原因**: 層ルールが **ドキュメント化されていない**
  - 修正: 明示的な境界定義 + チェックリスト

**Question 2: なぜ storage.ts が re-export barrel なのか、分割しないのか？**
- **Answer**: 段階的移行の戦略
  - 一度に分割すると 17+ import を全て書き直す（破壊的）
  - 先に層を **形式化し、ドキュメント化**する（低リスク）
  - 次の refactor (PBI#3 以降) で gradual migration

**Question 3: trustDb ↔ settingsStore の循環依存は、なぜ存在するのか？**
- **Answer**: 設計上の制約
  - trustDb: Tranco ドメインリストのバージョンを追跡
  - settingsStore: ユーザー設定の永続化
  - 両者が相互に参照する業務ルール → 遅延 import で中継
  - 削除は不可。ただし **記録が必要** (ADR)

---

## BDD 受け入れシナリオ

```gherkin
Scenario: Utils Layer ドキュメント化で新規ファイル配置が明確になる
  Given Layer 0/1/2 の定義がドキュメントに明記されていない
  When 開発者が新しい utility 関数を書く際、どの層に置くべきか判断する
  Then 層ルール文書を参照して正しく配置できる

Scenario: 既存循環依存が明記され、将来のリファクタで無意識削除を防ぐ
  Given trustDb ↔ settingsStore の循環依存が ADR に記録されていない
  When 今後のリファクタで「なぜこんな複雑な import?」と削除試行される
  Then ADR で理由が明記されているため、削除を防止できる

Scenario: Layer 0/1/2 の境界が形式化され、grep で layer 所属を確認できる
  Given utils/ 配下のファイルが layer フラグなしにいる
  When 開発者が「storage.ts は何に依存しているか」を調べる
  Then ファイルの先頭コメント or ファイル構造で layer が一目瞭然
```

---

## 受け入れ基準

- [ ] `dev-docs/LAYERS.md` または `docs/ARCHITECTURE.md` に utils/ layer 構造を明記
  - Layer 0: logger, crypto, errorUtils (依存なし)
  - Layer 1: storage, trustDb, domain repositories (Layer 0 のみに依存)
  - Layer 2: pageContentPipeline, aiSummaryCleaner など (Layer 0/1 に依存)
- [ ] 循環依存 (trustDb ↔ settingsStore) を新規 ADR または既存 ADR に記録
- [ ] re-export barrel (storage.ts) を形式化（再構成は Wave 3+）
- [ ] 新規ファイル配置チェックリスト をドキュメント作成
- [ ] npm run validate pass

---

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（ドキュメント形式化のため、実装テストは不要）

### 統合テスト
- Layer 0/1 の依存グラフ を graph で可視化し、整合性確認
- grep で全 import を scan して layer violation がないか検証

### 単体テスト
- ドキュメントの completeness テスト
  - 全ファイルが layer に分類されているか
  - Layer 違反の import がないか

---

## 実装アプローチ

### Step 1: Layer ドキュメント作成
```markdown
# src/utils/ Layer Architecture

## Layer 0: Foundation (No dependencies)
- logger/
- crypto/
- errorUtils.ts
- [etc.]

## Layer 1: Infrastructure (Layer 0 only)
- storage/ (storage.ts barrel + storageUrls.ts)
- trustDb/ (with special note: circular dep with settingsStore)
- domain repositories (recordsRepository, etc)

## Layer 2: High-level Utilities (Layer 0/1)
- pageContentPipeline.ts (readability + PII + custom extractors)
- aiSummaryCleaner/
- [etc.]

## Circular Dependencies (Must Maintain)
- trustDb ↔ settingsStore (遅延 import 中継。詳細は ADR-XXXX)
```

### Step 2: ADR 記録（既存 または 新規）
```markdown
# ADR: Utils Layer 循環依存の記録

trustDb と settingsStore は相互依存：
- trustDb: Tranco version tracking (needs settingsStore for version source-of-truth)
- settingsStore: 設定永続化 (needs trustDb for domain trust state)

緩和策：遅延 import via wrapper function (getSettingsStore())

**この依存は削除不可。将来のリファクタでの無意識削除を防ぐため、記録を維持。**
```

### Step 3: チェックリスト作成
```markdown
# New Utility File Placement Checklist

□ Does your function/module need Layer 0 (logger, crypto)?
  → Yes: → Layer 0/1/2 any layer
  → No: → go to next

□ Does your function/module import from storage, trustDb, repositories?
  → Yes: → Layer 1 or Layer 2
  → No: → Layer 0

□ Does your function/module import from Layer 1?
  → Yes: → Layer 2
  → No: → Layer 0 or Layer 1

□ Create new directory under utils/ with layer designation in comment:
  // Layer 1: Infrastructure — [purpose]
  export ...
```

---

## 実装者向け注記

### 現状確認
```bash
# layer 0 の依存性なしを確認
grep -r "import" src/utils/logger/ src/utils/crypto/ | grep -v "from" | wc -l

# storage.ts の 17+ import を確認
grep -r "from.*storage.js" src/ | wc -l

# trustDb の import を確認
grep "import.*trustDb" src/utils/storage/ src/utils/settings*
```

### 落とし穴
1. **Layer 定義の過度な厳密性**:
   - 緩すぎる: Layer 1 と Layer 2 の区分が曖昧
   - **推奨**: Layer 1 = chrome.storage 依存 or storage.ts 依存, Layer 2 = application logic

2. **Re-export barrel の残置**:
   - storage.ts の barrel を形式化のみ（分割はしない）
   - 理由: 17+ import を一度に書き直すと破壊的、段階的移行は Wave 3+

3. **循環依存の明記**:
   - 削除不可な循環依存を曖昧に放置しない
   - **必須**: なぜ存在するか、どう中継しているかを ADR に記録

---

## Definition of Done

- [ ] `dev-docs/LAYERS.md` または `docs/ARCHITECTURE.md` 作成・記載
- [ ] Layer 0/1/2 の定義が明確（ディレクトリまたは comment で区別可能）
- [ ] 循環依存 (trustDb ↔ settingsStore) を ADR に記録
- [ ] 新規ファイル配置チェックリスト を docs に追加
- [ ] Layer 違反の grep で検出（ドキュメント整合性テスト）
- [ ] コードレビュー完了
- [ ] npm run validate pass

---

## 参考資料

- [ADR 2026-07-13: Architecture Phase 2 Deep-Dig](../dev-docs/ADR/2026-07-13-architecture-phase2-deep-dig.md) — Panel abstraction も同様の layer pattern
- [Current utils/ structure](src/utils/)
- [re-export barrel: storage.ts](src/utils/storage.ts)

---

## 次の Wave への接続

**Wave 3**: 層の段階的分割（infrastructure/repositories/helpers）
- **依存**: Wave 2 (層ドキュメント化) が完成してから開始
- **見積もり**: 2-3 points（storage.ts barrel の gradual splitting）
