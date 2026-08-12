# PBI: Logger core の関心事分割（buffer/storage/scheduler/sanitize を分離）

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**優先度**: 🔴高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微
**種別**: 🔧非機能追加（refactor）

---

## 背景

graphify 知識グラフ（14,404 nodes / 22,238 edges）の god node 分析により、
ロギング/エラーハンドリング層が全コミュニティに横断的に接続する「橋渡しノード」と
判明。詳細調査の結果、依存逆転（`utils/logger` → `src/background/*`）は存在せず、
真の摩擦は `src/utils/logger/core.ts`（408行）への「関心事の詰め込み」であった。

`core.ts` 単体で以下の関心事を抱える:
- インメモリログバッファ（ring / 上限管理）
- chrome.storage.local への書込み（flush）
- PII サニタイズ（piiSanitizer の再帰ラッパー）
- Service Worker サスペンド時の即時 flush（chrome.runtime.onSuspend）
- chrome.alarms ベースの遅延 flush スケジュール

`errorMessage()` は god node（243 edges）だが 1 行純粋関数であり、本 PBI の対象外
（PBI-4 で扱う）。

## 調査結果：なぜなぜ分析（22回）

1. **Why 1**: なぜ core.ts を分割するのか → 5関心事が詰め込まれ interface が漏れているため。
2. **Why 2**: なぜ interface 漏れが問題か → 159箇所の addLog 呼び出し側がバッファ/flush/サニタイズ/SW挙動を暗黙依存し、実装変更時に呼び出し側を触る必要が出る（locality 欠如）。
3. **Why 3**: なぜ sanitize を adapter 化する案と直接利用案の二択か → piiSanitizer は既に独立モジュールで、core.ts は sanitizeRegex を import して再帰ラッパーを自前実装しているため。
4. **Why 4**: なぜ core.ts は piiSanitizer を直接使わず再帰ラッパーを自前実装するのか → ログ details は任意ネスト・循環参照を含むため、文字列単体用の sanitizeRegex では木をたどれない。深度制限・循環参照検出も logger 側要求。
5. **Why 5**: なぜ piiSanitizer 側を拡張せず logger がラッパを持つか → piiSanitizer は「文字列→マスク」という浅い interface を持ち、オブジェクト木の再帰責任は呼び出し側（logger）にあるという責務境界。
6. **Why 6**: 「sanitize を adapter 化しない」案とは → core.ts から自前再帰を削除し、piiSanitizer のオブジェクト対応API（または薄いヘルパ）に寄せる。縫い目を作らない。
7. **Why 7**: なぜ adapter 化しない案が YAGNI か → サニタイズ実装を「本番/テストで差し替え」る需要がない。マスク挙動はセキュリティ要件でありテストでも常に本物を通すべき。
8. **Why 8**: サニタイズ差し替え需要がないなら adapter 化の利益は何か → 「テスト時にサニタイズ off にして内容検証」だが、それはセキュリティテストで望ましくない（マスク漏れが見えない）。
9. **Why 9**: sanitize adapter 化の真の動機は → 「4関心事を対称に分けて美しくする」ではなく「core.ts から200行の再帰ラッパーを追い出す」こと。adapter 化は二次的。
10. **Why 10**: 追い出すだけなら adapter 化せず内部 module（関数群）で十分か → 十分。adapter は「縫い目で満たす役割」、差し替え需要がなければ内部 implementation。
11. **Why 11**: 「4 adapter」案と「3+内部 module」案の実質差は → 外部からの差し替え可能性のみ。呼び出し側159箇所・外部 interface（addLog）にはどちらも影響なし。
12. **Why 12**: 判断基準は → 「本当に差し替え必要か（one adapter=hypothetical seam, two=real）」。sanitize は実運用で2実装が存在しない → hypothetical seam のままが正しい。
13. **Why 13**: buffer/storage/scheduler は adapter 化してよいか → storage は in-memory fake に差し替え需要あり（実績: logger-*.test.ts が storage をモック）→ real seam。scheduler は即時 flush fake に差し替え需要あり → real seam。buffer は差し替え不要 → 内部 implementation。
14. **Why 14**: 結論 → buffer/sanitize は内部 module、storage/scheduler は adapter。sanitize を adapter 化するのは YAGNI。
15. **Why 15**: なぜ sanitize を piiSanitizer 側に拡張しないか → piiSanitizer は深い module、オブジェクト木再帰は利用者（logger）の関心事。
16. **Why 16**: 分割後の core.ts は何をするか → 各内部 module/adapter を受け取り addLog のオーケストレーションのみ。入力検証→sanitize→buffer push→flush 条件判定を順に呼ぶ。
17. **Why 17**: オーケストレータを core.ts のままにするか新設するか → 既存 import `utils/logger/core.js` 互換のため core.ts 名を維持し、中身をオーケストレータにするのが低リスク。
18. **Why 18**: 既存 export（addLog/getLogs/clearLogs/flushLogs）は維持できるか → 維持。オーケストレータが内部 module を呼ぶだけ。159箇所は一切変更なし（leverage 最大）。
19. **Why 19**: テスト戦略は → 各 adapter（storage/scheduler）に in-memory fake を与えて単体テスト。sanitize は本物を通す。buffer は純粋なので直接検証。
20. **Why 20**: 削除テストに通るか → LogStorageAdapter 削除で「永続化」複雑さが159箇所に再出現（集中）→ 価値あり。LogSanitize 削除でマスク漏れ複雑さが再出現（集中）→ 価値あり。buffer 削除は単なる配列操作で移動するだけ（浅い）→ 内部 module で十分という判断と整合。
21. **Why 21**: Q1 の答え → 「4 adapter」ではなく「storage/scheduler は adapter（real seam）、buffer/sanitize は内部 module（implementation）」のハイブリッド。
22. **Why 22**: このハイブリッドで Strong 評価は維持されるか → 維持。外部 interface 不変・呼び出し側不変という最大 leverage はそのまま。過剰仕様（4 adapter）を避けることで実装コストが下がり着手しやすくなる。

