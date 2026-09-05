# PBI 12: Content seam の危険箇所マイクロバッチ（引数順 trap・messaging 迂回・dead seam）

優先度: Round 5 2 位 / RICE 12.0 = (4 × 0.5 × 90%) / 0.15w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch5.md](2026-09-05-00-backlog-arch5.md)
依存: なし。ただし **PBI 13 と同一ファイル（`src/utils/contentExtractor/index.ts`）を触るため、必ず本 PBI を先に着地させる**

## ユーザーストーリー
Content script の抽出経路を保守する開発者として、同名 module の引数順 trap・PBI-22 で統一した messaging seam の迂回・consumer ゼロの dead seam が解消されてほしい。なぜなら `watchDynamicContent` は同名 2 signature が生きていて誤用がコンパイルを通らず静かに誤動作し、`CONTENT_CLEANSING_EXECUTED` は Layer 2（utils）の規約に反して生 `chrome.runtime.sendMessage` を hot path の奥で叩き、新設 module は既存 util を再発見できていないから。

## 対象 6 項目（2026-09-05 ファクトチェック済み）

| # | 項目 | 現状 | 判明した事実 |
|---|------|------|-------------|
| 1 | watchDynamicContent 統一 | kernel re-export（`contentKernel.ts:29`、impl 順）と kernel method（`:482-484`、**引数順が逆**）が同居 | **本番消費者ゼロ**。使用者は `contentKernel.dynamic.test.ts` のみ（module 経路 6 ケース＋ kernel 経路 1 ケース） |
| 2 | CONTENT_CLEANSING_EXECUTED 迂回解消 | `utils/contentExtractor/index.ts:296-312` が生 `chrome.runtime.sendMessage` + `.then/.catch` | utils は Layer 2 で chrome-free が規約（LAYERS.md）。kernel には注入済み `MessageSender`（`extractor.ts:63-66` → kernel deps）がある |
| 3 | visitAdmission header 補正 | `visitAdmission.ts:4-8` が「loader と kernel の両方が経由」と主張 | `resolveVisitAdmission` の本番呼び出しは `loader.ts:64` のみ。kernel は経由しない |
| 4 | errorDetail 一本化 | `visitAdmission.ts:93-95` が `instanceof Error ? message : String(e)` を再実装 | `utils/errorUtils.ts` の `errorMessage()` が既存 SSOT（`visitReporter.ts:10` が使用中） |
| 5 | prepareFromOptions 削除 | `pageContentPipeline.ts:77-89` | consumer ゼロ（grep 済み）。「legacy extractor.ts shim」と自己記述するが shim 先は不存在 |
| 6 | cleanseViaOffscreen 二重公開解消 | `pageContentPipeline.ts:22,96` が re-export、`contentKernel.ts:24,473-475` が別経路で公開 | kernel 経路のみが本番使用。pageContentPipeline 側の consumer は実装時に再確認（ゼロなら削除） |

## なぜなぜ分析（設計判断の導出）

**問い 1: なぜ watchDynamicContent に 2 signature が存在するのか**
1. なぜ kernel method が引数順を変えたのか → `onChange` を第一引数に「呼び出し側に優しい」形にした compat wrapper だから。
2. なぜ compat wrapper が不要になったのに残るのか → 「tests + callers use kernel.watchDynamicContent」という header の主張が真になっている間は削除が躊躇われるから。
3. なぜ躊躇われるのか → 本番消費者がゼロであることが誰も確認していないから。
4. なぜゼロのまま誰も気づかないのか → PoC 機能（30-13 SPA 動的コンテンツ監視）で、本番配線がまだ存在しないから。
5. → 解: 消費者ゼロの表面は削除が正。kernel 側（re-export + method）を両方削除し、**impl module（`watchDynamicContent.ts`、impl 順 `(target, onChange, debounceMs)`）に 1 signature で集約**。テストの import を impl module に付け替え。削除テスト: complexity は移動せず消滅する。

