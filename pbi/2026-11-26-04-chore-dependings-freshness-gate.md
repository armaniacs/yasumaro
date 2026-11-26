# PBI: DEPENDINGS.md リリース時鮮度ゲートと数値自動生成

## ユーザーストーリー
リリース担当者として、`docs/DEPENDINGS.md` の版番号と件数が実態と一致していることを機械的に保証したい、なぜなら手書き更新ではランタイム版や件数の乖離が繰り返し発生しているから

## ビジネス価値
リリース文書の信頼性を保ち、依存棚卸しの差戻しを減らす。測定方法として `npm run release:check` が DEPENDINGS 乖離を検出できること。

## BDD受け入れシナリオ

```gherkin
Scenario: ランタイム版が上がったらゲートが失敗する
  Given package.json のランタイム依存が更新されている
  And docs/DEPENDINGS.md が旧版のままである
  When npm run release:check:deps または dependings 検査を実行する
  Then 不一致箇所と再生成手順が表示され検査が失敗する

Scenario: 生成スクリプト実行後はゲートが通過する
  Given 依存更新後に npm run generate:dependings を実行した
  When 鮮度検査を実行する
  Then 検査が通過する

Scenario: 免責記録は上書きされない
  Given docs/DEPENDINGS.md の第6章に受容記録がある
  When npm run generate:dependings を実行する
  Then 第6章の内容が変化しない
```

## 受け入れ基準
- [ ] ランタイム表の版が `package.json` と lockfile の実効版と一致しない場合に検査が失敗する
- [ ] 開発依存件数と lockfile 総数が文書と一致しない場合に検査が失敗する
- [ ] `THIRD_PARTY_NOTICES.md` 件数と文書の記述が一致しない場合に検査が失敗する
- [ ] `package-lock.json` が文書より新しい場合に再生成を促して失敗する
- [ ] `npm run generate:dependings` 実行後に検査が通過する
- [ ] 第6章の受容記録に影響しない
- [ ] `npm run release:check` の通常経路に組み込まれる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（リリースゲートの手動実行で確認）

### 統合テスト
- 実リポジトリ状態での `check-dependings.mjs` 実行が PASS すること
- 版を意図的にずらした複製文書での FAIL 検出（手動確認）

### 単体テスト
- 文書解析（版表の抽出）のテスト
- 版比較（要求範囲と実効版の突合）のテスト
- 件数比較のテスト
- 日付鮮度の判定テスト

## 実装アプローチ
- **Outside-In**: 検査スクリプトの期待動作から決め、純粋関数を単体テストで固めてから配線する
- **Red-Green-Refactor**: TDDサイクルを各関数で適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（単独で実施可）
- テスタビリティ: 検査ロジックは I/O と分離し純粋関数として export する（`check-deps.mjs` の `classifyAuditFindings` と同じ方式）
- 非機能要件: ネットワーク呼び出しなし、lockfile のみ参照するため高速に動作すること
- 文字符号: `docs/DEPENDINGS.md` は Shift-JIS 通過対象のため、生成文に範囲外文字を使わない

## 実装者向け注記

### 現状コードの確認
着手前に実行済み。`generate-dependings` と `check-dependings` は未実装であることを確認した。
```bash
grep -rn "generate-dependings\|check-dependings\|generate:dependings" scripts/ package.json
```
既存の類似資産は `scripts/release-checks/check-deps.mjs`（二層監査と §6 照合）、`scripts/generate-third-party-notices.mjs`（件数ヘッダ）、`scripts/release-checks/check-docs.mjs`（文書存在検査）である。

### 実装手順
1. `scripts/generate-dependings.mjs` を作り、§1 と §4 の数値だけを正規表現置換で更新する
2. `scripts/release-checks/check-dependings.mjs` を作り、純粋関数を export する
3. `scripts/release-checks/index.mjs` の `CHECK_SCRIPTS` に登録する
4. `package.json` に `generate:dependings` と `check:dependings` を追加する
5. `scripts/__tests__/check-dependings.test.ts` を追加する
6. 生成スクリプトを実行して `docs/DEPENDINGS.md` の現状値を修正する
7. `CONTRIBUTING.md` と `dev-docs/DOCUMENTATION_GUIDE.md` に更新点を追記する

### 落とし穴
- 文書全体を再生成しないこと。第5章の判定文と第6章の受容記録は手書き領域であり、上書きすると監査証跡を壊す
- lockfile 件数はルート項目を除いて数える（`packages[""]` を除外）
- `THIRD_PARTY_NOTICES.md` の件数は冒頭の `automatically generated for N package(s)` から読む
- 日付比較は実時間待ちにしない。mtime の大小比較だけにする

## Definition of Done
- [ ] 全BDDシナリオが手動または自動で確認されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（本変更はゲート追加のため、誤検出時は当該検査の一時除外で出荷継続できる点を技術的考慮事項または本項に記載。誤検出時の回避手順: `RELEASE_CHECKS_NO_CACHE` とは無関係のため、`--category` 指定で当該分類を外すか、文書を再生成する）
- [ ] ドキュメント更新済み
