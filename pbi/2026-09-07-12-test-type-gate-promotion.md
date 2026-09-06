# PBI: テスト型債務返済 5/5 — ゲート昇格（type-check:test を素 tsc に戻す）

## ユーザーストーリー

yasumaroの開発者として、08〜11 の返済完了後にベースラッパーを撤去し、`type-check:test` を素の `tsc` ゲートに戻してほしい。なぜなら、ラッパーと baseline.json は既存債務を追跡する暫定装置（PBI 2026-09-07-04）であり、債務が 0 の後も残し続けると毎回「改善ファイルの更新案内」が出るだけで、型ゲートが名実ともに素の状態に戻らないから。

## 背景

- PBI 2026-09-07-04 で導入: `scripts/check-type-baseline.mjs`（ファイル別ベースラインゲート）+ `testDir/type-check-baseline.json`（インベントリ）
- 08〜11 の返済完了後、baseline は 0 件（空オブジェクト）になる
- 本PBIでラッパーを撤去し、`type-check:test` を `tsc --project testDir/tsconfig.json --noEmit` に直接戻す

## BDD受け入れシナリオ

```gherkin
Scenario: 素の tsc ゲートが常時通る
  Given 全 baseline エントリが返済済み（baseline.json が空）である
  When npm run type-check:test:raw を実行する
  Then exit code 0 で終了する

Scenario: ラッパーが撤去される
  Given 素の tsc が常に exit 0 である
  When package.json を確認する
  Then type-check:test は tsc --project testDir/tsconfig.json --noEmit を直接実行する
  And testDir/type-check-baseline.json / scripts/check-type-baseline.mjs /
      type-check:test:raw / type-check:test:baseline は削除されている

Scenario: 型ゲートが壊れたコードを検出する
  Given 任意のテストファイルに型エラーを1行追加する
  When npm run type-check:test を実行する
  Then exit code 非0 で終了する
```

## 受け入れ基準

- [ ] **前提確認**: `testDir/type-check-baseline.json` が空（`files: {}`・total 0）であること。空でない場合は 08〜11 の未返済分を先に消化する（本PBIで返済しない）
- [ ] `package.json`: `type-check:test` を素の tsc に戻し、`type-check:test:raw` / `type-check:test:baseline` を削除
- [ ] `testDir/type-check-baseline.json` / `scripts/check-type-baseline.mjs` を削除
- [ ] ネガティブテスト: テストファイルに型エラーを1行追加 → exit 非0 を1度確認して取り消す
- [ ] `npm run validate` / `npm run test:type-safe` が exit 0
- [ ] CHANGELOG にゲート昇格を記録（次回リリース時）

## テスト戦略

### 単体テスト
- なし（ゲートの exit code が検証）

### E2Eテスト
- なし

## 実装アプローチ

1. 前提確認: `cat testDir/type-check-baseline.json` が空であること（非空なら 08〜11 を先に）
2. `package.json` の scripts 更新（type-check:test = `tsc --project testDir/tsconfig.json --noEmit`）
3. baseline.json とラッパースクリプトを削除
4. ネガティブテスト（1 行追加 → 非0 → 取り消し）
5. `validate` / `test:type-safe` 実行

## 見積もり

1pt 未満（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-08〜11 の全完了が強い前提（baseline 空が条件）。08〜11 は並行可だが 12 は最後
- **テスタビリティ**: exit code で判定
- **非機能要件**: なし（scripts と package.json のみ）

## 実装者向け注記

### 現状コードの確認
```bash
python3 -c "import json; b=json.load(open('testDir/type-check-baseline.json')); print(b['total'], len(b['files']))"
```

### 落とし穴
- **削除対象の取り違え**: 削除するのはラッパー（check-type-baseline.mjs）と baseline.json のみ。`tsconfig.json` 修正（2026-09-07-04 で実施済み）は維持する
- **CI の None 検知**: `test:type-safe` が CI で走るようになった場合、素 tsc がローカルより厳しい環境差（型の解決差）で落ちることがある — その場合は環境差の是正が本筋（ラッパーを戻さない）
- **CHANGELOG**: ゲート昇格はユーザー向け機能ではないが「開発者向け / 非機能」節に記録する

## Definition of Done

- [ ] ラッパー・baseline 削除、`type-check:test` = 素 tsc
- [ ] ネガティブテスト実施済み
- [ ] `npm run validate` / `test:type-safe` exit 0
- [ ] コードレビュー完了
