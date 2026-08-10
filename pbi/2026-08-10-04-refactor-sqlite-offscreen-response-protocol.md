# PBI: SWとoffscreen間のSQLite応答を型付きprotocolへ統一する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー
開発者として、offscreen SQLite操作の応答を型付きで受け取りたい。なぜなら、呼び出し側の手動変換や型漏れを減らし、通信障害とデータ結果を正確に検証したいから。

## 調査結果
送信側の `sqliteMessages.ts` は型付きだが、`sqliteClient.ts` の `OffscreenResponse` はルースな辞書であることを確認した。本PBIは既存protocolを応答側まで深める改善である。

対象:
- `src/messaging/sqliteMessages.ts`
- `src/background/sqliteClient.ts`
- `src/offscreen/offscreen.ts`
- `src/background/handlers/dashboardSqliteProtocol.ts`
- `src/offscreen/__tests__/`、`src/background/__tests__/`

## 5 Whys
1. なぜ応答の不整合が実行時まで分からないのか。応答が `[key: string]: unknown` のルースな形だから。
2. なぜルースな形なのか。操作ごとの応答型がprotocolの一部として定義されていないから。
3. なぜcallerが手動変換するのか。`Number(res.count || 0)` のように各操作が自分でshapeを解釈しているから。
4. なぜ解釈が分散したのか。送信メッセージの型付けと応答の型付けを別々に進めたから。
5. なぜ差が検出されないのか。操作ごとの送受信契約を網羅する統合テストがないから。

根本原因: SW↔offscreen seamのprotocolが片方向だけ型付きで、応答の責務がcallerへ漏れている。

## BDD受け入れシナリオ

```gherkin
Scenario: SQLite応答を操作に対応した結果として受け取る
  Given offscreenがSQLite操作を正常に完了する
  When backgroundが応答を受け取る
  Then 操作に対応した型付き結果を受け取る
  And callerは手動の数値変換を行わない

Scenario: 応答形状が不正な場合に安全に失敗する
  Given offscreenが必要なフィールドを欠く応答を返す
  When backgroundが応答をdecodeする
  Then 応答は失敗として扱われる
  And 不正な値を0件や成功へ変換しない

Scenario: offscreen操作の失敗理由を伝える
  Given offscreen側のSQLite操作が失敗する
  When backgroundが応答を受け取る
  Then 構造化された失敗結果を受け取る
  And 既存の再試行・表示判断へ利用できる
```

## 受け入れ基準
- [ ] SQLite操作ごとの応答shapeが型で表現される。
- [ ] `OffscreenResponse` のルースなindex signature依存を削減または削除する。
- [ ] `Number(res.x || 0)` のcaller側手動coercionを対象操作から除去する。
- [ ] offscreen入口でpayloadと応答を検証する。
- [ ] 送信側と受信側の操作一覧が単一ソースまたは網羅テストで一致する。
- [ ] 不正応答、未知操作、例外が安全に失敗する。
- [ ] Manifest V3のoffscreen制約を変更しない。

## テスト戦略（TDD）

### Outside-In手順
1. SWからoffscreenへ操作を送り、型付き結果を受ける統合テストを先に追加する。
2. 応答shape不正の契約テストをRedで追加する。
3. decode/validationの単体テストを追加する。
4. `sqliteClient.ts` と `offscreen.ts` を最小変更する。
5. Green後に重複transformを削除する。

### 統合テスト
- insert/query/search/update/delete/toggleStar/getCountなど各操作の往復。
- countが正しい数値として返る。
- rowsとtotalのshapeが一致する。
- backup/restoreのバイナリ応答が壊れない。
- offscreen例外が構造化失敗へ変換される。
- 不正応答がcallerへ成功として届かない。

### 単体テスト
- 各操作のresponse decoder成功。
- 必須フィールド欠落。
- null、文字列、NaN、負数など不正値。
- unknown message type。
- error kindとretriableのdecode。
- 送信可能な全操作が受信dispatchで処理される網羅性。

## 実装手順
1. `sqliteMessages.ts` の送信variantと`offscreen.ts`のdispatchを一覧化する。
2. `sqliteClient.ts` の各response読み取り箇所を一覧化する。
3. まず往復統合テストと不正応答テストを追加する。
4. 操作ごとの応答型とdecoderをprotocol module内に追加する。
5. offscreenのdispatch出口で応答を構造化する。
6. sqliteClient側をdecoder経由に変更する。
7. 手動coercionとルースな型依存を削除する。
8. 送信操作一覧と受信操作一覧の網羅テストを追加する。
9. `npm run type-check`、関連テスト、`npm run build`を実行する。

## 落とし穴
- requestの型付けだけで完了にしない。responseの失敗shapeも対象にする。
- `0` は有効なcountであり、`undefined`や不正値と混同しない。
- offscreen documentからtabs/downloads/actionなどのChrome APIを呼ばない。
- `postMessage`を使う内部WorkerとのprotocolとSW↔offscreen protocolを混同しない。
- バイナリ結果をJSON向けdecoderで処理しない。

## 見積もり
3ポイント。PBI-02と関係するため、結果表現の整理後に実施する。

## Definition of Done
- [ ] 応答contractが型とテストで網羅される。
- [ ] caller側の手動coercionが対象範囲から消える。
- [ ] 不正応答・例外のテストが成功する。
- [ ] `npm run type-check` と `npm run build` が成功する。
- [ ] MV3のoffscreen制約に適合する。
- [ ] コードレビューが完了する。
