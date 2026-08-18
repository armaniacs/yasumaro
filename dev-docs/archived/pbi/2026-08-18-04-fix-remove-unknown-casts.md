# PBI: `as unknown as` 二段キャスト31件を棚卸し、型の穴を塞ぐ

## ユーザーストーリー
開発者として、本番コードに散在する `as unknown as` 二段キャストが解消（型ガードへの置換、または不可避な箇所への明示理由の付与）されている状態にしたい。なぜなら、二段キャストは `any` と同等に型チェックを無効化する「型の穴」であり、特に `staticPanelAdapter.ts:35` の `undefined as unknown as Settings` は設計レベルの問題を隠蔽しているから。

## 優先度
- 順位: 04 / 06
- RICEスコア: 24.5（Reach=35 / Impact=1.5 / Confidence=70% / Effort=1.5人週）
- 根拠: 特定31箇所への一回限りの是正（Reachは中程度）だが、実質 `any` と同等の穴を塞ぐ防御的価値が高い。依存関係なし。ルール導入（PBI 02/03）より優先度は低いが、放置すると「ルールは通るが実質型安全でない」状態が残るため、基盤整備の後に着手する。

## ビジネス価値
- 型チェックをすり抜ける二段キャストを減らし、実行時型エラーの混入余地を狭める
- `Record<string, unknown>` への強引なキャストを型ガードに置換し、境界での型安全性を回復する
- 隠蔽された設計問題（`undefined as unknown as Settings`）を顕在化させる

## 背景（2026-08-18 調査済み）
本番コード（`__tests__` 除外）に `as unknown as` が31件存在する。主な分布:

- `src/background/sqliteClient.ts`（8件）— `Record<string, unknown>` へのキャスト
- `src/offscreen/opfsWorker.ts` / `src/offscreen/opfsWorker/backupHandlers.ts` / `src/offscreen/opfsMigrationV2Reader.ts` / `src/offscreen/sqliteEngineContext/migrationBackup.ts` — OPFS / WASM / `DedicatedWorkerGlobalScope` 境界
- `src/dashboard/settings/ublockImport/sourceManager.ts`（3件）— `mergedRules as unknown as UblockRules`
- `src/dashboard/panels/staticForm/staticPanelAdapter.ts:35` — `(undefined as unknown as Settings)` ※設計見直し対象
- その他: `resultBuilder.ts:39` / `RecordingPipeline.ts:421` / `content/extractor.ts` / `customPromptUtils.ts:84` 等

分類の方針:
1. 型ガード・narrowing で置換可能なもの（`Record<string, unknown>` へのキャスト多数）
2. プラットフォーム境界（WASM / OPFS / Worker global scope）で不可避なもの → 理由を明記して最小限に残す
3. 設計問題（`staticPanelAdapter.ts:35`）→ 型そのものを見直す

## BDD受け入れシナリオ

Scenario: 設定値の undefined が型ガードで安全に扱われる
  Given `staticPanelAdapter.ts` の `undefined as unknown as Settings` が型ガードまたはデフォルト値に置換される
  When 設定が未定義の状態でアダプタが呼び出される
  Then 型エラーまたは明示的なデフォルト値で処理され、黙って `undefined` が流れない

Scenario: ベンダー・プラットフォーム境界のキャストだけが残る
  Given 全31件を「置換可能 / 不可避」に棚卸しする
  When 型ガードで絞り込める箇所を判定する
  Then 絞り込み可能な箇所はキャストが除去され、WASM/OPFS 等の不可避な境界だけが明示理由付きで残る

Scenario: ストレージ境界のキャストが型ガードで置換される
  Given `sqliteClient.ts` 等の `Record<string, unknown>` キャストを棚卸しする
  When 取得データを具体型へ変換する
  Then 変換箇所に型ガード（または zod 等の実行時バリデーション）が入り、不正データが具体型として素通りしない

## 受け入れ基準
- [ ] 本番コードの `as unknown as` 31件が「型ガード置換」または「不可避 + 理由コメント付き」のいずれかに分類される
- [ ] `staticPanelAdapter.ts:35` の `undefined as unknown as Settings` が設計レベルで解消される
- [ ] `sourceManager.ts` の `mergedRules as unknown as UblockRules` が型安全な変換（型ガード/バリデーション）に置換される
- [ ] 置換後も `npm run type-check` と既存テストがパスする
- [ ] 残置するキャストそれぞれに WHY コメントが付く

## テスト戦略
- 単体: `staticPanelAdapter` の undefined 入力に対する境界テスト（デフォルト値 or エラーのどちらを選ぶかの仕様を固定）
- 単体: `sourceManager` の uBlock ルール変換が不正データを弾く（型ガードの否定パス）
- 統合: sqlite / OPFS 境界でデータ往復後に具体型が保たれること
- 回帰: 置換前後で挙動が変わらないこと（既存テストのパス維持）

## 実装アプローチ
1. 31件を列挙し「置換可能 / 不可避 / 設計問題」の3分類に仕分ける
2. 置換可能な `Record<string, unknown>` キャストを型ガード・`in` 演算子・zod 等で置換
3. WASM/OPFS/Worker 境界は不可避と判定したものだけ残し、各所に WHY コメントを付与
4. `staticPanelAdapter.ts` と `sourceManager.ts` は型設計から見直す

## 見積もり
2pt（🟡中）

## 技術的考慮事項
- WASM（sql.js）や OPFS、`DedicatedWorkerGlobalScope` は型定義が不完全なため、一部キャストは構造的に不可避。ここを無理に消すより「理由を明記して最小化」が現実的
- `undefined as unknown as Settings` は「設定未ロード時に型を偽装する」アンチパターン。`Settings | undefined` を明示して呼び出し側でハンドリングするのが正道

## Definition of Done
- [ ] 置換可能な二段キャストが型ガードに置換済み
- [ ] 残置キャスト全てに WHY コメントが付く
- [ ] `staticPanelAdapter.ts:35` と `sourceManager.ts` の型が見直し済み
- [ ] `npm run type-check` 成功・既存テストパス
- [ ] コードレビュー完了
