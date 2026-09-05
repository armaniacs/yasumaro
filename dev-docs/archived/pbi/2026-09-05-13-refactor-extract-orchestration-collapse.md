# PBI 13: extractInternal オーケストレーション折り畳み（candidate/body 二重経路の統合）

優先度: Round 5 3 位 / RICE 8.75 = (5 × 2 × 70%) / 0.8w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch5.md](2026-09-05-00-backlog-arch5.md)
依存: **PBI 12 に依存**（同一ファイル `src/utils/contentExtractor/index.ts` を触る。PBI 12 の `cleansingExecuted`・chrome 削除を前提にする）

## ユーザーストーリー
抽出 hot path を保守する開発者として、クレンジング実行の「経路」が 1 つの実装に集約されてほしい。なぜなら現在は candidate path と body path にほぼ同一の ~80 行（clone → cleanse → preAiBytes → 理由判定 → AI step → dual payload → extract → fallback）が 2 重に存在し、30-11/30-13/30-14 の各機能が両経路に手動で二重適用されてきた歴史があり、次のクレンジング機能も再び 2 箇所に足すことになるから。

## 対象と範囲（2026-09-05 ファクトチェックで確定）

**スコープ内:**
1. candidate path（`:222-379`）と body path（`:380-467`）の重複 ~80 行を共有 internal step に折り畳む
2. `cleansedReason` 判定 if/else ×3（`:268-274` / `:411-417` / `:519-525`）を 1 ヘルパーに統合
3. entry 構成の再文書化（下記のなぜなぜで「維持」判断。header に本番経路の実態を明記）

**スコープ外（明示）:**
- entry 削減（`extractMainContent` string entry の削除）→ 下記分析で却下
- extractor facade collapse（`src/content/extractor.ts`）→ arch3 から継続見送り。本 PBI 着地後に test-support 再配置と合わせて小さく別 PBI 化
- GET_CONTENT handler の testability（chrome guard の裏）→ 同上のフォローアップに含める

## ファクトチェックで判明した重要事実

- **本番の抽出経路は 1 本**: `contentKernel.extractPageContent()` → `preparePageContent()` → `extractMainContentWithInfo()`。string entry `extractMainContent` の本番呼び出しは**ゼロ**（grep 済み）
- しかし string entry は**bench 計測面**である: `bench/micro/c1-bytesize.bench.mjs` と `c4-clonenode.bench.mjs` が非診断 path の計測に使用（「Measures extractMainContent() on the non-diagnostic path」と自己文書化）
- つまり「boolean trap が caller に危険」という arch レポートの指摘は弱まる — 本番 caller は string path を選べない。trap は将来の caller に対する潜在的リスクに留まる

## なぜなぜ分析（entry 削減を「やらない」と判断した根拠）

**問い: なぜ entry を 1 つにしないのか**

1. なぜ 2 entry が存在するのか → hot path（自動保存）の診断コストを排除するため、string entry が「非診断の計測・実行面」として作られたから（`bytesize-lazy.test.ts` が遅延 encode を検証）。
2. なぜ本番は string entry を使わなくなったのか → contentKernel → preparePageContent の統一（PBI-28/0823a 系）で本番経路が WithInfo に一本化されたから。
3. なぜそれでも entry が残るのか → bench c1/c4 が string path を計測面として掴んでいるから。削除すると bench baseline がリセットされ、perf round で築いた c1〜c6 ゲートの連続性が切れる。
4. なぜ bench の連続性を優先するのか → codebase-design の glossary で interface は「performance characteristics を含む」ため、2 entry は**文書化された perf interface** であり、計測の再現性は美観より価値が高いから。
5. → 解: **entry は維持**。header に「string entry は本番未使用・bench c1/c4 計測面」と実態を明記して将来の読者を導く。friction の本体であるオーケストレーションの二重化に集中する。将来 bench を再計測するタイミングで entry 削減を再評価（backlog に記録）。

**問い 2: なぜ candidate path と body path が二重化したのか**

1. なぜ 2 経路あるのか → 候補要素が見つかる/見つからないで抽出の入口が分かれるため（構造上の必然）。
2. なぜ中身が ~80 行複製なのか → clone 生成・cleanseContent・preAiBytes 解決・理由判定・AI step・dual payload・抽出・fallback 判定の各ステップが「経路ごと」に書かれ、共有 helper（applyAiCleanseStep / settleFallback / resolvePreAiBytes）が葉だけを共有したから。
3. なぜ葉だけ共有したのか → Round 2（PBI 12/16）が「重複の削除」を葉レベルで止めたから。経路構造の所有者を決めなかった。
4. なぜ次の機能追加が危険か → 30-14 のような横断機能は 2 箇所に同じ編集が必要で、片落ちがテストで捕捉されにくい（jsdom で候補あり/なし両方を走らせるテストがないと silent drift する）。
5. → 解: 経路差分（入力要素の決定方法）だけを分岐にし、**cleanse 以降を 1 つの internal step** に折り畳む。理由判定は `resolveCleanseReason(hard, keyword)` ヘルパーに集約（×3 → ×1。既存 `deriveCleansedReason` は AI count result 用で形状が違うため流用ではなく隣接配置）。

## BDD受け入れシナリオ

