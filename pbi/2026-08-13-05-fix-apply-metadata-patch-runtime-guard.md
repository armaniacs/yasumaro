# PBI: applyMetadataPatchにurl/timestamp実行時ガードを追加し、将来の型キャスト経由の改ざんを防ぐ

## ユーザーストーリー
拡張機能の開発者・保守担当者として、`applyMetadataPatch`に将来外部データ由来のオブジェクトを渡すコードが追加されても、`url`/`timestamp`（エントリの識別子・作成時刻）が意図せず上書きされないでほしい、なぜならこれらのフィールドが壊れるとSaved URLエントリの識別・順序が破損し、原因追跡が困難な不具合につながるから。

## ビジネス価値
現状の呼び出し元はすべて型安全でありコンパイル時に守られているため、直ちに実害はない。しかし、TypeScriptの`Omit`型による静的制約は実行時には強制されず、将来インポート機能や外部データを扱うコードがこの共有ユーティリティ関数を再利用する際、型キャスト（`as SavedUrlEntryMetadataPatch`）で静的チェックをすり抜けるリスクが構造的に残っている。実行時ガードを追加することで、この関数を「型チェックを信頼するだけの内部専用関数」から「どんな呼び出し元からでも安全に呼べる共有ユーティリティ」に格上げする。

## 背景・根本原因（なぜなぜ分析より）
`src/utils/storage/savedUrlStore.ts` の `SavedUrlEntryMetadataPatch` 型（27行目）は `Partial<Omit<SavedUrlEntry, 'url' | 'timestamp'>>` として `url`/`timestamp` を除外しているが、この制約はコンパイル時のみ有効。`applyMetadataPatch`（376-407行目）の実装は `Object.entries(patch)` で全キーをループし、`tags`のみ特別扱いして、それ以外のキーは`(result as unknown as Record<string, unknown>)[key] = value`（403行目）という無条件キャストで書き込む。

現在の呼び出し元（`saveSavedUrlEntryMetadata`内の2箇所、`createBackgroundServices.ts`, `saveMetadataStep.ts`, `service-worker.ts`, `pendingChromeStorageQueue.ts`）は全てTypeScriptの静的型付けの範囲内で`patch`オブジェクトを組み立てており、`as`キャストや外部データのデシリアライズを経由する経路は現状存在しない。しかし、この前提は将来のコード変更（インポート機能の追加等）によって破られうる。

根本原因は、共有ユーティリティ関数でありながら「信頼できる内部コードからしか呼ばれない」という暗黙の前提のまま実装され、その設計意図がコメント（既に部分的にはある、17-26行目）はあるものの実行時の強制がないこと。加えて、`saveSavedUrlEntryMetadata`の新規作成パス（360行目）では`refreshTimestamp`オプションが一切参照されず、新規エントリは常に`timestamp ?? Date.now()`が使われる。これは実装者にとって「新規作成なのだから当然」という自明な判断だったが、呼び出し元にはドキュメント化されていない非対称な挙動である。

## 修正方針
`applyMetadataPatch`の`Object.entries`ループ内で、`key === 'url' || key === 'timestamp'`の場合は明示的にスキップする実行時ガードを追加する。加えて、なぜこのガードが必要かをコメントで明記し、`refreshTimestamp`が新規作成パスで参照されない理由もコメントで補足する。

## スコープ
- 対象: `src/utils/storage/savedUrlStore.ts` の `applyMetadataPatch` 関数、および周辺のコメント（型定義・`saveSavedUrlEntryMetadata`の新規作成パス）
- 対象外: 呼び出し元コードの変更（現状すべて型安全なため変更不要）
- 対象外: `refreshTimestamp`を新規作成パスでも尊重するような機能変更（今回はコメントでの明文化のみ。挙動変更が必要かは別途判断）

## BDD受け入れシナリオ

```gherkin
Scenario: 型キャストでurlを含むpatchを渡してもurlは上書きされない
  Given 既存のSavedUrlEntryがurl "https://example.com/a" で保存されている
  And 型キャスト経由で url フィールドを含むオブジェクトが patch として渡される（実行時のみ発生しうる状況をテストで再現）
  When applyMetadataPatch(current, patch, mergeTags) を呼び出す
  Then 結果のエントリの url は元の "https://example.com/a" のまま変化しない

Scenario: 型キャストでtimestampを含むpatchを渡してもtimestampは上書きされない
  Given 既存のSavedUrlEntryがtimestamp 1000 で保存されている
  And 型キャスト経由で timestamp フィールドを含むオブジェクトが patch として渡される
  When applyMetadataPatch(current, patch, mergeTags) を呼び出す
  Then 結果のエントリの timestamp は元の 1000 のまま変化しない（refreshTimestampによる更新は別経路であり、patch経由では変化しない）
```

