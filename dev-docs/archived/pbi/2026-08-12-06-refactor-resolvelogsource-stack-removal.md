# PBI: resolveLogSource のスタック依存排除

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**優先度**: 🟢低
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし
**種別**: 🔧非機能追加（refactor）

---

## 背景

`src/utils/logger/api.ts` の `resolveLogSource`（36行）は `new Error().stack` をパースして
呼び出し元モジュール名を推測する。WXT ビルド後は stack frame が chunk 名になり不安定
であり、呼び出し側のスタック形状に依存する（locality の欠如）。source フィールドの
信頼性が低く、呼び出し側が明示的に渡さない限り意味が薄い。

graphify god node 分析の「ロギングがビジネスロジックに漏出」の一例（スタック依存という形）。

## 調査結果：なぜなぜ分析（9回）

1. **Why 1**: なぜ resolveLogSource を排除するのか → new Error().stack パースがバンドル後不安定で、呼び出し側スタックに依存するため。
2. **Why 2**: なぜスタックをパースするのか → 呼び出し側が source を明示渡ししない時に自動付与するため。
3. **Why 3**: 実利用は何箇所か → 調査で判明: resolveLogSource は logger 内部（api.ts の 6 箇所）でのみ使用。外部公開は logger.ts の再 export のみで実呼び出し側はない。
4. **Why 4**: 「明示渡しのみ」にすると何が壊るか → source を渡している呼び出し側（sqliteAlert 等 `_source: 'sqliteAlert'`）は既に明示渡し。渡していない箇所は undefined になり、これまで自動推測されていた source が 'unknown' になる。
5. **Why 5**: source が 'unknown' になることは許容か → セキュリティ監査ログとしては欠落は望ましくないが、実態はバンドル後 chunk 名で役に立っていない。意味のある明示名か unknown かであり、嘘の chunk 名よりマシ。
6. **Why 6**: 推測ロジックを完全削除か隔離か → 削除テスト: resolveLogSource を消すと new Error().stack パースの複雑さが呼び出し側に再出現しない（logger 内部のみ）→ 浅いが保持する価値は薄い。よって完全削除が妥当。
7. **Why 7**: 「ビルド時モジュール名を使う」代替は → import 元モジュール名は静的に決まる。呼び出し側が `logError(msg, details, code, 'sqliteAlert')` と書くのが本来の姿。
8. **Why 8**: extractSourceFromImportMetaUrl は残すか → 純粋な URL→ファイル名変換（テストあり: logger-source.test.ts）。推測には使わないが明示 URL からの変換ユーティリティとして有用。残す。
9. **Why 9**: 結論 → resolveLogSource のスタック自動推測を削除。source は呼び出し側の明示渡しのみ（未渡しは undefined/'unknown'）。extractSourceFromImportMetaUrl は純粋関数として残す。

## 実装内容

1. `api.ts` から `resolveLogSource` 関数を削除
2. `logInfo` / `logWarn` / `logError` / `logDebug` / `logSanitize` / `logCritical` の `resolveLogSource(source)` 呼び出しを `source` のそのまま使用に変更（undefined の場合は undefined のまま）
3. `logger.ts` の再 export から `resolveLogSource` を削除（extractSourceFromImportMetaUrl は残す）
4. `logger-source.test.ts` の resolveLogSource 関連テストを削除・修正（extractSourceFromImportMetaUrl のテストは維持）

## 受け入れ基準

- [ ] `resolveLogSource` が削除され、`new Error().stack` パースが logger から消えている
- [ ] `logInfo` 等の source 引数がそのまま LogEntry.source に設定される（明示渡しの場合は従来通り、未渡しは undefined）
- [ ] `extractSourceFromImportMetaUrl` は純粋関数として維持され、既存テストが通る
- [ ] `logger.ts` の再 export から resolveLogSource が消え、extractSourceFromImportMetaUrl は残っている
- [ ] 既存の全 logger テストが通る

## テスト戦略

- `logger-source.test.ts` を修正: resolveLogSource テスト削除、extractSourceFromImportMetaUrl テスト維持
- 各 log* 関数のテストで source がそのまま設定されることを確認
- スタックパースに依存する挙動のテストが残っていないことを確認

## 非スコープ

- logger の記録機能自体の変更（PBI-1 で扱う）
- logCritical の通知分離（PBI-2 で扱う）
- errorMessage() の統合（PBI-4 で扱う）
- source を「ビルド時自動付与」する別仕組みの導入（YAGNI、明示渡しに統一）