```gherkin
Scenario: candidate path と body path の抽出結果が同一のクレンジング統計を持つ
  Given 同一のクレンジング対象を含む DOM（候補あり版と body 全体版）
  When  それぞれの path で抽出を実行する
  Then  hardStripRemoved / keywordStripRemoved / totalRemoved / cleansedReason が同じ規則で算出される

Scenario: クレンジング理由判定は 1 箇所で書かれる
  Given src/utils/contentExtractor/index.ts
  When  "hardStripRemoved > 0" の分岐連鎖を検査する
  Then  resolveCleanseReason ヘルパー内の 1 箇所のみで、呼び出し側に if/else 連鎖が残らない

Scenario: 診断 recount の意味論は不変
  Given totalRemoved === 0 で終わった抽出
  When  withDiagnostics path で完了する
  Then  countCleanseTargets / countAISummaryTargets による recount が今日と同一に走る

Scenario: bench ゲートは連続性を保つ
  Given c1 / c4 の bench 計測面（extractMainContent string path）
  When  本 PBI のリファクタリング後に bench:micro を実行する
  Then  計測は同一 entry で行われ、entry 削除による baseline 断絶が起きない
```

## 受け入れ基準
- [x] candidate path と body path の「clone → cleanse → preAiBytes → 理由 → AI step → dual payload → extract → fallback」の重複が 1 つの internal step に統合される（経路差分＝入力要素の決定のみが分岐に残る）
- [x] `cleansedReason` 判定の if/else 連鎖が 3 箇所 → 1 ヘルパー（`resolveCleanseReason` または同等）になる
- [x] `extractMainContentWithInfo` / `extractMainContent` の 2 entry と `withDiagnostics` internal param は維持される。header に「string entry は本番未使用・bench c1/c4 計測面」と明記される
- [x] 振る舞いが変更前と同一（リファクタリング）。既存 extractor テスト（index.test.ts / extractPipeline.test.ts / bytesize-lazy.test.ts）が無修正で green
- [x] `bench:micro` が PASS（c1〜c6 ゲート値の継続性を確認。理論上は純粋リファクタリングで計測値不変）
- [x] 抽出関数の行数が 571 → ~430 行程度に縮減し、以降のクレンジング機能追加が 1 箇所で完結する

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 既存 index.test.ts の診断 matrix（100+ ケース）がそのまま振る舞いの担保になる（無修正 green がゴール）
- 新規: candidate/body 両 path で同一クレンジング入力 → 同一統計の対応テスト（drift 検出）
### 統合テスト
- contentKernel / extractor 系テスト無修正 green
### 例外ハンドリング
- try/catch フォールバック（:468-471）の挙動は不変。fallback 判定（applyFallback）は共有済みのため触れない

## 見積もり
0.8w

## 技術的考慮事項
- 依存関係: PBI 12 先行（同一ファイル・`cleansingExecuted` 前提）
- テスタビリティ: internal step は internal seam として単体テスト可能（外部 interface は不変）
- 非機能要件: hot path の encode 回数・DOM 走査回数を増やさない（診断 path の計測ブロック構造は維持）。bench ゲート c1〜c6 の PASS を確認
- ADR 整合: ADR 2026-08-27-limit-policy / 2026-08-23-ai-test-progress-client-extraction-rejected（対象外）に抵触しない

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '184,380p' src/utils/contentExtractor/index.ts   # whitelist + candidate path
sed -n '380,470p' src/utils/contentExtractor/index.ts   # body path
sed -n '503,545p' src/utils/contentExtractor/index.ts   # recount block（理由判定 3 箇所目）
rg -n "extractMainContent" bench/micro/
```

### 実装手順
1. `resolveCleanseReason(hardStripRemoved, keywordStripRemoved)` を新設（cleansedReason.ts の隣）→ 3 箇所を置換（この時点で既存テスト green を確認）
2. internal step（例: `runCleanseAndExtract(source: { kind: 'candidate' | 'body', element: Element, preText: string, preBytes: number }, ctx)`）を新設し、candidate path の本体を移植
3. body path を同一 step に付け替え（差分は入力要素の決定と preBytes の出所のみ。`originalContent` の dual payload 登録位置に注意）
4. header に entry の実態（本番未使用 / bench 計測面）を追記
5. `bench:micro` 実行して c1/c4 が PASS することを確認
6. drift 検出テスト（両 path の統計対応）を追加

### 落とし穴
- dual payload（`originalContent`）の登録タイミングが candidate path と body path で微妙に違う（:226-232 vs :434-441）。step 内で「まだ未登録なら登録」の現行順序を維持すること
- `resolvePreAiBytes` の第 3 引数（text/bytes ペアの再利用）は候補 text と body text で出所が違う。step に渡す前に解決して渡す
- body path の「cleanse 無効 + AI のみ」分岐（:329-361）は clone の有無が candidate path と非対称。step のパラメータで吸収できる形にしてから統合する（無理なら先に理由判定だけ統合して段階的に）
- meter（ByteMeter）は withDiagnostics 依存。step 内の meter 呼び出し順を変えると bench c1 の計測対象が変わる — 計測ブロック（`meter.enabled` ガード）の位置は動かさない

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] contentExtractor / content / bench 関連テスト全 green（type-check / lint / build 含む）＋ `bench:micro` PASS
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS.md の抽出パイプライン節に internal step と entry の実態を反映）

## 実装メモ（2026-09-05・branch 0905c・続）
- 完了（commit `b6300f55`、SDD サブエージェント実装）。レビュー first-pass Approved。bench:micro PASS（c1 encode 連続性を実測確認）。index.ts 540 行は非対称ドキュメント温存による soft-target ミス（意図的）。
