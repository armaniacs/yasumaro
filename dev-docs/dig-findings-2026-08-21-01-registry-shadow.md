# なぜなぜ分析 — message-handler-registry-shadow

## 現象
`src/background/handlers/createMessageHandlerRegistry.ts`（deprecated wrapper）と `MessageHandlerRegistry.ts`（旧 shallow registry クラス）が残存。`createBackgroundServices.ts` は同一内容の deps リテラルを2回構築し（168–196行 / 198–226行）、`messageHandler.ts` は `deps.router` 任意＋`registry.dispatch` fallback の二重 dispatch パスを持つ。wrapper は `as unknown as { handlers: Map }` cast で private フィールドを吸い出している。

## 5 Whys
1. なぜ二重構築・二重 dispatch パスが存在するのか → MessageRouter 導入時に旧 registry を「後方互換」として残したため、composition root が両方を構築し続けている
2. なぜ旧 registry が後方互換として残ったのか → service-worker が `registryHandlers`（個別 handler 関数）を export しており、テストがそれに依存していたため、削除より置換が先送りされた
3. なぜ置換が先送りされたのか → 個別 handler への正規アクセス手段（cast 以外）が MessageRouter になく、「削除すると cast で無理やり取り出すコードが必要になる」と見えていたため
4. なぜ cast が必要だったのか → handlers/trustLevels/validators が private であり、observable な accessor が設計されていなかったため
5. なぜ accessor が無設計だったのか → dispatch 1本化が目的とされ、「個別 handler を取り出す需要」（context menu・テスト用 export）が seam 設計時に考慮外だったため

→ 解: (1) `MessageHandler` 型と deps 群を MessageRouter.ts に移設（依存先ファイル削除に備える）、(2) `getHandler(type)` の observable accessor を MessageRouter に追加、(3) createBackgroundServices.ts の deps リテラルを1箇所に統合し `createMessageRouter` のみ呼ぶ、(4) messageHandler.ts を router 必須の単一パスに、(5) service-worker.ts は getHandler 経由で個別 handler を export、(6) 旧2ファイルを git rm、(7) 関連テストを移行。
