# PBI: tsconfig.json に追加の厳格フラグを導入し、CI とエディタの型チェックを整合させる

## ユーザーストーリー
開発者として、`npm run type-check`（CI の型チェック）とエディタ（`.wxt/tsconfig.json`）が同じ厳格度で型チェックしてほしい。なぜなら、現在は `.wxt/tsconfig.json` だけに `noUncheckedIndexedAccess` 等が有効で、エディタではエラーになるが CI では素通りする不整合があり、indexed access 由来の実行時 `undefined` エラーが本番に混入するリスクが残るから。

## 優先度
- 順位: 03 / 06
- RICEスコア: 96（Reach=90 / Impact=2 / Confidence=80% / Effort=1.5人週）
- 根拠: 全将来のコード変更をゲートし（Reach高）、`undefined` 実行時エラーを静的に防ぐ実害軽減効果が大きい。`no-explicit-any`（PBI 02）に次ぐ基盤強化。ただし `noUncheckedIndexedAccess` は既存コードへの型エラー波及が大きいため、進行中の refactor0817 完了後に着手するのが安全。

## ビジネス価値
- インデックスアクセス・配列アクセス由来の `undefined` 実行時エラーをコンパイル時に検出する
- エディタと CI の判定不一致を解消し、「エディタで赤ければ CI でも赤い」を保証する
- `noImplicitOverride` により基底クラスのシグネチャ変更をサブクラスに確実に伝播させる

## 背景（2026-08-18 調査済み）
型チェックの本命である `npm run type-check`（=`tsc --noEmit`）が使う `tsconfig.json` には以下のフラグが未設定:

- `noUncheckedIndexedAccess` — 配列・インデックスアクセスの結果を `T | undefined` として扱う
- `noImplicitOverride` — `override` キーワードの明示を強制する
- `noFallthroughCasesInSwitch` — switch 文の fallthrough を禁止する

一方、WXT が生成する `.wxt/tsconfig.json` には以下の通り既に有効:

- `noFallthroughCasesInSwitch: true`（`.wxt/tsconfig.json:17`）
- `noUncheckedIndexedAccess: true`（`.wxt/tsconfig.json:18`）
- `noImplicitOverride: true`（`.wxt/tsconfig.json:19`）

つまり、エディタが `.wxt/tsconfig.json` を拾う環境では検出される型エラーが、CI の `tsc --noEmit` では検出されない。根本解決は `tsconfig.json` 側にも同フラグを追加して単一の厳格度に統一すること。

## BDD受け入れシナリオ

Scenario: インデックスアクセスが `undefined` を返しうる場合に型エラーになる
  Given `tsconfig.json` に `noUncheckedIndexedAccess` が有効化されている
  When 開発者が `items[0].name` や `map[key]` を null/undefined チェックなしで参照する
  Then `npm run type-check` が型エラーを報告し、実行時 `undefined` 参照を未然に防ぐ

Scenario: エディタと CI で同じ型エラーが報告される
  Given `tsconfig.json` と `.wxt/tsconfig.json` の厳格フラグが整合している
  When 開発者がエディタで型エラーを確認した後に `npm run type-check` を実行する
  Then 同じ型エラーが報告され、CI でも同じ理由で失敗する

Scenario: override キーワードの付け忘れが検出される
  Given `noImplicitOverride` が有効化されている
  When サブクラスが基底クラスのメソッドを再定義する際に `override` を付け忘れる
  Then `npm run type-check` が型エラーを報告する

## 受け入れ基準
- [ ] `tsconfig.json` に `noUncheckedIndexedAccess` / `noImplicitOverride` / `noFallthroughCasesInSwitch` が追加される
- [ ] 追加フラグによる既存コードの型エラーが全て解消される
- [ ] `npm run type-check` がエラー0件で終了する
- [ ] `tsconfig.json` と `.wxt/tsconfig.json` の厳格度に意図しない乖離が無い（エディタとCIが一致）
- [ ] 既存テストがパスする

## テスト戦略
- 静的: `npm run type-check`（CI）が追加フラグ有効下でエラー0件であること
- 単体: indexed access の結果が `T | undefined` になることによる境界値（空配列・欠落キー）のテストが、該当コードに存在 or 追加される
- 回帰: switch 文を持つ既存ロジックの fallthrough 意図箇所が正しく `break` / 明示コメント化されていること

## 実装アプローチ
1. `tsconfig.json` に3フラグを追加し、`npm run type-check` で発生するエラー数を把握する
2. `noUncheckedIndexedAccess` 由来のエラーを、null チェック・`?.`・デフォルト値で1件ずつ解消する（`noImplicitOverride` / `noFallthroughCasesInSwitch` 由来は比較的少数のはず）
3. refactor0817 との競合を避けるため、ブランチマージ後に着手する（またはブランチ上で順次解消）

## 見積もり
3pt（🔴高）

## 技術的考慮事項
- `noUncheckedIndexedAccess` は波及範囲が大きく、既存コードの配列・Record アクセスに多数のエラーが出る可能性が高い。段階的に1ファイルずつ解消する戦略が安全
- 進行中の refactor0817（作業ツリーに約48ファイルの未コミット変更）と重なるとレビュー不能になるため、マージ後に着手する
- エディタ（`.wxt/tsconfig.json`）は既に同フラグで動いているため、実質「CI をエディタの水準に引き上げる」作業になる

## Definition of Done
- [ ] 3フラグが `tsconfig.json` に有効化され、`npm run type-check` エラー0件
- [ ] エディタと CI の型チェックが一致する
- [ ] 既存テストパス
- [ ] コードレビュー完了
