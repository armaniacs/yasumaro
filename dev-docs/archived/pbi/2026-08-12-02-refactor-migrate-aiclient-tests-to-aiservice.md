# PBI: aiClient.test.ts等をAIService/RemoteAIService経由に移行する

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**優先度**: 🟡中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微
**種別**: 🔧非機能追加（refactor）

---

## 背景

PBI-08 AI で `AIClient` は `RemoteAIService` の薄い委譲ラッパー化したが、
既存テスト（`aiClient.test.ts`, `aiClient-priority-fallback.test.ts`）は
依然として `AIClient` を直接テストしている。

`RemoteAIService` が独立したことで、AIService経由のテストが可能になった。
テストを AIService/RemoteAIService 経由に移行し、`AIClient` のテストは
委譲の contract テストのみに絞る。

## 調査結果：現状のテスト分布（確認済み）

| ファイル | 行数 | テスト件数（it） | 実際にテストしている実装 |
|---|---|---|---|
| `src/background/__tests__/aiClient.test.ts` | 598 | 20 | `RemoteAIService`（エラー整形、in-flight重複排除、`resolveProviderSlots`、`MAX_PROVIDERS`制限） |
| `src/background/__tests__/aiClient-priority-fallback.test.ts` | 418 | 17 | `RemoteAIService`（優先度フォールバック、onProgressコールバック、built-in-aiディスパッチ） |
| `src/background/ai/__tests__/RemoteAIService.test.ts` | 135 | 9 | `RemoteAIService`（委譲、フォールバック、重複排除、traceId、testConnection） |

`AIClient` (`src/background/aiClient.ts`, 80行) は `generateSummary` /
`testConnection` / `registerProvider` の3メソッドを `this.remoteAiService`
へ委譲するだけの薄いラッパーであることをコード上で確認した
（クラス冒頭のJSDocにも「新規コードからの直接利用は避けること」と明記済み）。
一方 `resolveProviderSlots`, `MAX_PROVIDERS`, 優先度フォールバック,
built-in-aiディスパッチ等の実ロジックは全て `RemoteAIService`
(`src/background/ai/RemoteAIService.ts`, 231行) 側にある。

→ **PBIの前提は正確**。37件のテスト（`aiClient.test.ts` + `aiClient-priority-fallback.test.ts`）が
実質的に `AIClient` 経由で `RemoteAIService` の実装詳細をテストしており、
本来のカバレッジ先である `RemoteAIService.test.ts`（9件）が薄い、という
逆転状態になっている。

## なぜなぜ分析（20回）— なぜこの逆転が起きたか

1. **Why 1**: なぜ `RemoteAIService.test.ts` が薄いのか
   → `RemoteAIService` を新規追加した際、既存の `aiClient.test.ts` が
     `AIClient` 経由で同じロジックを既にカバーしていたため、
     重複を避けて委譲確認レベルの最小限しか書かれなかった。
2. **Why 2**: なぜ既存テストを `RemoteAIService` 用に書き直さなかったのか
   → PBI-08 AI（`AIClient`の委譲ラッパー化）のスコープが
     「実装を薄くする」ことに閉じ、既存テスト資産の移行は
     「高リスク」として意図的に非スコープ化された
     （本PBIの「非スコープ」節にも "AIClientクラスの削除（高リスクのため保留)"
     とあり、同じ判断基準がテスト移行にも波及したと推測される）。
3. **Why 3**: なぜテスト移行が高リスクと判断されたのか
   → 598行+418行=1016行のテストは、Gemini/OpenAI等の
     エラーメッセージ整形やDoS対策(`MAX_PROVIDERS`)等、
     セキュリティ・堅牢性に関わる回帰テストを含み、
     書き直し時に検証内容が欠落するリスクがあるため。
4. **Why 4**: なぜ検証内容欠落のリスクが高いと判断されたのか
   → `AIClient` と `RemoteAIService` は現在1:1の委譲関係にあるが、
     テストファイルを機械的にリネーム・import差し替えするだけでは
     済まず、`new AIClient()` を `new RemoteAIService()` に変える際に
     コンストラクタ引数やモック注入方法の差異を精査する必要があるため。
