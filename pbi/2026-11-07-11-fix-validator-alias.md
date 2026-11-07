# PBI 2026-11-07-11: isFiniteNumber 重複の alias 化

## ヘッダ

- Rank: 2/5 (holistic improvement round)
- RICE: 2.0 (Reach 2 / Impact 1 / Confidence 1.0 / Effort 1)
- 依存: なし
- 種別: micro-fix
- 前提 PBI: dev-docs/archived/pbi/2026-11-07-08-investigate-validator-unify.md
- 見積: 1SP

## ユーザーストーリー

開発者として、isFiniteNumber の二重定義を一つにまとめたい。重複した保守箇所をなくし、将来の境界変更が一箇所に集まるようにしたい。

## 背景

本 PBI は archived PBI 2026-11-07-08 の裁定を実施する ready な micro-fix である。同 PBI は仮説 A (同一) を採用し、alias 化の方針と正本を示した。見送り理由には risk が極小 (re-export 1行、循環なし、既存テストが両モジュールを緑保持) と記録されている。

Read で再確認した事実は次のとおりである。いずれも確認済みであり、要確認の項目はない。

- src/messaging/sqliteValidators.ts:61-62 が isFiniteNumber を定義する。
- src/messaging/validators.ts:286-287 が同一述語を定義する。差分は引数名だけである。
- src/messaging/gatewayFactory.ts:21-24 は validators に依存しない。裁定の前提は変わらない。

引用:

src/messaging/sqliteValidators.ts:61-62:

```ts
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
```

src/messaging/validators.ts:286-287:

```ts
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
```

src/messaging/gatewayFactory.ts:21-24:

```ts
import { asSuccessResponse } from './normalizeGatewayResponse.js';
import { sendWithPolicy } from './sendWithPolicy.js';
import type { SendFailure } from './sendWithPolicy.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
```

修正内容は次のとおりである。src/messaging/sqliteValidators.ts:61-62 の2行定義を次の1行に置き換える。src/messaging/validators.ts 側の定義と内部利用は変えない。振る舞いの変更はない。

```ts
export { isFiniteNumber } from './validators.js';
```

## BDD シナリオ

### シナリオ 1: 重複定義が alias に置き換わる

```gherkin
Given src/messaging/sqliteValidators.ts が isFiniteNumber を独自定義している
When 61-62 行目の定義を validators.js からの re-export に置き換える
Then 公開 API としての isFiniteNumber は同じ型ガードとして使える
```

### シナリオ 2: 循環参照が生じない

```gherkin
Given src/messaging/validators.ts が sqliteValidators.ts に依存していない
When sqliteValidators.ts が validators.js から isFiniteNumber を re-export する
Then モジュール間に循環参照は生じない
```

### シナリオ 3: 既存の検証が緑のままである

```gherkin
Given 振る舞いの変更がない
When messaging の既存テストと型チェックを実行する
Then すべて緑になる
```

## 受け入れ条件

- [ ] src/messaging/sqliteValidators.ts の2行定義が1行の re-export に置き換わっていること
- [ ] src/messaging/validators.ts 側の定義と内部利用が変わっていないこと
- [ ] sqliteValidators.ts と validators.ts の間に循環参照がないこと
- [ ] messaging の既存テストが緑であること
- [ ] 型チェックが緑であること
- [ ] 公開 API の振る舞いに変更がないこと

## テスト戦略

新規テストは不要である。既存の messaging スイートで回帰を確認する。validators と sqliteValidators を対象に含む既存テストを実行し、緑であることを確認する。加えて型チェックを実行し、re-export による型ガードの破損がないことを確認する。

## 見積

1SP

## DoD

- [ ] 1行の re-export への置き換えが完了している
- [ ] 循環参照がない
- [ ] messaging の既存テストが緑である
- [ ] 型チェックが緑である
- [ ] 日本語本文・英語の code/identifier・Shift-JIS 安全文字だけで書かれている
- [ ] 絵文字を使っていない
