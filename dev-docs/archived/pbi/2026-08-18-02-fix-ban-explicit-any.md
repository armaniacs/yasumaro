# PBI: `any` を ESLint で機械的に禁止し、本番コードの既存 `any` を排除する

## ユーザーストーリー
開発者として、`@typescript-eslint/no-explicit-any` が有効化され、本番コードから明示的な `any` が排除された状態にしたい。なぜなら、`any` は型チェックを局所的に無効化し、コンパイル時には検出されない実行時エラーの温床になるため、現状は「人の規律」で9件に抑えているだけで、ルールが無ければ今後確実に増えるから。

## 優先度
- 順位: 02 / 06
- RICEスコア: 324（Reach=90 / Impact=2 / Confidence=90% / Effort=0.5人週）
- 根拠: 全将来のコード変更をゲートする（Reach高）・低コストで即効性が高い（Effort最小）・型安全性の「制度化」という性質上、他候補より先に着手すべき基盤。既存PBI 01（CI lint導入）が先に完了していれば、このルールもCIで強制できる。

## ビジネス価値
- `any` の混入を機械的に防ぎ、「曖昧な型を書けない」状態を制度化する
- 型の穴をレビュー指摘に頼らず、lint で自動検出してレビュー負荷を下げる
- 型安全性を前提にした後続のリファクタ（tsconfig厳格化・キャスト解消）の土台になる

## 背景（2026-08-18 調査済み）
`eslint.config.js` のルールは `@typescript-eslint/no-unused-vars` とカスタム2件（`local/require-sanitized-markdown` / `local/require-response-size-limit`）のみで、`no-explicit-any` は未設定。

本番コード（`src/`、`__tests__` 除外）に現存する `any` は9件で、全て列挙済み:

- `src/background/handlers/MessageHandlerRegistry.ts:6` / `:33` — `message: any`
- `src/background/handlers/createMessageHandlerRegistry.ts:40` — `buildAllowedUrls: (settings: any) => Set<string>`
- `src/background/handlers/createMessageHandlerRegistry.ts:41` — `getSettings: () => Promise<any>`
- `src/background/handlers/createMessageHandlerRegistry.ts:44` — `notifyAiTestProgress: (progress: any) => void`
- `src/background/handlers/createMessageHandlerRegistry.ts:45` — `getPrivacyCache: () => Map<string, any> | null`
- `src/utils/i18n.ts:24` — `getMessage(key: string, substitutions: any): string`
- `src/background/handlers/dashboardSqlite/deps.ts:114` — `record as any`
- `src/dashboard/gistSettings.ts:39` — `} as any)`

このうち大半は Chrome のメッセージパッシング境界（`chrome.runtime.onMessage` が `any` を返す）と i18n に集中しており、型を具体的にする余地がある。テストコードには `as any` 953件・`@ts-expect-error` 532件が存在するが、これらはモック用途で `eslint.config.js` の `ignores`（`src/**/__tests__/**`）で既に lint 対象外のため、本PBIのスコープ外とする。

## BDD受け入れシナリオ

Scenario: `any` を含む新規コードを追加すると lint が失敗する
  Given `@typescript-eslint/no-explicit-any` が `error` として有効化されている
  When 開発者が `const x: any = someValue` を含む変更を加えて `npm run lint` を実行する
  Then lint が `no-explicit-any` 違反で失敗し、マージ前に検出される

Scenario: 既存の本番コードに明示的な `any` が残っていない
  Given 上記9件が「型を具体化」または「正当な理由付きの disable + WHY コメント」で是正されている
  When 本番コード（`__tests__` 除外）に対して `npm run lint` を実行する
  Then エラー0件で終了する

Scenario: テストコードのモックはこのルールの影響を受けない
  Given `__tests__` 配下は lint の `ignores` に含まれている
  When テストでモックのために `as any` を使用する
  Then `no-explicit-any` 違反として報告されない（既存のテストコードが壊れない）

## 受け入れ基準
- [ ] `eslint.config.js` の `src/**/*.ts` ルールに `@typescript-eslint/no-explicit-any: error` が追加される
- [ ] 本番コードの `any` 9件が全て解消される（型を具体化、または `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + WHY コメント）
- [ ] メッセージハンドラ境界（`MessageHandlerRegistry.ts` 等）は、可能ならメッセージ型の判別ユニオンまたは `unknown` + 型ガードに置換される
- [ ] `i18n.ts` の `substitutions: any` は `string | string[]`（Chrome `chrome.i18n.getMessage` の実型）に具体化される
- [ ] `npm run lint` がエラー0件で終了する
- [ ] `npm run type-check` と既存テストがパスする

## テスト戦略
- 単体: `i18n.ts` の `getMessage` が `string` / `string[]` の双方を受け付ける境界テスト
- 単体: メッセージハンドラの dispatch が判別ユニオン経由で型安全にハンドリングされること（不正な型を弾く/正しく絞り込む）
- 静的: `npm run lint`（CI）が `no-explicit-any` 違反を検出すること（ルール自体の回帰防止）

## 実装アプローチ
1. `eslint.config.js` に `@typescript-eslint/no-explicit-any: error` を追加（`src/utils/logger.ts` 用の個別設定ブロックにも反映）
2. `npm run lint` で検出される9件を1件ずつ是正する
   - 型を具体化できる箇所（`i18n.ts` 等）は `unknown`/具象型に置換
   - Chrome 境界でどうしても残る箇所は `unknown` + 型ガード、または最小限の `eslint-disable-next-line` + WHY コメント
3. `npm run lint` と `npm run type-check` で全体を確認

## 見積もり
1pt（🟢低）

## 技術的考慮事項
- `chrome.runtime.onMessage` が返す値は仕様上 `any` のため、境界で `unknown` に受けてから型ガードで絞り込む方針が既存の型安全パターンと整合する
- 既存PBI 01（`fix-eslint-errors-and-wire-ci-lint`）が lint を CI に組み込む前提のため、本PBIのルールは CI でも強制される（01 完了前に着手する場合もローカル lint で検出は可能）

## Definition of Done
- [ ] `no-explicit-any` ルールが有効化され、本番コードの `any` が0件
- [ ] `npm run lint` エラー0件
- [ ] `npm run type-check` 成功
- [ ] 既存テストパス
- [ ] コードレビュー完了