## 実装内容

1. 新規 `src/utils/logger/buffer.ts` — `LogBuffer` 内部 module（in-memory ring、上限管理、getPending/clear）
2. 新規 `src/utils/logger/sanitize.ts` — `LogSanitize` 内部 module（core.ts の sanitizeLogDetails/sanitizeArray を移動、piiSanitizer.sanitizeRegex を直接使用）
3. 新規 `src/utils/logger/storageAdapter.ts` — `LogStorageAdapter` interface + `ChromeStorageLogAdapter`（chrome.storage.local 実装）+ `InMemoryLogAdapter`（テスト用）
4. 新規 `src/utils/logger/flushScheduler.ts` — `LogFlushScheduler` interface + `ChromeAlarmFlushScheduler`（alarms/onSuspend 実装）+ `ImmediateFlushScheduler`（テスト用）
5. `core.ts` をオーケストレータに変更 — `addLog`/`getLogs`/`clearLogs`/`flushLogs` の export は維持、内部で上記 module/adapter を呼ぶ
6. `core.ts` の `chrome.alarms` / `chrome.runtime.onSuspend` リスナ登録を `flushScheduler` の adapter 実装に移動

## 受け入れ基準

- [ ] `addLog` / `getLogs` / `clearLogs` / `flushLogs` の外部 interface とシグネチャが維持されている
- [ ] 既存の 159 箇所の `addLog` 呼び出し側に変更がない（コンパイル・動作ともに現状維持）
- [ ] `LogStorageAdapter` / `LogFlushScheduler` に in-memory fake を与えた単体テストが存在する
- [ ] `LogSanitize` は piiSanitizer の本物を通し、マスク挙動が維持されている（既存 logger-security.test.ts が通る）
- [ ] core.ts が「オーケストレーションのみ」になり、バッファ/ストレージ/スケジューラ/サニタイズの実装が各 file に分離されている

## テスト戦略

- 既存 `logger-*.test.ts`（production / security / enhanced / source）が全て通る
- 新規 `storageAdapter.test.ts` / `flushScheduler.test.ts` で fake adapter による挙動検証
- `buffer.test.ts` で ring 上限・clear の純粋検証

## 非スコープ

- logger の外部 interface（addLog 等）のシグネチャ変更
- errorMessage() の統合（PBI-4 で扱う）
- logCritical の通知分離（PBI-2 で扱う）
- resolveLogSource の削除（PBI-3 で扱う）
