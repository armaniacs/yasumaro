# PBI: MessageRouter のバリデータ二段キャスト解消とデッドコード削除

## ユーザーストーリー

保守者として、MessageRouter のハンドラ登録を 1 点変更で完結させたい。現在は新ハンドラ追加に factory + handlers entry + validators.set の 3 点編集と二段キャストが必要で、漏れると型検査を迂回したまま動くためだ。あわせて呼び出し元ゼロのデッドコードを削除したい。

## 優先度

- 種別: refactor
- 順位: 18 / 20
- RICEスコア: 3.6（Reach=4 / Impact=0.5 / Confidence=0.9 / Effort=0.5）
- 根拠: 新ハンドラ追加時の編集点が 3 → 2 に減り二段キャスト ×10 が消える。デッドコードは観測影響ゼロで削除可能。
- 依存: 特になし（本グループ内で完結）。

## 背景

### validators.set の二段キャスト ×10

- `src/messaging/MessageRouter.ts:240-249`: `validators.set` で二段キャストが 10 箇所。
- 修正: `setValidator` ヘルパー（またはリテラルテーブル）を導入し、新ハンドラ追加時の編集点を factory + handlers entry の 2 点に減らす。

### デッドコード

- `src/messaging/types.ts:306-320` `extractMessageContent`: production 呼び出し 0。`_isContentScriptSender` を計算した後捨て、`isValidSender:true` をハードコード。削除候補。
- `src/messaging/types.ts:239-243` `MessageContext`: 上記と対の削除候補。
- `src/background/urlNotificationHandlers.ts:34-45`: maxLength チェックが実質デッド（計算値 ~148 が常に `MAX_URL_LENGTH=2000` に先行）。
- `src/background/urlNotificationHandlers.ts:123-134`: 純粋なエイリアス。削除候補。
- `src/background/urlNotificationHandlers.ts:42`: 日本語が混在したコメント。英語へ整理。
- `src/offscreen/offscreen.ts:117`: else 分岐の `isSqliteMessageType` が常に false で、`traceId` が常に undefined になる不成立条件。削除候補。

### 修正方針

- validator helper 導入 + デッドコード削除。削除前に `grep` で production 呼び出し 0 を確認する。

## BDD受け入れシナリオ

```gherkin
Scenario: 新ハンドラ追加が 2 点編集で完結する
  Given setValidator ヘルパーが用意されている
  When 新しいメッセージ型のハンドラを追加する
  Then 編集は factory と handlers entry の 2 点で完結する
  And validators.set の二段キャストはコードに残らない

Scenario: デッドコードを削除しても検証が成功する
  Given extractMessageContent と MessageContext の production 呼び出しが 0 である
  When これらと不成立条件の traceId 分岐を削除する
  Then npm run validate が成功する
  And production の動作に変化がない
```

## 受け入れ基準

- [ ] `MessageRouter.ts:240-249` の二段キャスト ×10 が setValidator ヘルパー（またはリテラルテーブル）に置き換わっている。
- [ ] ヘルパー導入後、新ハンドラ追加に必要な編集点が 2 点であることを README またはコード構成から確認している。
- [ ] `types.ts:306-320` の extractMessageContent と `:239-243` の MessageContext を、grep による production 呼び出し 0 の確認の上で削除している。
- [ ] `urlNotificationHandlers.ts` のデッド maxLength チェック（:34-45）と純粋エイリアス（:123-134）を削除し、` :42` の日本語混在コメントを英語へ整理している。
- [ ] `offscreen.ts:117` の不成立条件分岐を削除している。
- [ ] `npm run validate` が成功している。
- [ ] production の動作に回帰がない。

## テスト戦略

### 単体テスト

- MessageRouter の既存テストを基準に、ヘルパー経由の登録でハンドラ呼び出し結果が変わらないことを確認する。
- traceId 分岐削除後、offscreen のメッセージ処理テストが通ることを確認する。

### 統合テスト

- 削除対象は `grep -rn "extractMessageContent\|MessageContext" src/ --include="*.ts"` で production 呼び出し 0 を記録してから削除する。
- `npm run validate` をゲートとする。

## 見積もり

**0.5 SP**

ヘルパー 1 本とデッドコード削除。型破壊を伴わない機械的変更。

## Definition of Done

- [ ] 二段キャスト ×10 が解消されている。
- [ ] デッドコードが grep 確認付きで削除されている。
- [ ] 日本語混在コメントが英語へ整理されている。
- [ ] `npm run validate` が成功している。
- [ ] 既存のビルド・テスト・ユーザーに観測される動作に回帰がない。
