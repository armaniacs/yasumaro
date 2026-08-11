# PBI: Handler registryをcomposition rootへ移設する

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**優先度**: 🟡中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微
**種別**: 🔧非機能追加（refactor）

---

## 背景

2026-08-11 アーキテクチャ深深化Epic（PBI-01）の完了時に、「handler registry移設」は
スコープ外として残存した。現在の構成は以下の通り：

- `service-worker.ts:290-318` で `createMessageHandlerRegistry(...)` が**呼び出されて**いる
  （関数定義自体は既に `src/background/handlers/createMessageHandlerRegistry.ts` に分離済み）
- `createBackgroundServices.ts` は services（インスタンス系の長命コラボレータ）の
  composition root だが、handler registry の構築（呼び出し）は含まない

## 調査結果：なぜなぜ分析（20回）

単純に「呼び出しを移動する」だけでは効果が薄いことが判明したため、
根本原因まで遡って解決策を再設計した。

1. **Why 1**: なぜ「registryがcomposition rootに含まれていない」と指摘されるか
   → `createMessageHandlerRegistry` の呼び出しが `service-worker.ts:290` にあるため。
2. **Why 2**: なぜ service-worker.ts で呼んでいるのか
   → 呼び出しに必要な18個の依存（`recordingLogic`, `tabCache`, `obsidian`,
     `aiService`, `notifyAiTestProgress` 等）が service-worker.ts の
     モジュールレベル変数として既に存在するため。
3. **Why 3**: なぜ依存が service-worker.ts のモジュールレベルにあるのか
   → `createBackgroundServices()` の戻り値を分割代入して使っているため
     （124-136行目）。
4. **Why 4**: なぜ `createBackgroundServices()` の戻り値をそのまま
     registry構築に渡さないのか
   → `notifyAiTestProgress`, `hasPrivacyConsent`, `buildAllowedUrls`,
     `getSettings`, `isDomainAllowed`, `clearSettingsCache`,
     `updateActivity`, `lockSession`, `initExportScheduler`,
     `updateConsentBadge` など、`BackgroundServices` の管轄外の
     関数依存（`utils/storage.js` 等のモジュール関数）も必要なため。
5. **Why 5**: なぜこれらが `BackgroundServices` の管轄外なのか
   → `createBackgroundServices.ts` のコメントが明言する通り、
     このモジュールは「長命コラボレータの**インスタンス**」を組み立てる
     DIコンテナであり、副作用のあるモジュール関数（storage等）の
     解決はスコープ外という設計判断がされている。
6. **Why 6**: なぜその設計判断がされているのか
   → インスタンス系（AIService, ObsidianClient, SqliteClient等）と
     関数系（getSettings, hasPrivacyConsent等のユーティリティ）を
     混在させると、`BackgroundServices` インターフェースが
     肥大化し続けるため（実際に18個中10個が関数依存）。
7. **Why 7**: なぜ元Epicで「handler registry移設」がスコープ外とされたのか
   → 2026-08-11時点で `createMessageHandlerRegistry` という
     **関数定義**は既に `handlers/` へ抽出済みであり、
     「移設」の残タスクが「呼び出し位置」なのか「依存解決の設計」
     なのか区別されないまま先送りにされた。
8. **Why 8**: なぜ区別が曖昧なまま先送りされたのか
   → 「関数がservice-worker.ts外に定義されている」＝「移設完了」に
     見えてしまい、呼び出し側の18行にわたる依存注入コードが
     service-worker.tsに残っている実態が見過ごされた。
9. **Why 9**: 呼び出しだけを別ファイルに移すとどうなるか
   → 新モジュールが `notifyAiTestProgress` や `getSettings` を
     再import する必要があり、service-worker.ts側は
     「importして新モジュールの関数に渡す」中継コードに置き換わるだけ。
10. **Why 10**: 中継コードは行数を減らすか
    → 減らない。18個のdepsを渡す記述（290-318行、約28行）が、
      「渡す先の関数名」が変わるだけでほぼ同じ行数のまま残る。
11. **Why 11**: では何が「関心の分離」として意味を持つのか
    → service-worker.ts が「メッセージハンドラの**依存解決ロジック**
      そのもの」を書かなくて済むこと。呼び出し1行 + import 1行に
      圧縮できて初めて「移設」と呼べる。
12. **Why 12**: 依存解決ロジックを別モジュールに完全に移すには何が必要か
    → 関数依存（`hasPrivacyConsent`, `getSettings` 等）を
      その専用モジュール内で直接importする（service-worker.tsを経由しない）。
13. **Why 13**: それは可能か（循環importにならないか）
    → 可能。`hasPrivacyConsent`, `buildAllowedUrls`, `getSettings`,
      `isDomainAllowed`, `clearSettingsCache`, `updateActivity`,
      `lockSession` は全て `src/popup/privacyConsent.js` や
      `src/utils/*` のリーフモジュールであり、service-worker.ts
      にしか依存しない循環はない。