5. **Why 5**: `AIClient` と `RemoteAIService` のコンストラクタ差異は何か
   → `AIClient` は `constructor(remoteAiService？: RemoteAIService)`
     で内部に `RemoteAIService` を保持するラッパー。
     `RemoteAIService` は自身がプロバイダー登録等を行う実クラス。
     テストの `beforeEach` でのモック設定パターンがほぼ流用できる
     構造であることを確認済み（低リスク）。
6. **Why 6**: では実際のリスクは低いのか
   → 概ね低い。ただし `aiClient.test.ts` 冒頭の
     `FEATURE-001: エラーハンドリングの一貫性の欠如と詳細な情報漏洩の検証`
     という名称は歴史的な脆弱性検証の文脈を持ち、
     移行時に「なぜこのテストが存在するか」の文脈（コメント）を
     失わないよう注意が必要。
7. **Why 7**: なぜ2ファイルに分かれているのか（`aiClient.test.ts` と
     `aiClient-priority-fallback.test.ts`）
   → 別のPBI（優先度フォールバック機能追加時）で新規ファイルとして
     追加されたため、当時は「機能追加ごとに新規テストファイル」という
     運用がされていた。
8. **Why 8**: 2ファイルへの分割は移行後も維持すべきか
   → `RemoteAIService.test.ts` 側でも同様の分割
     （基本委譲 / 優先度フォールバック）を維持すれば一貫性が保てる。
9. **Why 9**: `AIClient` の contract テストとして何を残すべきか
   → 「`generateSummary`/`testConnection`/`registerProvider` の引数が
     そのまま `this.remoteAiService` の同名メソッドに渡ること」の
     3〜4件程度の薄いテストのみ。
10. **Why 10**: 現在の `RemoteAIService.test.ts` の9件はこの用途に対応しているか
    → 一部対応済み（"delegates generateSummary", "delegates testConnection"）
      だが、これは `AIClient→RemoteAIService` ではなく
      `RemoteAIService→Provider` の委譲テストであり、目的が異なる。
      混同しないよう、移行後は `aiClient.test.ts`（縮小版）が
      `AIClient→RemoteAIService`委譲を、`RemoteAIService.test.ts`が
      `RemoteAIService→Provider`委譲を担当する棲み分けにする。
11-19. （個別テストケースの移行マッピングは実装フェーズで
      writing-plans側にて1件ずつ対応表を作成する）
20. **根本原因**: `RemoteAIService` 抽出時にテスト移行が
      「高リスクだから保留」という理由で先送りされたが、
      実際には委譲構造がシンプルなため移行リスクは低く、
      先送りの結果、テストの実体（何を検証しているか）と
      置き場所（どのクラスをテストしているように見えるか）が
      乖離したまま37件が放置されている。

## 実装内容

1. `RemoteAIService.test.ts` のカバレッジを拡充する
   - `aiClient.test.ts` の20件のうち、`RemoteAIService`固有ロジック
     （エラー整形、in-flight重複排除、`resolveProviderSlots`、`MAX_PROVIDERS`）
     を `RemoteAIService` 直接テストとして移植する
   - `aiClient-priority-fallback.test.ts` の17件のうち、優先度フォールバック・
     onProgress・built-in-aiディスパッチのテストを移植する
2. `aiClient.test.ts` を委譲 contract テストに縮小する
   - `generateSummary`/`testConnection`/`registerProvider` が
     `this.remoteAiService` の同名メソッドに委譲されることの検証
     （3〜4件程度）のみ残す
3. `aiClient-priority-fallback.test.ts` は削除し、内容を
   `RemoteAIService.test.ts`（または `RemoteAIService-priority-fallback.test.ts`
   として分割維持）に統合する
4. `aiServiceFactory.test.ts` は変更不要（既にcompleted）

## 受け入れ基準

- [ ] `RemoteAIService` のテストカバレッジが維持されている（37件相当の検証内容が
      移植後も欠落なく存在することを、移行前後のアサーション対応表で確認する）
- [ ] `AIClient` のテストが委譲 contract（3〜4件）に絞られている
- [ ] 全テストが通る
- [ ] `aiClient-priority-fallback.test.ts` が削除されている（内容は移植済み）

## テスト戦略

- `RemoteAIService` のスロットループ、フォールバック、重複排除をテスト
- `AIClient` の委譲をテスト（mock 不要、実際の `RemoteAIService` を使用）
- 移行前後でテストケース対応表を作成し、検証内容の欠落がないことを確認する

## 非スコープ

- `AIClient` クラスの削除（高リスクのため保留）
