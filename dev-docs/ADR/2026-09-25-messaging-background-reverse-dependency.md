# ADR: messaging から background への逆依存を許容する

## ステータス
採用済み

## 日付
2026-09-25

## コンテキスト
`src/messaging/types.ts` は、中立な messaging 層でありながら実行時定数を
`src/background/messageTypes.ts` から import している。

- `src/messaging/types.ts:156-157` — `VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES` を
  `../background/messageTypes.js` から実行時 import し、`ExtensionMessage` を型として import する。
- import 宣言は production で13件（対象11ファイル）、テスト込みで22件。

この依存を「階層が逆だ」とだけ見て構造違反として扱うと、修正対象も実害もない
再調査が繰り返される。実害の有無を確認したところ、以下が成り立つ。

1. **循環が存在しない。** `src/background/messageTypes.ts` が実行時に import するのは
   中立な `../messaging/protocol.js` のみであり、`messaging/types.ts` へ戻る経路はない。
2. **Chrome API の副作用を発生させない。** 同ファイルは型と純粋な定数を中心とする
   module であり、import しても Service Worker の準備や listener 登録は走らない。
3. **単一の情報源になっている。** `ExtensionMessage` の union と
   `VALID_MESSAGE_TYPES` / `NO_PAYLOAD_TYPES` の配列を同じ module が所有しており、
   二重定義は存在しない。

実害がないため、依存の向きだけを理由としたコード変更は行わない。

## 関連するADR
- [module 級 singleton と composition root の併存方針](./2026-09-17-module-singleton-policy.md)
- [utils 層の循環依存](./2026-08-20-utils-layer-circular-dependency.md)

## 決定事項
`src/messaging/types.ts` から `src/background/messageTypes.ts` への実行時 import を
許容し、コードは現状維持する。

- 階層名だけを根拠に構造違反・修正対象として記録しない。
- 循環もなく Chrome API の副作用も発生しないため、依存の向きだけを
   変更理由として採用しない。
- 判断理由と再検討条件は本 ADR を唯一の正本とし、既存の断片的な記録には依拠しない。

### 単一の情報源と規約

- `ExtensionMessage`、`VALID_MESSAGE_TYPES`、`NO_PAYLOAD_TYPES` の正本は
  `src/background/messageTypes.ts`。配列と union を別々に再定義しない。
- `CURRENT_PROTOCOL_VERSION` の正本は `src/messaging/protocol.ts` であり、
  `src/background/messageTypes.ts` は後方互換のための re-export 専用とする。
  protocol 定数を background 層の正本へ移さない。
- import は ESM 規約に従い、`.js` 拡張子を必須とする。

### 再検討トリガー

以下いずれかが実際に発生した時点で、本 ADR を置換する ADR を起票する。

1. 実際の循環が発生した場合
2. 実行時 import graph が増えた場合
3. 新しい層を追加した際に同じ逆依存が再できた場合

### 将来の中立化を行う場合の制約

- content script や offscreen から provider strategy を持ち込まない。
- 配列と union の二重定義を発生させない。
- ESM import の `.js` 拡張子を必須とする。

## 結果

### メリット
- 実害のない依存を修正対象として再調査する時間を減らせる。
- メッセージ型の単一の情報源が維持され、配列と union の二重定義が起きない。
- 判断理由と再検討条件を同じ場所から確認できる。

### デメリット
- 依存グラフの向きが中立的でないため、階層の向きを検証する設計レビューでは
  この逆依存を例外として扱う必要がある。
- protocol 定数の正本と re-export が別ファイルに分かれている。

### 影響範囲
- 実コード・型・import 経路・定数は変更しない。挙動変更はない。
- 文書のみの変更であり、テストの追加・変更は不要。

## 参照
- `src/messaging/types.ts` — 逆依存の import 元
- `src/background/messageTypes.ts` — import 先（Chrome API 副作用なし・re-export 専用）
- `src/messaging/protocol.ts` — `CURRENT_PROTOCOL_VERSION` の正本
- `src/messaging/__tests__/types.test.ts` — メッセージ型の整合
- `src/__tests__/messaging-types-uniformity.test.ts` — import の一様性
- `src/background/__tests__/message-types-consistency.test.ts` — 配列と union の一致
- PBI: `pbi/2026-09-25-20-doc-messaging-layer-decision-record.md`
