# PBI: utils のフラット namespace 再編

> **着手ゲート**: 本 PBI は専用ブランチを作成し、関連 PBI との統合順序および実装対象範囲を確定して着手トリガーが発行されるまで実装を開始しない。専用ブランチなしでは着手しない。

## ユーザーストーリー

保守者として、`src/utils/` の production TypeScript を責務別サブディレクトリへ段階移動し、各ファイルの `@layer` 注釈と物理配置を一致させたい。96 ファイルが直下に並ぶ現在の探索では、何がどこにあるかを把握しにくく、1,175 件規模の `utils/<直下ファイル>.js` パス参照を更新する影響範囲も読み取りにくいからだ。

## ビジネス価値

- 探索性の保守性負債を解消し、ファイル探索の起点となる分類と配置を明確にする。
- import fanout の変化を段階ごとに可視化し、移動による参照漏えいや依存方向の逆転を早期に検出する。
- 専用ブランチと統合順序の確定により、同一ファイルまたは同一 import 領域を扱う PBI との衝突を回避する。
- 移動量、対象パス参照、未分類 layer、物理配置の対応を基準値と照合し、再発を抑える。

## 優先度

- 種別: refactor
- 順位: 30 / 30
- RICEスコア: 0.08（Reach=1 / Impact=0.25 / Confidence=100% / Effort=3 SP 以上）

## BDD受け入れシナリオ

```gherkin
Scenario: 責務グループを段階的に再編しても検証が成功した状態を保つ
  Given 専用ブランチと着手トリガーが発行されている
  And 移動対象と既存パス参照の import baseline が記録されている
  When 責務グループの物理移動と @layer 注釈の変更を同じ段階で適用する
  Then 対象へ至る import、vi.mock、相対 import、re-export の参照が新しい配置と一致する
  And import linter と npm run validate が成功する

Scenario: 移動によって utils から background への依存を意図せず導入しない
  Given utils の再編で background を参照する import が検出された
  When その依存を layer と物理配置の検証にかける
  Then utils から background への static import は拒否される
  And 遅延 import が必要になる場合は LAYERS または ADR に明記された例外であることを確認する

Scenario: 関連 PBI と同一領域を競合して変更しない
  Given trustChecker.ts、cleansingStatsView.ts、RecordingOrchestrator.ts、contentExtractor、src/messaging/types.ts を含む関連 PBI がある
  And 本 PBI との統合順序が未確定である
  When utils の移動対象と実施順序を決める
  Then 関連 PBI との統合順序が確定するまで実装フェーズへ進まない
  And 各段階は競合するファイルまたは import 領域を重複して変更しない
```

## 受け入れ基準

- [ ] 専用ブランチを作成し、関連 PBI との統合順序を確定し、着手トリガー発行後に限り着手している。
- [ ] 着手時に `src/utils/` 直下 96 ファイル、production サブディレクトリ 10 個、`__tests__` 1 個、utils 配下 production TS 合計 196 ファイルを baseline として確認している。
- [ ] 96 ファイルそれぞれについて、責務グループ、移動先、`@layer` を対応付けしている。
- [ ] 責務グループごとに物理移動と `@layer` 注釈を同じ段階で適用している。
- [ ] 各段階で import linter と `npm run validate` が正常になっている。
- [ ] 更新対象の ESM import は `.js` 拡張子を維持している。
- [ ] `utils` から `background` への static import を追加していない。遅延 import を使用する場合は LAYERS または ADR に明記された例外であることを確認している。
- [ ] 移動対象への import、`vi.mock`、相対 import、re-export が新しい配置と一致し、re-export による循環が発生していない。
- [ ] 移行を容易にするため、大量の barrel や re-export を追加していない。
- [ ] 各段階の完了時に、baseline の 1,175 件のパス参照のうち移動対象への参照をすべて更新または無変更として照合し、未解決の参照を残していない。
- [ ] 既存のビルド、テスト、ユーザーに観測される動作に回帰がない。
- [ ] `trustChecker.ts`、`cleansingStatsView.ts`、`RecordingOrchestrator.ts`、`contentExtractor` 周辺、`src/messaging/types.ts` に関する PBI との統合順序を確定している。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 段階適用前の既存テストを基準として、段階適用後も公開ユーザー導線の結果が変わらないことを確認する。
- 各段階の完了条件を `npm run validate` の成功とし、型チェックとテストが正常であることを外部から確認する。
- 新しいユーザー機能は追加せず、移動による機能変更がないことを Outside-In の観測点とする。

