# PBI-11: SqliteClient shim削除 + call分割

## ユーザーストーリー
開発者として、SqliteClient の20 shim (insertResult等) を削除し、汎用 call<T,R> を domain別 helper に分割したい。production 消費者0、テストのみ依存のため pure deletion。

## RICE
RICE 20.0, 1pt, 依存なし, pure deletion

## なぜなぜ分析
1. なぜ20 shimが残存か → 後方互換のためだが production 消費者0、テストのみ依存
2. なぜ call<T,R> が汎用的か → domain別 error taxonomy が1つの categorizeError に混在 → 解: shim削除 + callを domain別 helperに分割

## 実装手順
1. `src/background/sqliteClient.ts:280-385` の 20 shim (insertResult, queryResult, updateResult, deleteResult, upsertResult等) を削除 (約100行)。query/mutate/maintain/getStatus の4 domain のみ残す
2. 汎用 `call<T,R>(type,payload,transform?,traceId)` を `callQuery/callMutate/callMaintain/callStatus` の4 domain-private helper に分割。各 helper が OffscreenResponse subtype と categorizeError を所有。Extract<> 8 overloads も簡素化
3. 既存テスト 13ファイルの shim 呼び出しを新 domain API (query/mutate/maintain/getStatus) に移行。`grep -rn "Result(" src/` で0件を確認
4. `grep -rn "insertResult\|queryResult\|updateResult" src/` が0件になることを確認
5. dashboardSqliteWiring の 3 domain deps が正しく配線されることを確認

## 受け入れ基準
- [x] 20 shim 削除
- [x] call 4分割
- [x] テスト移行完了
- [x] grep 0件
- [x] type-check / lint / test PASS

## 制約
- Read → Edit 順守、git add -A 禁止
- 他PBI (PBI-10 ProviderRegistry, PBI-07 offscreen guard) とファイル重複なし — 並列実行中のため src/background/ai/ と src/offscreen/ には触れない
- コメントは WHY のみ、絵文字禁止
- ワークツリー内で作業、pbi ファイルは一時的に pbi/ に再作成し、完了時にチェックボックス [x] に更新して archived へ git mv

## 検証
```bash
npm run type-check
npm run lint
npm test
```
