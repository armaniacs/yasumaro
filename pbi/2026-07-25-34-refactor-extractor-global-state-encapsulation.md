# PBI: content/extractor.tsのグローバル変数をPageStateクラスにカプセル化する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（Content Scriptのコア処理の内部構造変更。全webページでの動作に影響するため広範な回帰テストが必須）

---

## 背景

Checking Team レビュー（2026-07-25）の Maintainability Guardian からの指摘。`src/content/extractor.ts:46-178` に `cleansingConfig`、`lastCleansedReason`、`lastByteStats` など8つのグローバル/モジュールレベル変数が存在する。Content Scriptはページ遷移のたびに再読み込みされる性質上、状態管理の意図が読み取りにくく、テスト時にモック化・状態リセットが困難で、信頼性を損なうリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "^let \|^const.*=.*{}\|^var " src/content/extractor.ts | head -20
grep -n "cleansingConfig\|lastCleansedReason\|lastByteStats" src/content/extractor.ts
```

**このPBIは副作用が大きいため、一度に全変数を移行せず、段階的に進める。** まず8つのグローバル変数を洗い出し、相互依存関係を図示してから、依存の少ない変数から `PageState` クラスへ移行する。全webページでの動作確認（実ブラウザでのcontent script動作）が必須。

## 受け入れ基準（BDD）

```gherkin
Scenario: グローバル変数がPageStateクラスにカプセル化される
  Given extractor.ts に8つのモジュールレベル変数が存在する
  When PageState クラスを導入し、これらの変数をインスタンスプロパティに移行する
  Then モジュールレベルの `let`/`var` 宣言が削減される

Scenario: 既存のコンテンツ抽出機能が回帰しない
  Given リファクタリング後の extractor.ts
  When 既存のcontent script関連テスト（jsdom環境）を実行する
  Then 全てパスする

Scenario: 実際のWebページでコンテンツ抽出が正常動作する
  Given 実Chromeブラウザで拡張機能を読み込む
  When 複数の異なる構造のWebページでコンテンツ抽出を実行する
  Then リファクタリング前と同じ抽出結果が得られる

Scenario: テスト時の状態リセットが容易になる
  Given PageState クラスのインスタンスを使ったテスト
  When 複数のテストケースを連続実行する
  Then 各テストで新しい PageState インスタンスを生成するだけで状態がリセットされる（モジュールレベル変数のクリーンアップが不要になる）
```

## 受け入れ基準
- [ ] `extractor.ts` の8つのグローバル変数（`cleansingConfig`, `lastCleansedReason`, `lastByteStats` 等）を洗い出し、依存関係を図示する
- [ ] `PageState` クラスを新設し、これらの変数をインスタンスプロパティとして移行する
- [ ] 既存の関数群を `PageState` のメソッドまたは `PageState` を引数に取る形にリファクタリングする
- [ ] 既存のcontent script関連テスト（jsdom）が全てパスする
- [ ] 実Chromeブラウザで複数の実サイト（ニュースサイト、ブログ、SPA等、構造の異なる最低3種類）でのコンテンツ抽出結果が変わらないことを手動確認する

## テスト戦略（t_wadaスタイル）

### 統合テスト
- 実ブラウザでの動作確認（AGENTS.mdの「Manual Testing Required」に従う）: 複数の異なる構造のWebページでの抽出結果比較

### 単体テスト
- `PageState` クラスの各メソッドが正しく状態を管理することを確認
- 既存の `extractor.test.ts` の全ケースが移行後も同じ結果を返すことを確認（回帰テスト）

## 実装アプローチ

1. 8つのグローバル変数と、それらを読み書きする関数群を洗い出す
2. `PageState` クラスを設計（コンストラクタで初期化、各変数に対応するgetter/setterまたはpublicプロパティ）
3. 依存の少ない変数から段階的に移行（一度に全部変えない）
4. 各段階で既存テストを実行し回帰がないことを確認
5. 最終段階で実ブラウザでの動作確認を行う

## 見積もり

3pt以上（段階的移行のため、複数PRに分割することも検討）

## 技術的考慮事項
- 依存関係: `src/content/loader.ts`（extractor.tsの呼び出し元）
- テスタビリティ: jsdomでの単体テストに加え、実ブラウザでの手動確認が必須（[AGENTS.md](../AGENTS.md) Testing Limitations参照）
- 非機能要件: Content Script injection速度への影響がないこと

## Definition of Done
- [ ] グローバル変数がPageStateクラスにカプセル化されている
- [ ] 既存の自動テストが全てパスする
- [ ] 実ブラウザでの複数サイトでの動作確認が完了している
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Maintainability Guardian指摘）
- 対象コード: `src/content/extractor.ts:46-178`
