# PBI: `exactOptionalPropertyTypes` / `noImplicitReturns` を段階的に導入する

## ユーザーストーリー
開発者として、オプショナルプロパティへの暗黙の `undefined` 代入と、return 漏れをコンパイル時に検出したい。なぜなら、これらは「型としては通るが実行時に意図しない `undefined` が流れる」典型的な型の抜け道で、型安全性の仕上げとして最終的に塞ぐべきだから。

## 優先度
- 順位: 06 / 06
- RICEスコア: 14.4（Reach=60 / Impact=1 / Confidence=60% / Effort=2.5人週）
- 根拠: 型安全性の最終仕上げとして価値はあるが、既存コードへの波及（`exactOptionalPropertyTypes` は `{ prop: undefined }` の明示代入を大量に検出し、`noImplicitReturns` は早期returnパターンを大量に検出）が大きく、コストパフォーマンスが低い。PBI 02〜05 の完了後に、余裕がある時点で段階導入する将来候補。

## ビジネス価値
- 「プロパティが存在するが値が `undefined`」と「プロパティが存在しない」を厳密に区別し、意図しない `undefined` 流入を防ぐ
- 全経路で return を強制し、戻り値の取りこぼしバグを防ぐ

## 背景（2026-08-18 調査済み）
`tsconfig.json` には以下のフラグが未設定（`strict: true` には含まれない追加フラグ）:

- `exactOptionalPropertyTypes` — オプショナルプロパティへの明示的な `undefined` 代入を禁止する
- `noImplicitReturns` — 全経路で return を強制する

両フラグとも有効化すると既存コードへの波及が大きく、特にオプショナルプロパティを多用する設定オブジェクト・メッセージ型・ストレージ境界で多数の型エラーが発生すると見込まれる。進行中の refactor0817 や PBI 02〜05 と同時に進めるとレビュー不能になるため、独立した最終タスクとして段階導入する。

## BDD受け入れシナリオ

Scenario: オプショナルプロパティへの暗黙の undefined 代入が検出される
  Given `exactOptionalPropertyTypes` が有効化されている
  When 開発者が `{ optionalProp: undefined }` をオプショナルプロパティに代入する
  Then `npm run type-check` が型エラーを報告する（`undefined` を渡すなら `optionalProp?: T | undefined` と明示させる）

Scenario: return 漏れのある関数が検出される
  Given `noImplicitReturns` が有効化されている
  When 関数の一部の分岐で return が欠落している
  Then `npm run type-check` が型エラーを報告する

Scenario: 既存コードへの影響が段階的に吸収される
  Given 有効化前に型エラーの全量を把握している
  When ファイル単位・境界単位でエラーを解消していく
  Then 各段階で `npm run type-check` がエラー0件に戻り、途中でビルドが壊れた状態が残らない

## 受け入れ基準
- [ ] `exactOptionalPropertyTypes` が `tsconfig.json` に追加され、発生エラーが全て解消される
- [ ] `noImplicitReturns` が `tsconfig.json` に追加され、発生エラーが全て解消される
- [ ] 途中段階でも `npm run type-check` がエラー0件を維持できる手順（フラグ追加→解消→次のフラグ）で進められる
- [ ] 既存テストがパスする

## テスト戦略
- 単体: オプショナルプロパティに `undefined` を渡す/渡さない境界の型テスト（該当コードに追加）
- 単体: 早期return・switch分岐を持つ関数の戻り値境界テスト
- 静的: `npm run type-check` が両フラグ有効下で成功すること

## 実装アプローチ
1. 事前に `npx tsc --noEmit` 相当のドライランで両フラグ有効時のエラー数を計測し、影響範囲を見積もる
2. `noImplicitReturns`（比較的影響が小さい方）から先に有効化し、エラーを解消する
3. 次に `exactOptionalPropertyTypes` を有効化し、`| undefined` の明示・型定義の見直しを境界ごとに進める
4. 各フラグ有効化後に `npm run type-check` とテストを実行してエラー0を維持する

## 見積もり
3pt（🔴高）

## 技術的考慮事項
- `exactOptionalPropertyTypes` は「キーの省略」と「値が undefined」を区別するため、既存の `Partial<T>` やスプレッド代入で意図的に `undefined` を流している箇所は `| undefined` の追記が必要になる
- ストレージ境界・メッセージ型で「undefined を省略の代わりに使う」既存パターンがどれだけあるかが工数を左右するため、事前計測が重要
- タイミングは refactor0817 と PBI 02〜05 の完了後を想定

## Definition of Done
- [ ] 両フラグが `tsconfig.json` に有効化され、`npm run type-check` エラー0件
- [ ] 既存テストパス
- [ ] コードレビュー完了