**問い 2: なぜ CONTENT_CLEANSING_EXECUTED だけ transport を迂回するのか**
1. なぜ生送信なのか → 抽出 hot path の中で「投げっぱなし」が必要だったから（応答不使用・失敗時はログのみ）。
2. なぜ MessageTransport を import しないのか → 検討段階で utils → messaging → background の推移辺が Layer 規約に触れる懸念があったから（実際 PBI 2026-09-05-01 で utils → background 逆辺は禁止済み）。
3. なぜ懸念で止まったのか → 通知の「発火条件」が抽出内部の状態（実際にクレンジングが走った瞬間）と結合していたから。
4. なぜ結合が問題か → ExtractResult には「実際に削除した」か「recount が候補を数えただけ」かの識別子がない（recount ブロック `:505-545` は totalRemoved === 0 時に countCleanseTargets で totalRemoved を**埋める**）。識別子なしで kernel 側に送ると、recount-only ページで誤って badge を出す。
5. → 解: **ExtractResult に `cleansingExecuted?: boolean` を追加**（実際の削除が起きた branch のみ true）、送信を **contentKernel へ移動**（注入済み `MessageSender` seam 経由、fire-and-forget）。utils は chrome-free を回復し、識別子は interface に明示され、PBI-22 seam が完全着地する。タイミング差（抽出完了直後）は badge 更新が非同期のため挙動同等。

## BDD受け入れシナリオ

```gherkin
Scenario: watchDynamicContent の signature は 1 つだけ
  Given src/content 配下の本番コード
  When  watchDynamicContent の定義箇所を検査する
  Then  watchDynamicContent.ts の (target, onChange, debounceMs) のみで、kernel の re-export も method も存在しない

Scenario: クレンジング実行時に badge 通知が 1 回飛ぶ
  Given クレンジングが有効で要素を削除したページ
  When  contentKernel の抽出フローが完了する
  Then  注入された MessageSender に CONTENT_CLEANSING_EXECUTED が 1 回渡される

Scenario: recount-only ページでは badge 通知を送らない
  Given クレンジングは 0 件で診断 recount が候補を数えたページ
  When  contentKernel の抽出フローが完了する
  Then  CONTENT_CLEANSING_EXECUTED は送信されない（今日の挙動と同一）

Scenario: utils/contentExtractor に chrome 参照がない
  Given src/utils/contentExtractor/index.ts
  When  chrome.runtime 参照を検査する
  Then  ゼロ件になる（Layer 2 規約に適合）
```

## 受け入れ基準
- [x] `contentKernel.ts` から watchDynamicContent の re-export（:29）と method（:482-484）が削除される
- [x] `contentKernel.dynamic.test.ts` の import が `./watchDynamicContent.js` に付け替えられ、kernel 経路の 1 ケースは削除または impl 経由に置換される
- [x] `ExtractResult`（`contentExtractor/types.ts`）に `cleansingExecuted?: boolean` が追加され、実際の削除 branch（candidate path `:266` と body path `:409` の `totalRemoved > 0` 時）のみで true になる
- [x] `utils/contentExtractor/index.ts` の生送信ブロック（:296-312）が削除され、chrome 参照がファイルから消える（`CURRENT_PROTOCOL_VERSION` import も不要になれば削除）
- [x] `contentKernel.ts` が注入済み sender 経由で CONTENT_CLEANSING_EXECUTED を送信する（`cleansingExecuted === true` 時、fire-and-forget、失敗はログのみ）
- [x] `visitAdmission.ts:4-8` の header が「loader のみが経由」の実態に合わせ修正される
- [x] `visitAdmission.ts` の `errorDetail` が `errorMessage()`（errorUtils）に置換される
- [x] `pageContentPipeline.ts` から `prepareFromOptions` が削除される
- [x] `pageContentPipeline.ts` の `cleanseViaOffscreen` re-export が削除される（consumer ゼロ確認後。consumer が見つかれば kernel 経路に付け替え）
- [x] content / utils の既存テスト全 green（`CONTENT_CLEANSING_EXECUTED` の送信テストは kernel レベルに移行）

