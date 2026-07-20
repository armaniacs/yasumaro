# PBI: wa-sqlite依存をcaretレンジから完全固定バージョンへ変更

## ユーザーストーリー
開発チームとして、全ユーザーデータの永続化を担う `wa-sqlite` パッケージのバージョンを完全固定したい、なぜなら現状は `^1.0.0`（caretレンジ）指定で、他のランタイム依存が exact pinning なのに対して唯一この依存だけが想定外のマイナーアップデートを許容してしまっているから

## ビジネス価値
- SQLite WASMのマイナーアップデートによる意図しないデータ互換性破壊を防止
- サプライチェーンの一貫性向上（他ランタイム依存との整合性）

## 実装者向け注記（フェーズ0の既実装確認結果）

grep で確認済み:
- `package.json:79` — `"wa-sqlite": "^1.0.0"`
- side-effects.md M29判定: 「package-lock.jsonが既に事実上固定。npm ci運用なら実害小」（副作用軽微、対処自体は安全）
- 対処案（親レポートより）: `"wa-sqlite": "1.0.0"` に変更し、明示的なアップグレードのみ許容

```bash
# 実装前の再確認コマンド
grep -n "\"wa-sqlite\"" package.json
npm ls wa-sqlite
```

**関連PBI**: M13（wa-sqliteの本番依存除外検討）は別途「🔴副作用あり」指摘として扱われており、本PBIのスコープ外。本PBIはバージョン固定のみを対象とする。

## BDD受け入れシナリオ

```gherkin
Scenario: wa-sqliteが完全固定バージョンになる
  Given package.jsonのwa-sqlite依存が"^1.0.0"である
  When "1.0.0"（caret削除）に変更する
  Then npm installでwa-sqliteは常に1.0.0のみがインストールされ、マイナー/パッチアップデートが自動適用されない

Scenario: 既存のビルド・テストに影響がない
  Given wa-sqliteのバージョン指定を完全固定に変更した状態
  When npm run build および npm test を実行する
  Then 既存のwa-sqlite関連機能（旧DBバックアップ、OPFS旧DB読み取り）が変更前と同じバージョンで動作する
```

## 受け入れ基準
- [ ] `package.json:79` の `"wa-sqlite": "^1.0.0"` を `"wa-sqlite": "1.0.0"` に変更
- [ ] `npm install` 後、`package-lock.json` に変更が生じないか、生じても意図した範囲内であることを確認
- [ ] `npm run build` / `npm test` が成功

## テスト戦略（t_wadaスタイル）

### E2E / 統合 / 単体テスト
- 該当なし（バージョン指定の変更のみ、ランタイム挙動は不変）
- 検証は `npm ls wa-sqlite` でインストールされたバージョンの確認と、既存のwa-sqlite関連テスト（旧DB移行系）がそのままパスすることの確認で代替する

## 実装アプローチ
- `package.json` 1行の変更のため通常のTDDは適用しない。変更後にビルド・既存テストスイートの実行で確認する

## 見積もり
1pt（15分程度）

## 技術的考慮事項
- 依存関係: `npm install` の実行が必要
- テスタビリティ: `npm ls wa-sqlite` で実際のバージョンを確認可能
- 非機能要件: サプライチェーンセキュリティ、データ互換性保護

## 落とし穴
- side-effects.md M29の判定通り `package-lock.json` は既に事実上固定されているため、本変更による実質的な挙動変化はほぼないが、`package.json` 上の意図の明確化として価値がある。過度な検証コストをかけず、シンプルに変更してビルド確認のみで十分

## Definition of Done
- [ ] `package.json` の変更が適用されている
- [ ] `npm run build` / `npm test` が成功
- [ ] コードレビュー完了
