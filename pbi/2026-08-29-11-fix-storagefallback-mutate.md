# PBI: storageFallback ミューテータ統一 — mutate(fn) ヘルパー（VULN-022, CWE-362）

## ユーザーストーリー
開発者として、OPFS が使えない環境のフォールバック SQLite エンジンで、全ミューテータが同一のロック規律で動くようにしたい、なぜなら 8 ミューテータのうち 6 個がロックなしで load→mutate→save し、purge が同時 toggleStar の全 blob 書き込みで取り消されるから

## ビジネス価値
- Medium 脆弱性（VULN-022）の解消: update/hardDelete/toggleStar/clearAll/purgeOldRecords/purgeContent のロックなし RMW（実証: purge が toggleStar で取り消される）
- フォールバック環境でのデータ消失・復活（削除レコードの resurrection）を構造的に封鎖
- 測定方法: 8/8 ミューテータが `mutate(fn)` を経由すること、並行変異テストで全変異が保持されること

## 優先度
- 順位: 11 / 14
- RICEスコア: 475（Reach=100 / Impact=0.5 / Confidence=95% / Effort=0.1人月）
  - Reach 100: フォールバックモード（OPFS 不利用環境）限定
  - Impact 0.5: Medium。データ消失・復活という完全性問題
  - Confidence 95%: `mutate(fn)` ヘルパー 1 本で 8 メソッドを統一。既存 insert の lock 実装が正解パターン
  - Effort 0.1: ヘルパー抽出＋ミューテータ置換＋レーステスト
- 根拠: 第二級実装に見えるが、Medium 脆弱性の本体。ヘルパー化により将来のミューテータ追加も安全になる

## BDD受け入れシナリオ

```gherkin
Scenario: purge と同時 toggleStar で purge が取り消されない
  Given フォールバックストアにレコード群がある
  When purgeOldRecords と toggleStar が並行実行される
  Then mutate(fn) の直列化により、purge の結果が保持される

Scenario: update と hardDelete が重なっても矛盾しない
  Given 同一レコードに対する update と hardDelete が並行する
  When 両ミューテータが完了する
  Then 最終状態はどちらか一意の結果になり、中途半端な blob 状態にならない

Scenario: insert 系は現行どおり動作する（回帰防止）
  Given 正常な insert/insertBatch が与えられる
  When 実行する
  Then 既存テストの期待結果と一致（重複チェック後 ID 確保の挙動維持）

Scenario: lock 待ちのタイムアウトは既存契約どおり
  Given mutex が長時間保持される
  When ミューテータが待つ
  Then 既存 Mutex の timeout 契約に従い reject される（無限待機しない）
```

## 受け入れ基準
- [ ] `src/offscreen/storageFallback.ts` に `private async mutate(fn: (data) => data)` が新設され、`this.mutex` 取得→load→fn 適用→save を行う
- [ ] update / hardDelete / toggleStar / clearAll / purgeOldRecords / purgeContent（6 メソッド）が mutate 経由に置換されている
- [ ] insert / insertBatch の手書き lock も mutate 経由に統一され、重複チェック→ID 確保の現行順序が維持される
- [ ] 並行変異テスト（purge×toggleStar、update×hardDelete）が追加され、全変異が保持される
- [ ] 既存 storageFallback テストが全てグリーン
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: `poc/VULN-022_storage_fallback_unlocked_mutators.md` のシナリオが失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（フォールバックエンジンはオフラインで完全検証可能）

### 統合テスト
- `FallbackStorage.query/mutate` 経由の並行操作（削除と star 更新の統合）

### 単体テスト
- 新規: `src/offscreen/__tests__/storageFallbackMutate.test.ts`
  - ビジネスロジック: 各ミューテータの結果整合
  - 境界値: 空ストア、単一レコード、バッチ境界
  - 例外: fn throw 時のロック解放とデータ不変性

## 実装アプローチ
- **Outside-In**: 並行変異テスト（RED: 現行は purge が失われる）→ mutate(fn) 実装で GREEN → insert 系の統一
- **Red-Green-Refactor**: insert の「重複チェック後に ID 確保」順序（PBI 2026-08-27-06 で確立）を mutate 内で維持

## 見積もり
1pt（要チームでの見積もり — ヘルパー 1 本＋8 メソッド置換＋テスト）

## 技術的考慮事項
- 依存関係: なし（Wave 2）。OPFS 正常経路（opfsWorker）には触れない
- テスタビリティ: InMemory ストレージで決定的インターリーブが可能（PoC の Python シナリオを移植）
- 非機能要件: フォールバックモードの性能は現行同等（直列化は現行 insert と同じ単一 mutex）
- 注意: `loadData` のキャッシュ挙動（ある場合）があれば mutate 内で一貫させる

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '60,95p' src/offscreen/storageFallback.ts
sed -n '275,300p' src/offscreen/storageFallback.ts
rg -n "loadData|saveData" src/offscreen/storageFallback.ts
```

### 実装手順
1. mutate(fn) ヘルパーを新設（mutex acquire→loadData→fn→saveData→release、try/finally）
2. 6 ミューテータを置換
3. insert/insertBatch を mutate 経由に統一
4. 並行変異テスト追加、`npm run validate`

### 落とし穴
- fn 内で再帰的に mutate を呼ぶとデッドロックする — fn は純粋変換に限定する契約コメントを付けること
- saveData 失敗時にロックだけ解放してデータが半端にならないこと（load し直しの原状回復または例外伝播）
- insertBatch のバッチ内重複フィルタ順序を崩さないこと（既存テスト 2026-08-27-06 を回帰ゲートに）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-022 が解消されること
