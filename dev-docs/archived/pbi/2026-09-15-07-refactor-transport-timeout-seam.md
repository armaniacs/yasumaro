# PBI: Transport timeout/settle の重複除去 — 横断関心を Base に隠す

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、transport の timeout 挙動を1箇所の変更で変えられるようにしたい。なぜなら Chrome と InPage の2つの sendOnce は settled/setTimeout/settle の約25行が一字違いのコピーで、timeout 変更や二重 settle バグの修正が2箇所の同期編集になるから。

## 優先度

- 順位: 2 / 本バッチ3件中
- RICEスコア: 12.0（Reach=3 / Impact=0.5 / Confidence=80% / Effort=0.1人週）
- 根拠: 機械的な重複除去。動作変更リスクは低く、将来の adapter 追加（Safari 等）の雛形になる

## 背景（診断結果）

- `src/background/ChromeOffscreenTransport.ts:66-97` と `src/background/InPageOffscreenTransport.ts:39-82` の `sendOnce` は `settled` フラグ + `setTimeout` + `settle()` が一字違い（エラー文言のみ差分）
- `OffscreenTransportBase.msgOffscreen:64-77` が `invalidateContainer()` を内側 catch と外側 catch で**二重呼び出し**（無害だが interface が重複呼び出しに依存）
- `offscreenTransport.ts:18` が具象 adapter（ChromeOffscreenTransport）を seam interface ファイルから再 export しており、factory を迂回できる抜け道

## 実装ガイド

1. **Base に internal seam を追加**:
   ```ts
   protected sendOnceWithTimeout(
     type: SqliteMessageType,
     invoke: (signal: { settled: boolean; fail: (e: Error) => void; done: (r: OffscreenResponse) => void }) => void
   ): Promise<OffscreenResponse>
   ```
   settled フラグ + timeout + settle を Base が所有し、2つの `sendOnce` は container 固有の invoke（chrome.runtime.sendMessage / handleOffscreenMessage 呼び出し）だけを渡す
2. **`invalidateContainer()` を外側 catch 1箇所に統一**（内側 catch の二重呼び出しを除去）
3. **`offscreenTransport.ts` から `ChromeOffscreenTransport` の再 export を除去**し、テストの import を `./ChromeOffscreenTransport.js` 直に変更（factory 迂回の抜け道を塞ぐ）

## BDD受け入れシナリオ

```gherkin
Scenario: timeout が1箇所の変更で両 transport に効く
  Given Base の sendOnceWithTimeout が timeout を所有する
  When  MESSAGE_TIMEOUT_MS の定数を変更する
  Then  Chrome と InPage の両 transport に反映される

Scenario: 二重 invalidate が起きない
  Given msgOffscreen が noRetry で失敗する
  When  invalidateContainer が呼ばれる
  Then  呼び出しは1回のみ（スパイで確認）
```

## 受け入れ基準

- [x] 2つの sendOnce の settle/setTimeout 重複が Base（`sendOnceWithTimeout`）に移動している
- [x] `invalidateContainer` の呼び出しが失敗パスで1回になっている（内側 noRetry パスの二重呼び出しを解消）
- [x] `offscreenTransport.ts` の具象再 export が除去され、テスト import が `./ChromeOffscreenTransport.js` 直に更新されている
- [x] 全 transport / gateway テスト green（16 passed）

## テスト戦略

- 既存: transport / offscreenGateway テストが回帰網
- 単体: invalidateContainer 呼び出し回数の pin

## 見積もり

0.5日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（Base 先頭コメント）