14. **Why 14**: `notifyAiTestProgress` はどう扱うか
    → 既に独立モジュール `aiTestProgressNotifier.ts` にあるため
      そのままimport可能。
15. **Why 15**: `initExportScheduler` / `updateConsentBadge` の
      動的import（`await import(...)`）はどう扱うか
    → これらは循環import回避のため意図的に遅延importされている
      （コメントなしだが `localMarkdownIdleFlusher.js` /
      `consentBadge.js` 経由）。新モジュールに移しても
      同じ動的import構造を保てば問題ない。
16. **Why 16**: `dashboardSqliteHandler` はどうするか
    → これは service-worker.ts 内で `createDashboardSqliteHandler` の
      戻り値として構築される値であり、関数ではない。
      新モジュールへの**引数**として渡す必要がある
      （＝完全に呼び出し0行にはできない）。
17. **Why 17**: 完全に呼び出し0行にできない場合、目標をどう再定義するか
    → 「service-worker.tsから排除する」ではなく、
      「service-worker.tsの責務を "インスタンス系のcomposition
      (`createBackgroundServices`)" と "protocol系のcomposition
      (新設する `createMessageRegistryComposition`)" の**呼び出しのみ**
      に削減する」を目標にする。
18. **Why 18**: 新モジュール名・置き場所はどこが適切か
    → `src/background/handlers/createMessageHandlerRegistry.ts` に
      引数を追加してdeps解決も内包させると、単体テストの依存注入性
      （現在の `MessageHandlerRegistryDeps` インターフェースが
      テストで差し替え可能な設計）が壊れる。
      よって既存ファイルは変更せず、**新規ファイル**
      `src/background/createMessageRegistryComposition.ts` を追加し、
      「production向けdeps解決 → `createMessageHandlerRegistry`呼び出し」
      をラップする。
19. **Why 19**: これでservice-worker.tsは何行減るか
    → 290-318行（28行の deps オブジェクト）が
      `const { registry } = createMessageRegistryComposition({ services, dashboardSqliteHandler: dashboardSqliteMessageHandler, autoSavedBadgeTabs, manualRecordDeps, saveRecordDeps })`
      の1行程度に圧縮される（`services` はcreateBackgroundServices()の
      戻り値をそのまま渡せるため個別分割不要）。
20. **根本原因**: 「移設」というタスク名が「関数定義の場所」を指すのか
      「呼び出し時の依存解決ロジックの場所」を指すのか曖昧だったため、
      前者は既に完了しているにも関わらず未完了と誤認された。
      真に必要なのは、service-worker.ts内に現在も存在する
      **28行の依存解決コード**を、新設する
      `createMessageRegistryComposition.ts` に移し、
      service-worker.ts側の呼び出しを1〜2行に圧縮すること。

## 実装内容（更新）

1. 新規ファイル `src/background/createMessageRegistryComposition.ts` を作成する
   - 引数: `{ services: BackgroundServicesComposition, dashboardSqliteHandler, autoSavedBadgeTabs, initExportScheduler?, updateConsentBadge? }`
     （動的importが必要な2依存は関数として内部で解決してよい）
   - 内部で `hasPrivacyConsent`, `buildAllowedUrls`, `getSettings`,
     `isDomainAllowed`, `clearSettingsCache`, `updateActivity`,
     `lockSession`, `notifyAiTestProgress` を直接importして解決する
   - `createMessageHandlerRegistry(...)` を呼び出し、結果をそのまま返す
2. `service-worker.ts` の290-318行を、新モジュール呼び出し1行に置き換える
3. `handlers/createMessageHandlerRegistry.ts` 自体は変更しない
   （既存の単体テストの依存注入性を維持するため）

## 受け入れ基準

- [ ] `createMessageHandlerRegistry` への**依存解決ロジック**（deps構築の28行）が
      `service-worker.ts` から排除され、新規 composition モジュールに移動している
- [ ] `service-worker.ts` 側の呼び出しが1〜2行に圧縮されている
- [ ] 既存のメッセージハンドラの動作が変わらない
- [ ] 関連するテストが通る（`handlers/__tests__/` の既存テストに加え、
      新モジュールの composition テストを追加する）

## テスト戦略

- 既存の message handler テストが通ることを確認
- 新規 `createMessageRegistryComposition.test.ts` で、production depsから
  正しく registry が構築されることを確認（`createBackgroundServices` の
  contract テストと同様のパターン）
- `service-worker.ts` のテストで registry が正しく登録されることを確認

## 非スコープ

- ハンドラの実装ロジックの変更
- メッセージプロトコルの変更
- 新規ハンドラの追加
- `handlers/createMessageHandlerRegistry.ts` 自体のシグネチャ変更