## テスト戦略（t_wadaスタイル）
### 単体テスト
- kernel 通知テスト新設: cleansingExecuted 時に sender へ 1 回・recount-only で 0 回・cleansing 無効で 0 回
- ExtractResult.cleansingExecuted の matrix（candidate path / body path / whitelist path / recount-only）
### 統合テスト
- 既存 content suite（426+ tests）は無修正で green することを目標に、差分は watchDynamicContent import 付け替えと送信テスト移行のみ
### 例外ハンドリング
- sender が throw しても抽出フローは失敗しない（fire-and-forget・catch 済み）

## 見積もり
0.15w（半日）

## 技術的考慮事項
- 依存関係: なし。ただし PBI 13 と同一ファイルのため先行必須
- テスタビリティ: 通知が kernel の注入 seam に乗るため chrome mock 不要の単体テストになる（interface is the test surface）
- 非機能要件: 送信タイミングが「クレンジング直後」→「抽出完了直後」に変わるが、SW 側 badge 更新は非同期のため観測挙動は同等。bench（c1〜c6）には影響しない（抽出本体の分岐・計測に触れない）
- ADR 整合: ADR 2026-08-20-utils-layer-circular-dependency の精神（utils を chrome-free に保つ）に適合。PBI-22（messaging transport 統一）の完全着地

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "watchDynamicContent" src/content --glob '!**/__tests__/**'
rg -n "chrome" src/utils/contentExtractor/index.ts
rg -n "prepareFromOptions|cleanseViaOffscreen" src --glob '!**/__tests__/**'
sed -n '290,315p' src/utils/contentExtractor/index.ts
sed -n '476,485p' src/content/contentKernel.ts
```

### 実装手順
1. `ExtractResult` に `cleansingExecuted` 追加 → 実際の削除 branch 2 箇所でセット → extractor の chrome ブロック削除
2. contentKernel に通知送信を追加（`this.deps.sender.sendMessageWithRetry({ type: 'CONTENT_CLEANSING_EXECUTED', ... })` の fire-and-forget。`protocolVersion` は MessageTransport が attach するため payload に含めない）
3. index.test.ts の送信テスト（:570）を kernel 通知テストに移行
4. watchDynamicContent の kernel 面 2 件を削除 → dynamic.test.ts の import 付け替え
5. visitAdmission の header 修正 + errorDetail 置換
6. pageContentPipeline の dead seam 2 件を削除（consumer 再確認）

### 落とし穴
- `cleansingExecuted` を「totalRemoved > 0」だけの条件にしないこと（recount が totalRemoved を埋めるため誤検知する）。実際の削除 branch 内でのみ true をセット
- kernel の `sender` は `VisitReporter` の `MessageSender` seam（`sendMessageWithRetry`）。`MessageTransport` を直接 new しない（配線は extractor.ts の composition root にある）
- whitelist path（:186-206）はクレンジングを実行しないため `cleansingExecuted` をセットしない（早期 return の前に変数を初期化しない）
- watchDynamicContent の削除で `contentKernel.ts` の import（:27）も消す。残すのは `watchDynamicContent.ts` のみ

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] content / utils 関連テスト全 green（type-check / lint / build 含む）
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS.md の content 抽出セクションに通知経路の変更を反映。必要なら ARCHITECTURE_MAP.md）

## 実装メモ（2026-09-05・branch 0905c・続）
- 完了（commit `9e99a7a`、SDD サブエージェント実装）。レビュー first-pass Approved。全 suite 11,553 tests green。DESIGN_SPECIFICATIONS §10.3 に通知経路（cleansingExecuted + kernel sender seam）を追記済み。
