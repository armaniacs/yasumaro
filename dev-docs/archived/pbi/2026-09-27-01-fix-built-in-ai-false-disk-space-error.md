# PBI: 端末内AIの「ディスク容量不足」誤案内の修正（Prompt API 非対応ブラウザ）

- 発生源: [issue #161](https://github.com/armaniacs/yasumaro/issues/161)（Linear DEV-93、報告バージョン 6.9.17）
- 種別: fix（既存機能の誤判定修正。既実装確認は 2026-09-27 実施済み — 下記「実装者向け注記」参照）

## ユーザーストーリー

Firefox など端末内AI（Prompt API）に対応していないブラウザで拡張機能を使うユーザーとして、端末内AIモデルを無効化したときに表示される理由の案内が実際の状況と一致してほしい。なぜなら、実際には100GB以上の空きがあるのに「空き容量は10 GBです」と表示され、トラブルシューティングの方向を誤らせるから。

## ビジネス価値

- 誤案内は実害のあるユーザー報告（issue #161）を 1 件生んでおり、修正しないと同種の報告が続く
- 測定方法: 修正版リリース後に同種（ディスク容量の誤表示）のバグ報告が 0 件であること

## 原因の仮説（実装時に再検証）

- 報告者の UA は Firefox 156。Prompt API は Chromium 系専属で、Firefox には `globalThis.LanguageModel` が存在しない
- `getBuiltInAIDiskSpace()`（`src/utils/browserSupport.ts`）は API の存在有無を確認せず `navigator.storage.estimate()` を読む。Firefox ではオリジン別のストレージ割当クォータに上限（観測上 10 GiB）が効くため、`quota - usage` が実際のディスク空き容量と無関係に約 10 GB を返す
- その結果 `sufficient: false` となり、ディスク容量不足の案内が最優先で表示される。正しい理由は「このブラウザは端末内AIに非対応」である
- 表示経路は 3 つあり、すべて同じ関数を共有する: 要約エラー（`buildUnavailableMessage()`、要約フォールバックチェーンで built-in-ai が試行されたとき）・AI 接続テスト・診断パネルの availability チェック

## BDD受け入れシナリオ

```gherkin
Scenario: 端末内AIに対応していないブラウザでは容量の数値を案内しない
  Given Firefox のように端末内AI（Prompt API）を持たないブラウザで拡張機能を使っている
  When 端末内AIモデルの利用可否が unavailable と判定される
  Then 案内にディスク容量の数値（必要容量・空き容量）は表示されない
  And 「お使いのブラウザは端末内AIに対応していない」旨の既存案内が表示される

Scenario: 端末内AI対応ブラウザで実際に空き容量が不足している場合は容量案内を維持する
  Given Chrome のように端末内AI（Prompt API）を持つブラウザで拡張機能を使っている
  And 推定される空き容量が必要量（22 GiB）未満である
  When 端末内AIモデルの利用可否が unavailable と判定される
  Then 必要容量と推定空き容量を示した案内が表示される

Scenario: 空き容量がちょうど必要量と同額の場合は容量不足と案内しない
  Given Chrome のように端末内AI（Prompt API）を持つブラウザで拡張機能を使っている
  And 推定される空き容量が必要量（22 GiB）と同額である
  When 端末内AIモデルの利用可否が unavailable と判定される
  Then 容量不足の案内は表示されない
  And 従来のフラグ有効化案内にフォールバックする
```

## 受け入れ基準

- [ ] Prompt API が存在しない環境では、`getBuiltInAIDiskSpace()` が null を返し、3 つの表示経路（要約エラー・AI 接続テスト・診断パネル）のどこでもディスク容量の数値を含むメッセージが表示されない
- [ ] Prompt API が存在する Chromium 環境での容量不足案内は現行どおり維持される（CHANGELOG v6.9.x の「フラグ再確認の誘導を容量案内に置き換えた」修正の回帰にしない）
- [ ] Prompt API 非対応時は既存キーにフォールバックする（診断パネル: `diagBuiltInAiUnsupportedBrowser`、バックグラウンド: `builtInAiUnavailableGeneric`）。新規 i18n キーは原則追加しない。追加が必要と判断した場合は ja/en 両方を用意する
- [ ] `npm run validate` が通る
- [ ] 既存テストの更新で新挙動が固定されている（browserSupport / builtInAIClient / builtInAiDiagnosticsService）
- [ ] CHANGELOG.md に修正を追記している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存 `testDir/e2e/dashboard-built-in-ai.spec.ts` が Chromium で green 維持（回帰確認のみ）
- Firefox 相当の分岐は Playwright Chromium では実走できないため、単体と統合テストで担保する

### 統合テスト
- `src/dashboard/__tests__/builtInAiDiagnosticsService.test.ts`: `LanguageModel` が存在しない場合、`checkBuiltInAiAvailability()` は status `unavailable` / diskSpace null / guidance null（unknown ブラウザ）を返す
- `src/background/__tests__/builtInAIClient.test.ts`: `LanguageModel` が存在しない場合、`summarize()` のエラーメッセージに容量数値が含まれない（generic フォールバック）

### 単体テスト
- `src/utils/__tests__/browserSupport.test.ts`（既存 `getBuiltInAIDiskSpace` 6 テストの前提修正＋追加）
  - `LanguageModel` なし → null（今回の修正対象）
  - `LanguageModel` あり + estimate 10 GiB → insufficient（既存の意味を維持）
  - 境界値: `quota - usage` が 22 GiB ちょうど → sufficient / 22 GiB 未満（1 byte 差）→ insufficient
  - usage 欠落は 0 扱い・負値クランプ（既存テストの維持）

## 実装アプローチ

- **Outside-In**: 統合テスト（service / client の公開挙動）を赤で書く → `browserSupport.ts` のゲート実装で緑 → 単体の境界値を追加 → リファクタリング
- **Red-Green-Refactor** を各レイヤーで適用する

## 見積もり

0.5 SP（要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし（AMO 審査中の pbi/2026-09-15-01 と競合しない。Firefox ユーザーの誤案内を減らす方向で一致する）
- テスタビリティ: `globalThis.LanguageModel` は beforeEach で退避し afterEach で復元する。`navigator.storage.estimate` のモック手法は既存 browserSupport テストを踏襲する
- 非機能要件: ストレージ・通信・権限に非接触（表示判定のみの変更）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 判定ロジックと表示経路
grep -rn "getBuiltInAIDiskSpace" src/
# 誤案内のメッセージキー（ja/en 両方に同名キーがある）
grep -n "builtInAiUnavailableDiskSpace\|diagBuiltInAiDiskSpaceGuidance" public/_locales/ja/messages.json
```

既実装確認（2026-09-27 実施済み）: ディスク容量推定と案内表示は既に実装済みで、本 PBI はその誤判定を修正する。修正対象は 1 関数で、3 つの表示経路が同時に直る。

- 判定: `src/utils/browserSupport.ts` `getBuiltInAIDiskSpace()` — `navigator.storage.estimate()` の `quota - usage` を空き容量の代理として使用（定数 22 GiB と比較）
- 表示: `src/background/builtInAIClient.ts` `buildUnavailableMessage()` / `src/dashboard/builtInAiDiagnosticsService.ts` `explainUnavailable()` / `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` `renderBuiltInAiStatus()`

### 実装手順

1. `src/utils/browserSupport.ts` の `getBuiltInAIDiskSpace()` 冒頭に Prompt API 存在ゲートを追加する:

```ts
export async function getBuiltInAIDiskSpace(): Promise<BuiltInAIDiskSpace | null> {
    // The 22 GiB rule only applies where the Prompt API exists. Without the
    // API (e.g. Firefox) the origin quota cap (~10 GiB) masquerades as free
    // disk space and produces a false "insufficient space" message (#161).
    if (typeof (globalThis as { LanguageModel?: unknown }).LanguageModel === 'undefined') {
        return null;
    }
    // ... existing estimate() handling unchanged
}
```

2. テスト戦略のとおり統合 → 単体を更新する（既存 6 テストは `LanguageModel` を設定してから実行するよう beforeEach を修正）
3. `CHANGELOG.md`（Fixed セクション）に追記する
4. `npm run validate` を通して PR を出す。マージ後、修正版バージョン番号を添えて issue #161 をクローズする（Linear DEV-93 がリンクバックされる）

### 落とし穴

- **既存テストはテスト環境（jsdom/node）で走るため `LanguageModel` が無い**。ゲート追加だけですべての既存ディスク容量テストが null を返して失敗する。テスト内で `globalThis.LanguageModel = {}` を設定し、afterEach で必ず復元する（復元漏れは他テストへのリークで flaky の原因になる）
- `builtInAiDiagnosticsService.test.ts` の「reports disk space instead of flag guidance when space is short」は `getBuiltInAIDiskSpace` をモジュールモックしているためゲートの影響を受けず green のまま。ただしこのテストが表す状態は「Prompt API が存在する Chromium での容量不足」に限定されたことをテスト冒頭のコメントで明記すると読み手が混乱しない
- `declare global { var LanguageModel }` を browserSupport.ts に足さないこと。`builtInAIClient.ts` の同名グローバル宣言と型衝突する。`globalThis` を narrowing して参照すれば宣言不要
- Chromium での `quota - usage` は厳密にはオリジン割当クォータであって実ディスク空き容量ではない。Chromium での近似精度改善や文言への「推定」明示は本 PBI のスコープ外とする（Chromium 挙動を変えると v6.9.x の意図的修正の検証をやり直すことになる）
- `getBrowserName()` は Firefox/Safari を `unknown` にする。ゲートにより diskSpace が null になった結果、unknown ブラウザは既存の generic 案内へ自然にフォールバックする。新しい案内分岐を増やさない

### ロールバック

表示文言と判定分岐のみの変更で、ストレージ・メッセージスキーマ・権限に非接触。git revert で完結する。

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（統合・単体。E2E は既存 spec の green 維持）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更ではないため通常レビュー）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（上記「ロールバック」節に記載済み）
- [ ] ドキュメント更新済み（CHANGELOG.md。docs/BUILT_IN_AI_SETUP_GUIDE.md の容量要件記載は仕様変更がないため現状維持）
- [ ] issue #161 をクローズ