## 受け入れ基準
- [ ] `applyMetadataPatch`が`url`/`timestamp`キーを実行時に無視する（`Object.entries`ループ内で明示的にスキップ）
- [ ] なぜこのガードが必要かを説明するコメントが関数に付与されている（型システムだけでは実行時に強制されないこと、将来の呼び出し元を守るためであること）
- [ ] `saveSavedUrlEntryMetadata`の新規作成パス（360行目）で`refreshTimestamp`が参照されない理由（新規エントリには「更新すべき既存タイムスタンプ」が存在しないため）をコメントで補足する
- [ ] 上記2シナリオが自動テストとして実装されパスする
- [ ] 既存の正常系（tags以外の通常フィールド更新、mergeTags有無）のテストが壊れない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（内部ユーティリティ関数でありE2E環境での検証コストに見合わないため単体テストで代替）

### 統合テスト
- `saveSavedUrlEntryMetadata`経由で、型キャストを使ってurl/timestampを含む`patch`を渡した場合でも、`withOptimisticLock`後の最終的なストレージ内容でurl/timestampが変化しないことを検証する

### 単体テスト
- `applyMetadataPatch`を直接呼び出し、`patch`に`url`キーが含まれる場合に結果へ反映されないこと
- `applyMetadataPatch`を直接呼び出し、`patch`に`timestamp`キーが含まれる場合に結果へ反映されないこと
- 既存の正常系（`tags`のマージ・置換、その他フィールドの通常更新）が壊れないこと

## 実装アプローチ
- **Outside-In**: `applyMetadataPatch`に型キャストでurl/timestampを含むpatchを渡す単体テストから書き始め、失敗を確認してから実装する
- **Red-Green-Refactor**: ガード未実装の状態でテストが失敗する（url/timestampが上書きされてしまう）ことを確認 → ガード追加でグリーンにする
- **リファクタリング**: グリーン後、コメントの説明が「なぜ」を的確に説明できているか読み直す

## 見積もり
1pt 🟢（実装は数行のガード追加のみ、テストとコメントが中心）

## 技術的考慮事項
- 依存関係: なし（既存モジュール内で完結）
- テスタビリティ: `applyMetadataPatch`は現在`export`されていない内部関数（376行目）。テストのためにexportする必要があるか、`saveSavedUrlEntryMetadata`経由の統合テストのみで済ませるかは実装時に判断する（直接テストする方がシナリオが明確になるため、テスト用にexportすることを推奨）
- 非機能要件: なし（ガード追加によるパフォーマンス影響は無視できる）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "applyMetadataPatch\|SavedUrlEntryMetadataPatch" src/utils/storage/savedUrlStore.ts
```
確認済み: `applyMetadataPatch`は`src/utils/storage/savedUrlStore.ts:376-407`に実装されている（現在`export`されていない内部関数）。`Object.entries(patch)`ループ（382行目）は`tags`（384-401行目）のみ特別扱いし、それ以外は403行目で無条件にキャストして代入している。`saveSavedUrlEntryMetadata`の新規作成パスは360行目、`refreshTimestamp`は364-366行目の更新パスでのみ参照されている。

### 実装手順
1. `applyMetadataPatch`の`for (const [key, value] of Object.entries(patch))`ループ内、`if (value === undefined) continue;`の直後に`if (key === 'url' || key === 'timestamp') continue;`を追加する
2. 追加したガードの直前または関数のJSDocコメント（371-375行目）に、なぜこのガードが必要か（型による制約は実行時に強制されないため、将来型キャスト経由で外部データが渡された場合の防御として明示的にスキップする）を1〜2行で補足する
3. `saveSavedUrlEntryMetadata`の360行目付近のコメントに、新規作成時は`refreshTimestamp`が意図的に無視される（既存タイムスタンプが存在しないため参照する対象がない）ことを補足する
4. テストのために`applyMetadataPatch`を`export`するかどうか判断する。exportする場合、既存のpublic API（`saveSavedUrlEntryMetadata`等）と同様のJSDocスタイルを保つこと

### 落とし穴
- ガード追加時、`tags`の特別扱い分岐（`if (key === 'tags')`）より前に`url`/`timestamp`のスキップを置くこと（順序は影響しないはずだが、可読性のため`undefined`チェックの直後に置くのが自然）
- テストで「型キャスト経由で渡される状況」を再現する際、TypeScriptの型チェックを迂回する必要がある（`patch as unknown as SavedUrlEntryMetadataPatch`のような二重キャスト、またはテストファイル内で`// @ts-expect-error`を使う等）。これは意図的に型システムをすり抜けるテストであることをコメントで明記すること
- `applyMetadataPatch`をexportする場合、既存の呼び出し元（`saveSavedUrlEntryMetadata`内部）のimportパスに影響がないか確認する（同一ファイル内のため実質影響なしのはず）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック+テスト）がグリーン
- [ ] コードレビュー完了
- [ ] リファクタリング完了（コメントの妥当性確認済み）
- [ ] `pbi/00-INDEX.md`に本PBIの行を追加
