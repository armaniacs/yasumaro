# PBI: content/extractor.tsのグローバル変数をPageStateクラスにカプセル化する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（Content Scriptのコア処理の内部構造変更。全webページでの動作に影響するため広範な回帰テストが必須）

**実装計画**: `dev-docs/plans/2026-07-27-pbi34-extractor-pagestate-encapsulation-plan.md`（2026-07-27作成。実際のグローバル変数は12個〔PBI記載の8個から再カウント〕と判明、2段階移行のTask→Step分解済み）

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
- [x] グローバル変数がPageStateクラスにカプセル化されている
- [x] 既存の自動テストが全てパスする
- [ ] 実ブラウザでの複数サイトでの動作確認が完了している（2026-07-27: 本環境では実ブラウザ確認が実行できないため未実施）
- [ ] `pbi/00-INDEX.md` が更新されている（部分実装として記録予定）

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Maintainability Guardian指摘）
- 対象コード: `src/content/extractor.ts:46-178`

## フェーズ0再調査（2026-07-27）

モジュールレベル変数は記載通り現存する（`minVisitDuration`, `minScrollDepth`, `startTime`,
`maxScrollPercentage`, `isValidVisitReported`, `checkIntervalId`, `cleansingConfig`,
`lastCleansedReason`, `lastByteStats`）。

**新規発見**: このうち`lastCleansedReason`と`lastByteStats`（156, 163行）は**`export let`で
モジュール外に公開されている**。他モジュールからの参照（プロダクションコード）は見当たらないが、
`extractor-core.test.ts`, `extractor-extra.test.ts`, `extractor-r2.test.ts`, `extractor.test.ts`の
**4つのテストファイルがこれらのexport変数に直接依存**していることを確認した。これはPBIの受け入れ
基準（Scenario 4「テスト時の状態リセットが容易になる」）が指摘する問題の実例であり、`PageState`
クラスへの移行時にこれら4テストファイルの書き換えが必須になる。

**見積もり再評価**: 3pt以上のまま据え置きで妥当。ただし影響テストファイルが4件と判明したことで、
移行時の作業範囲（テスト側の書き換え）がやや具体化した。

## 実装進捗メモ（2026-07-27）

- `src/content/pageState.ts` を新設し、12個のモジュールレベル変数を `PageState` クラスのプロパティに移行済み。
- `extractor.ts` はモジュールレベルで `PageState` シングルトンを保持。テスト用に `getPageStateForTesting()` をエクスポート。
- 4テストファイルを `getPageStateForTesting()` 経由のアクセスに書き換え済み。
- `npm run type-check` / `npm test` / `npm run build` すべて成功。
- **未実施**: 実ブラウザでの複数サイト動作確認。本実装環境ではChrome拡張機能の実ブラウザ検証が実行できないため、手動テストは後日行う。確認項目は以下:
  1. ニュースサイト・技術ブログ・SPAのいずれか3種類で、最小訪問時間・スクロール深度到達時に自動記録がトリガーされること
  2. ポップアップからの手動記録（GET_CONTENT）でクレンジング統計が正しく返ること
  3. リファクタリング前後で抽出結果が変わらないこと
