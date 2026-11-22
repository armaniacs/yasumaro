# PBI: 2026-11-21-01-refactor-listen-shared-utility

## ユーザーストーリー
開発者として、DOM イベント登録の null ガード＋ティーダウンロジックを共通ユーティリティから呼び出したい。なぜなら、6 ファイルで同一の `listen` 関数が重複定義されており、変更時に修正漏れのリスクがあるから

## ビジネス価値
- 同一ロジックの重複定義を排除し、バグ混入・仕様乖離リスクを低減
- 変更時に 1 か所の修正で全ファイルに反映され、メンテナンス工数を削減
- テスト対象が 1 つに集約され、品質担保が容易になる

## BDD 受け入れシナリオ

```gherkin
Scenario: null 対象に listen を呼んでも例外が発生しない
  Given 存在しない要素 ID を指定して listen を呼び出す
  When   対象が null のままイベント登録を試みる
  Then   例外が発生せず、処理が安全にスキップされる

Scenario: 正常な要素にイベントハンドラが登録される
  Given 存在するボタン要素とクリックハンドラ
  When   listen(要素, 'click', ハンドラ) を呼び出す
  Then   クリック時にハンドラが実行される

Scenario: destroy で登録済みイベントが削除される
  Given listen で登録済みのイベントハンドラがある
  When   destroy（ティーダウン）を実行する
  Then   対象要素からハンドラが削除され、メモリリークが発生しない
```

## 受け入れ基準
- [x] `src/utils/` に共通 `listen(target, type, handler)` ユーティリティを新設（`src/utils/domListen.ts`：`listen` 本体＋`makeListener(teardown)` バインダ。既存3引数呼出を無変更で移行するためバインダ方式を採用）
- [x] 7 ファイル（`recordingConditionsSettings.ts`、`webhookExportSettings.ts`、`exportImport.ts`、`settings/domainFilter.ts`、`settings/privacySettings.ts`、`settings/aiDomainPolicySettings.ts`、および同型 drift のあった `settings/trustSettings.ts`）からローカル定義の `listen` を削除し、共通ユーティリティを import する（呼出43件は無変更）
- [x] 既存のイベント登録・ティーダウン動作がすべて保持される（関連13ファイル240テスト緑）
- [x] `npm run type-check` が pass する
- [x] 対象ファイルに関連する既存テストがすべて pass する（240件）＋新規 `domListen.test.ts` 4件

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（DOM イベント登録の単体レベルで十分）

### 統合テスト
- 各ファイルの init/destroy フローが共通 `listen` を経由して正常に動作することの統合検証

### 単体テスト
- `listen` 関数自体の単体テスト（null 対象、正常登録、ティーダウン、複数登録・削除）
- 各ファイルのイベントハンドラが正しく呼ばれることのモックベース検証

比率: E2E:統合:単体 = 0:1:10

## 実装アプローチ
- **Outside-In**: 各ファイルの既存テスト（失敗を確認）→ 共通 `listen` 実装 → 各ファイルを import に置換 → テストグリーン → リファクタリング
- **Red-Green-Refactor**: TDD サイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
3 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（新規ユーティリティ、既存コードへの影響は import 置換のみ）
- テスタビリティ: `listen` は純粋な DOM ラッパーなので jsdom で容易にテスト可能
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 共通 listen ユーティリティが既に存在しないか確認
grep -rn "export function listen\|export const listen" src/utils/
# 各ファイルのローカル定義を確認
grep -rn "function listen\|const listen" src/dashboard/ src/dashboard/settings/
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。（本 PBI 作成時点で `src/utils/` には存在しないことを確認済み）

### 実装手順
1. `src/utils/domListen.ts` を新設し、共通 `listen(target: EventTarget | null, type: string, handler: EventListener): void` を実装（null チェック → `addEventListener` → ティーダウン配列へ登録）
2. 6 ファイルからローカル定義の `listen` 関数を削除
3. 各ファイルで `import { listen } from '../../utils/domListen.js'`（パスはファイル位置に応じて調整）を追加
4. `npm run type-check` で型エラーがないか確認
5. 対象ファイルに関連する既存テストを実行し、すべて pass することを確認

### 落とし穴
- `EventListenerOrEventListenerObject` と `EventListener` の型差異：共通化時に `EventListener` に統一し、呼び出し側で必要に応じてキャストする
- ティーダウン配列の管理：各ファイルが独自に `teardown` 配列を持っているため、共通 `listen` は登録のみを行い、削除は呼び出し側の既存パターンを維持する（または `remove` 関数も共通化する）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（`domListen.test.ts` 4件：null skip・登録発火・teardown 削除・binder）
- [x] テストカバレッジが基準を満たす（新規 `domListen.ts` は Statements/Branches/Functions/Lines すべて 100%。既存ファイルは振る舞い不変のため既存スイートで担保）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後。振る舞い不変・呼出無変更のため追加の磨き込みなし）
- [x] ロールバック手段の検討（振る舞い不変の置換のため切り戻しは revert のみで足りる）
- [x] ドキュメント更新済み（公開 API・仕様の変更なし。PBI 自体に方式と証跡を記録）
