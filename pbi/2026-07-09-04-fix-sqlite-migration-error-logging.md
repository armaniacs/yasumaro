# PBI: ALTER TABLE マイグレーションのエラー握り潰しを修正

## ユーザーストーリー
保守開発者として、SQLite スキーマの `ALTER TABLE` マイグレーションで「カラム重複」以外のエラー（ディスクフル・DB 破損・ファイルロック）が発生した場合にそれを検知したい。なぜなら現状は `catch` がエラーの種類を一切見ずに全て無視するため、本当の異常が隠蔽されデータ破損に気づけないから。

## ビジネス価値
- 本番環境でのサイレントなデータ破損を防ぎ、障害の早期発見につながる
- マイグレーションの信頼性と保守性を向上する

## 既実装確認（Phase 0）
- `grep -rn "ALTER TABLE" src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts` → 両ファイルで `ADD COLUMN` をループ実行し、空 `catch {}` で全エラーを無視していることを確認
- **実装状態**: Checking Team Wave 3（2026-07-09）で既に修正済み・テスト追加済み（未コミット）。本 PBI は回帰仕様として記録

## BDD受け入れシナリオ

```gherkin
Scenario: 重複カラム以外のエラーは警告として記録される
  Given マイグレーション中にディスクフルエラー（SQLITE_ERROR 1 以外）が発生する
  When ALTER TABLE ループがそのエラーを捕捉する
  Then エラーが console.warn で記録される
  And マイグレーションは継続または明示的に失敗する

Scenario: 重複カラムエラーは警告されない
  Given カラムが既に存在する（duplicate column name）
  When ALTER TABLE ループがそのエラーを捕捉する
  Then 何も記録されず（期待される正常系）
```

## 受け入れ基準
- [ ] `sqlite.ts` / `opfsWorker.ts` のマイグレーション `catch` が「duplicate column」系エラーのみを無視し、それ以外は `console.warn` で出力する
- [ ] 回帰テスト `sqlite-migration-errors.test.ts` がパスする（重複: 通知なし／非重複: 通知あり）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/offscreen/__tests__/sqlite-migration-errors.test.ts`（既存）:
  - 非重複カラムエラー → `console.warn` が呼ばれる
  - 重複カラムエラー → `console.warn` が呼ばれない

### 統合テスト
- OPFS Worker パス（`opfsWorker.ts`）でも同様の警告動作

## 見積もり
1 pt（既実装、回帰テストのみ確認）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `console.warn` を `vi.spyOn(console, 'warn')` で検証

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "ALTER TABLE" src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts
# → catch {} で全エラー無視（修正前）
```
修正済み箇所: `sqlite.ts:310-316`、`opfsWorker.ts:221-228`（重複カラム以外を warn）。
テスト: `src/offscreen/__tests__/sqlite-migration-errors.test.ts`（2 tests）。

### 実装手順
- すでに Wave 3 で適用済み。未コミットのため、本 PBI 完了時は該当差分をコミット対象に含めること。

### 落とし穴
- エラー判定はメッセージ文字列（`duplicate column name`）での判別。将来的な SQLite メッセージ変更に備え、判定ロジックを一元化しておくとよい

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載（セキュリティ・堅牢性改善）