### 統合テスト

- 物理移動、`@layer` 注釈、import、test mock、re-export の整合を段階ごとに検証する。
- `eslint/__tests__/utils-layer-boundary.test.ts` と `src/utils/__tests__/pageContentPipeline.decouple.test.ts` を含む関連テストを更新し、移動後も依存境界と pipeline の decoupling を確認する。
- import linter により、Layer 0 から 1、2、Entry への一方向依存を維持する。
- `vi.mock` を含むテスト参照と re-export 経路を検証し、解決漏れと循環がないことを確認する。

### 単体テスト

- `scripts/check-layer-annotations.mjs` と `scripts/lint-layers-docs.mjs` により、layer 注釈と LAYERS 文書の整合を確認する。
- 未分類の production TypeScript が残らないこと、および各ファイルの物理配置と `@layer` の対応不回帰を検証する。
- 現状、直下ファイル数を pin するテストはないため、段階ごとの baseline と最終的な分類対応を確認する。

## 実装アプローチ

- **Outside-In**: 着手条件、関連 PBI の統合順序、既存検証の baseline を先に確認し、その後に移動と layer 注釈を同じ段階で適用する。
- **Red-Green-Refactor**: 各段階では import linter と `npm run validate` の失敗を修正し、正常を確認してから次へ進む。
- **段階的な責務グループ化**: 96 ファイルを一括移動せず、import baseline で影響範囲を確認した責務グループから段階的に実施する。
- **同段階変更**: 物理移動と `@layer` 注釈を分離せず、import、mock、re-export の参照更新も完了させる。
- **統合順序の先行確定**: 関連 PBI と競合する対象を除外または先行・後続の順を確定してから、対象グループを選ぶ。
- **過剰な互換層の追加**: 移行を簡潔に保つため、大量の barrel や re-export を追加しない。

## 見積もり

**3 SP 以上**

1,175 件の `utils/<直下ファイル>.js` パス参照のうち、概算 600〜800 件とされる production static import を含む機械的変更が主体となるため、baseline 作成、関連 PBI との統合順序確定、96 ファイルの責務グループ化、段階的な移動と import・layer の修正、最終照合を含む。

## 技術的考慮事項

- LAYERS の規約は Layer 0 から 1、2、Entry への一方向依存である（`dev-docs/LAYERS.md:15-26,37-39,130-141`）。物理移動によって依存方向を変えない。
- ESM import では `.js` 拡張子を必須とする。移動後の相対 import は、ファイル位置だけでなく export 経路も含めて再計算する。
- `utils` から `background` への static import は禁止する。遅延 import は、LAYERS または ADR に例外として明記されている場合だけ維持する。
- 1,175 件のパス参照には import、`vi.mock`、コメントが含まれるため、baseline では production static import、test mock、re-export、コメント参照を区別する。
- `settingsExportImport.ts` は 542 行、`aiSummaryCleaner/stripExtended.ts` は 493 行、`storage/encryptionSession.ts` は 483 行、`aiSummaryCleaner/selectorRules.ts` は 450 行、`contentExtractor/whitelistAdapterGenerator.ts` は 448 行、`contentExtractor/index.ts` は 441 行である。大きなファイルであることを移動理由だけとすると fanout を見落とす可能性があるため、参照数と併せて対象範囲を評価する。
- `@layer` は依存方向を制限するが、配置の所属を強制しない。layer lint だけでは物理配置の不整合を検出できないため、別途分類対応を確認する。
- 次の PBI と統合順序を決める必要がある: `2026-09-25-05-fix-trustchecker-legacy-dead-code.md`、`2026-09-25-07-refactor-format-bytes-ssot.md`、`2026-09-25-03-refactor-previewonly-flag-cleanup.md`、`2026-09-25-28-investigate-content-hot-path-yield.md`、`2026-09-25-20-doc-messaging-layer-decision-record.md`。
- `2026-09-25-22-investigate-pending-queue-poison-record.md` は本 PBI の前提または統合先ではない。

## 実装者向け注記

### 現状コードの確認

