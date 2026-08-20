# PBI: Recording Pipeline Steps の内部化 — 13の shallow step を深い Pipeline に集約

## ユーザーストーリー
開発者として、`src/background/pipeline/steps/*.ts` の13のステップモジュール（`truncate`, `domainFilter`, `permission`, `trust`, `privacyHeaders`, `duplicate`, `privacyPipeline`, `extractSentences`, `formatMarkdown`, `saveObsidian`, `saveLocalMarkdown`, `saveSqlite`, `saveMetadata`）がそれぞれ `PipelineStep` interface（`context in → context out + ErrorStrategy`）を持つ浅いモジュールの集合になっている状態を解消したい。なぜなら、ステップ間の ordering・`force`/`skipDuplicateCheck`/`previewOnly` フラグの相互作用・`BEST_EFFORT` の握りつぶしといった本質的な不具合がどの単一ステップにも属さず `RecordingPipeline.execute()` の呼び出し方に宿り、バグの局所性（locality）が失われているからだ。

## 優先度
- 順位: 02 / 5
- RICEスコア: (Reach=10 × Impact=2 × Confidence=0.8) / Effort=3 = 5.3
- 根拠: Reach 10（全録画パス — 自動記録・手動記録・プレビュー・offline retry の全てが通過する唯一のオーケストレータ）。Impact 2（フラグ相互作用のバグはユーザーの保存失敗・重複保存・プライバシー漏洩に直結するが、01の AI品質汚染ほどの直接的なデータ汚染ではない）。Confidence 80%（ステップは全て in-process で、外部依存は注入済み `UrlStore` / `OfflineNetworkQueue` のみ。deepening の seam は自明 — `record()` のみを公開）。Effort 3人日（13ステップの内部化 + `ErrorStrategy` dispatch の統合 + `RecordingContext` mutation のカプセル化 + テスト移行）。01と並列着手可能。

## ビジネス価値
- バグの局所化: `force + previewOnly` や `skipDuplicateCheck + force` の組み合わせ不具合が1モジュールに集約され、修正が1箇所で完結する。現状は `execute()` と各ステップの `ErrorStrategy` 定義の両方を追う必要がある。
- テストの堅牢性: ステップの内部リファクタリング（例: `privacyPipeline` のリトライ回数変更）がテストを壊さない — テストは `RecordingResult`（interface の観測可能な出力）のみを検証するため。
- 測定方法: `force` / `skipDuplicateCheck` / `previewOnly` の全組み合わせ（8通り）に対する pipeline E2E テストがパスし、ステップ個別の unit テスト数（現行13ファイル）が0になりつつカバレッジが維持される。

## BDD受け入れシナリオ

```gherkin
Scenario: 単一 seam で録画が完結する
  Given 有効な RecordingData（url, title, content）が与えられる
  When RecordingPipeline.record(data) が呼び出される
  Then RecordingResult（成功または失敗理由）が返却される
  And 呼び出し元は PipelineStep / ErrorStrategy / RecordingContext を知る必要がない

Scenario: フラグ相互作用が正しく処理される
  Given force=true かつ skipDuplicateCheck=true の RecordingData が与えられる
  When record() が呼び出される
  Then domainFilter / trust / privacyHeaders のブロックがスキップされ、かつ duplicate チェックもスキップされる
  And pipeline の save 系ステップ（saveObsidian / saveSqlite / saveMetadata）が実行される

Scenario: previewOnly で書き込みがスキップされる
  Given previewOnly=true の RecordingData が与えられる
  When record() が呼び出される
  Then privacyPipeline まで実行された時点で RecordingResult が返却される
  And saveObsidian / saveLocalMarkdown / saveSqlite / saveMetadata は実行されない

Scenario: BEST_EFFORT ステップの失敗が pipeline 全体を abort しない
  Given Obsidian への保存が失敗する環境で RecordingData が与えられる
  When record() が呼び出される
  Then pipeline は失敗を RecordingResult に記録しつつ、後続の saveLocalMarkdown / saveSqlite / saveMetadata を継続する
  And 呼び出し元には部分成功として結果が返る

Scenario: per-URL Mutex で競合が防がれる
  Given 同一URLへの2つの並行する record() 呼び出しがある
  When 両方が同時に実行される
  Then 一方が Mutex で待機し、checkDuplicate → saveMetadata の read-then-write ウィンドウで TOCTOU 競合が発生しない
```

## 受け入れ基準
- [ ] `RecordingPipeline` の公開 interface が `record(data: RecordingData) => Promise<RecordingResult>` と `recordWithPreview(data) => Promise<RecordingResult>` の2メソッドのみになる。`PipelineStep`, `ErrorStrategy`, `RecordingContext` の export が削除またはモジュール内部の private 型になる。
- [ ] 13のステップファイル（`steps/*.ts`）が `src/background/pipeline/RecordingPipeline.ts` 内部の private 関数または `src/background/pipeline/internal/` 配下の非公開モジュールに移動する。外部から `import { checkDomainFilterStep }` のように直接 import されることがなくなる。
- [ ] `ErrorStrategy`（`FATAL` / `RETRY` / `BEST_EFFORT`）の dispatch と `RecordingContext` の mutation が `RecordingPipeline.execute()` 内部にカプセル化される。呼び出し元が戦略を意識する必要がなくなる。
- [ ] `resultBuilder.ts` と `mappers/BrowsingLogRecordMapper.ts` が Pipeline 内部の private helper になる。外部から直接呼ばれることがなくなる。
- [ ] 既存の pipeline テスト（`recordingPipeline-*.test.ts` 5ファイル + `steps/__tests__/*.test.ts` 13ファイル）が `RecordingPipeline.record()` の interface テストに移行し、パスする。旧 step unit テストは削除する（replace, don't layer）。
- [ ] `force` / `skipDuplicateCheck` / `previewOnly` の全組み合わせ（8通り）をカバーする E2E テストが存在する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- `RecordingPipeline` × 全フラグ組み合わせ（8通り）× 主要な失敗モード（Obsidian失敗 / AI失敗 / 重複）のマトリクスで `RecordingResult` を検証。

