# PBI: sqliteClient の QueryOp/MutateOp SSOT 乖離とエラー処理を是正する

## ユーザーストーリー
開発者として、sqliteClient の query/mutate が QueryOp/MutateOp の正規型を再利用するようにしたい、なぜなら将来 QueryOp にフィールド追加した際に sqliteClient 側だけ古いままになり、型エラーなくサイレントな不整合が本番に流出するのを防ぎたいから

## 優先度
- 順位: 3 / 9
- RICEスコア: 34.3（Reach=8 / Impact=2 / Confidence=75% / Effort=0.35w）
- 根拠: god node (sqliteClient) で呼び出し元が 8箇所以上。High だが Effort が中。01/02 と並列可。

## ビジネス価値
- スキーマ進化時の型安全性が保証され、レビュアが気づかない「片方だけ更新」事故を 0 にできる
- エラー分類が文字列依存から脱却し、Offscreen 不在とネットワーク断の誤分類がなくなる

## BDD受け入れシナリオ

```gherkin
Scenario: QueryOp への追加が sqliteClient に自動反映される
  Given QueryOp に新フィールド `filterByTag` を追加する
  When `npm run type-check` を実行する
  Then sqliteClient の query オーバーロードが型エラーになり、更新漏れが検出される

Scenario: Offscreen不在が正しく分類される
  Given Offscreen がクラッシュしている
  When sqliteClient.query({kind:'search', text:'test'}) を呼ぶ
  Then categorizeError が OffscreenUnavailable として分類し、文字列マッチに依存しない

Scenario: traceId 空文字が auditLog を汚さない
  Given traceId なしで mutate({type:'insert', record}) を呼ぶ
  When offscreen 側の auditLog を確認する
  Then traceId='' のレコードが 0 件で、省略または UUID が付与されている
```

## 受け入れ基準
- [ ] `sqliteClient.ts:92-165` のオーバーロードが `Extract<QueryOp, {kind:...}>` / `Extract<MutateOp, {type:...}>` を再利用している（または QueryOp を re-export し satisfies で検証）
- [ ] `callInternal` の catch で型付きエラーを categorizeError に渡し、文字列化はログ出力のみ
- [ ] `count` 異常時 (NaN) が throw ではなく `SqliteRpcResult` の error として返るか 0 フォールバックする
- [ ] `traceId ?? ''` が空文字送信ではなく省略/生成になる

## テスト戦略

### 統合テスト
- sqliteClient と dashboardSqliteHandlers の結合で QueryOp 追加時の型エラー検出テスト
- OffscreenTransport のモックで型付きエラーを throw し分類が正しいことを検証

### 単体テスト
- `query({kind:'count'})` が NaN を返した際のハンドリング
- `mutate` の traceId 省略/生成のユニットテスト

## 見積もり
3pt

## 技術的考慮事項
- 依存関係: なし。ただし 04 の registry とはファイルが分離しているため並列可
- 非機能要件: パフォーマンス影響なし。型安全性向上が主目的

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "isQueryOp\|QueryOp" src/background/sqliteClient.ts src/messaging/
grep -rn "callInternal\|OffscreenCountResponse" src/background/sqliteClient.ts
grep -rn "traceId" src/background/sqliteClient.ts
```

### 実装手順
1. `sqliteClient.ts` の overload を `Extract<QueryOp, ...>` に戻し、`satisfies` テストを追加
2. `callInternal` の catch で `error instanceof OffscreenError` の分岐を保持し、文字列化を遅延
3. `count` の Number.isFinite チェックを Result に変換し、`traceId` は `undefined` 省略に変更

### 落とし穴
- `QueryOp` の `Extract` が複雑で可読性が落ちる。型エイリアス `SearchOp = Extract<QueryOp, {kind:'search'}>` を切る
- Offscreen のレスポンス型が `unknown` に緩和されているため、transform 内で再び厳密に検証する必要がある

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run type-check` で QueryOp 追加時の検出が確認できる
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（必要なら dev-docs/DESIGN で QueryOp の SSOT を明記）