- `src/utils/` は 107 entries である。直下 production TypeScript は 96 ファイル、production サブディレクトリは 10 個、`__tests__` は 1 個である。
- production サブディレクトリ内の TypeScript は約 100 ファイルで、utils 配下 production TS は合計 196 ファイルである。
- `@layer` は 34 match であり、うち 1 件はコメント、実 header は 33 ファイルである。未分類ファイルが残っている。
- `utils/<直下ファイル>.js` の path 参照は、background 535、dashboard 397、offscreen 82、popup 111、content 26、messaging 15、privacy 6、entrypoints 3、合計 1,175 件である。
- 現状、layer 境界・注釈・文書・pipeline の decoupling に関係する `eslint/__tests__/utils-layer-boundary.test.ts`、`scripts/check-layer-annotations.mjs`、`scripts/lint-layers-docs.mjs`、`src/utils/__tests__/pageContentPipeline.decouple.test.ts` が確認できる。
- 直下ファイル数を pin するテストはない。
- 専用ブランチと着手トリガーが揃うまで、既存ファイルと import を変更しない。

### 実装手順

1. 専用ブランチと着手トリガーの成立を確認する。
2. 直下 96 ファイルについて、production import、test mock、re-export、コメント参照を分けて baseline を作成する。
3. 関連 PBI との統合順序と競合領域を確認し、各対象の先行・後続を決める。
4. 責務グループと移動先、`@layer` の対応を決める。グループの位置は既存の production サブディレクトリとの責務整合および依存方向を基準に決める。
5. import 影響とリスクに応じて対象グループを段階単位に並べる。
6. 各段階で対象ファイルを移動し、同時に `@layer`、対象 import、`vi.mock`、相対 import、必要な re-export を更新する。
7. 各段階で import linter と `npm run validate` を実行し、正常を確認する。
8. baseline と照合し、移動対象の未解決参照、layer 未分類、物理配置と責務の不一致がないことを確認する。
9. 対象グループを順に処理し、96 ファイルの分類対応がすべて完了するまで各段階を独立して正常な状態にする。

### 落とし穴

- ファイルを移動しただけで責務境界を満たしたと判断すると、`@layer` と配置が再び別々の情報になる。
- `vi.mock` のパスを通常 import と同じ扱いすると、テスト時にのみ解決できないパスが残る。
- 移動時に相対 import の `../` を一律に置換すると、barrel を経由しない実体の export を誤った位置へ接続する。
- re-export を不改変で残すと、物理移動後に import 循環や曖昧な export が新たに生じる。
- 遅延 import を通常の例外扱いにして、LAYERS または ADR の明示的例外を確認しないと、依存方向の逆転を隠す。
- 関連 PBI の実装中に同じファイルまたは import 領域を変更すると、統合時に意図した変更と移動変更が競合する。
- 96 ファイルを一括移動すると、1,175 件の path 参照と test mock の更新漏れを段階的に発見できない。

## 決定事項

1. 96 ファイルが直下に残った理由は、責務別サブディレクトリ導入前に一括追加されたためである。
2. 一括整理されていない理由は、import fanout が 1,000 件規模になり、段階移行の計画がないためである。
3. layer lint だけでは防げない理由は、`@layer` が依存方向を制限するが配置の所属を強制しないためである。
4. 今是正する必要が立っている理由は、実害ではなく発見的な保守性負債であり、是正の期限がないためである。
5. 全量一括移動ではなく、import baseline で影響範囲とリスクを確認した責務グループから段階移動する。グループ配置は、各グループの責務と依存方向を対応付けしてから確定する。
6. 物理移動と `@layer` 注釈の変更は同じ段階で完了させる。
7. 移行目的の barrel と re-export の大量追加は行わない。
8. 専用ブランチと着手トリガーの成立を実装の必須前提とする。
9. 関連 PBI との統合順序を先に確定し、同一ファイルまたは同一 import 領域の重複変更を避ける。

## Definition of Done

- [ ] 専用ブランチと着手トリガーが成立している。
- [ ] 関連 PBI との統合順序が確定している。
- [ ] 96 ファイルすべての責務グループ、移動先、`@layer` が対応している。
- [ ] 物理配置と `@layer` の分類に不一致がない。
- [ ] 1,175 件のパス参照 baseline に対して、未解決の移動対象参照がない。
- [ ] 対象 import、`vi.mock`、相対 import、re-export が新しい配置と整合している。
- [ ] ESM import の `.js` 拡張子が維持されている。
- [ ] `utils` から `background` への static import がない。遅延 import には LAYERS または ADR の例外明記がある。
- [ ] 大量の barrel や re-export を追加していない。
- [ ] 各段階で import linter と `npm run validate` が成功している。
- [ ] 既存のビルド、テスト、ユーザーに観測される動作に回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