### 統合テスト
- `RecordingPipeline` × `UrlStore`（fake）× `OfflineNetworkQueue`（fake）で、重複チェックと offline retry の連携を検証。
- `RecordingPipeline` × `SqliteClient`（fake transport）で、saveSqlite の BEST_EFFORT 握りつぶしを検証。

### 単体テスト
- 本PBIでは step 個別の単体テストを追加しない。深いモジュールの内部は private seam であり、interface テストでカバーする。境界値（空 content / 巨大 content / 不正 URL）は interface テストで検証。

## 実装アプローチ
- **Outside-In**: まず `RecordingPipeline` の E2E テスト（フラグ組み合わせ8通り）を RED にし、ステップを内部化して GREEN にする。
- **Red-Green-Refactor**: ステップを1つずつ内部化（truncate → domainFilter → ... → saveMetadata の順）し、都度 GREEN を確認。
- **リファクタリング**: GREEN になるたびに `RecordingContext` の不要なフィールドを削除し、mutation を最小化。

## 見積もり
3人日

## 技術的考慮事項
- 依存関係: `UrlStore` / `OfflineNetworkQueue` / `SqliteClient` / `ObsidianClient` / `AIService` は既に注入済み。新たな外部依存は追加しない。
- テスタビリティ: Pipeline は in-process だが `UrlStore` と `OfflineNetworkQueue` が local-substitutable な seam を持つ — テストでは InMemory 実装を注入。`chrome.storage` への直接依存は `RecordingCache` 経由ですでに抽象化済み。
- 非機能要件: per-URL Mutex（`src/utils/Mutex.ts`）は Pipeline 内部に留める。`maxQueueSize: 5, timeoutMs: 60000` の設定は変更しない。
- ADR整合性: `ADR-2026-07-13 architecture-phase2-deep-dig` の Candidate #5（Pipeline storage leak）は mapper 抽出のみに縮小されたが、本PBIはその残余（step 内部化）を扱う。矛盾しない。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "PipelineStep\|ErrorStrategy\|RecordingContext" src/background/pipeline/ --include="*.ts" | head -30
grep -rn "from './steps" src/background/pipeline/ --include="*.ts"
ls -1 src/background/pipeline/steps/
```
- 既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。`RecordingPipeline` は 2026-08-17 に `RecordingLogic` を統合済みだが、steps は依然として外部モジュールとして公開されている。

### 実装手順
1. `src/background/pipeline/internal/` ディレクトリを作成し、13ステップの関数を1つずつ移動。各関数の `PipelineStep` 型への依存を除去し、純粋関数（`input → output | throw`）に変形。
2. `src/background/pipeline/RecordingPipeline.ts` 内で `ErrorStrategy` dispatch を switch 文として統合。`RecordingContext` の mutation を `execute()` 内のローカル変数に置換。
3. `resultBuilder.ts` と `mappers/BrowsingLogRecordMapper.ts` を `RecordingPipeline.ts` 内の private 関数に統合。外部 export を削除。
4. 既存の `recordingPipeline-*.test.ts` と `steps/__tests__/*.test.ts` を `RecordingPipeline.test.ts` の interface テストに移行。旧テストファイルを削除。
5. `src/background/pipeline/types.ts` から `PipelineStep` / `ErrorStrategy` / `RecordingContext` の export を削除（または `internal/types.ts` へ移動）。

### 落とし穴
- `privacyPipeline` と `extractSentences` は `RETRY` 戦略で `delay` を伴う — 内部化時に `delay` のモックがテストで必要になる。`jest.useFakeTimers` または `delay` の注入を維持すること。
- `saveObsidian` / `saveLocalMarkdown` / `saveSqlite` / `saveMetadata` は `BEST_EFFORT` で失敗を握りつぶすが、`notifyObsidianSaveSuccess` / `notifyRecordingError` の通知は握りつぶし後も行われる。内部化時に通知の順序を変えないこと。
- `previewOnly` の early return は `privacyPipeline` の直後に位置する — 内部化時にこの位置を1行でもズラすと、書き込みステップが誤って実行される。E2E テストで `previewOnly=true` 時に `saveMetadata` が呼ばれないことを厳密に検証すること。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（フラグ8通り + BEST_EFFORT + Mutex）
- [ ] テストカバレッジが基準を満たす（旧 step unit テスト13件分のカバレッジが interface テストで維持される）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（13ステップの外部 export 削除、Pipeline 内部化）
- [ ] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` の pipeline セクションを更新）
