# PBI: ObsidianClient に隠れた純関数バリデータを抽出する

## ユーザーストーリー
開発者として、`ObsidianClient` の `_validateProtocol` / `_validateHost` / `_validatePort` / `_isIpv6Address` / `_readBodyWithTimeout` / `_handleError` が「`this` に依存しない純関数」でありながらクラスの private メソッドとして閉じ込められ、テストが10ファイルにまたがってクラス全体をインスタンス化している状態を解消したい。なぜなら、接続検証だけをテストするのに HTTP・ミューテックスを含むクライアント全体を組み立てる必要があり、`testConnection()` が `_getConfig()` と重複する設定構築を内包しているから。

## ビジネス価値
- バリデータを純関数化し、クラスのフィクスチャなしで直接 import してテストできる
- `appendToDailyNote` / `testConnection` が設定構築を1箇所で共有し、二重実装を排除する
- 呼び出し側が学ぶべき interface が `appendToDailyNote` / `testConnection` の2つに縮小する

## BDD受け入れシナリオ

```gherkin
Scenario: バリデータが純関数として独立する
  Given プロトコル検証が純関数として抽出されている
  When 呼び出し側が validateObsidianProtocol() を実行する
  Then ObsidianClient をインスタンス化せずに結果が返る

Scenario: 接続設定が1箇所で構築される
  Given 設定構築ロジックが単一の関数になっている
  When appendToDailyNote と testConnection が実行される
  Then どちらも同じ設定構築関数を使う
  And インラインでの baseUrl/headers 再構築が存在しない

Scenario: IPv6 ホストの検証
  Given IPv6 アドレスを含むホスト文字列がある
  When ホスト検証を実行する
  Then ブラケット付きで正規化される
  And 不正文字は拒否される
```

## 受け入れ基準
- [ ] `_validateProtocol` / `_validateHost` / `_validatePort` / `_isIpv6Address` が純関数として別モジュールに抽出されている
- [ ] `_readBodyWithTimeout` / `_handleError` がクラス外に抽出されている
- [ ] `testConnection()` のインライン設定構築（`obsidianClient.ts:368-377` 相当）が `_getConfig()` と共有化されている
- [ ] 検証系テスト（`obsidianClient-ipv6.test.ts` / `robustness-port-validation.test.ts` 等）がクライアント全体をインスタンス化せず純関数を直接テストしている
- [ ] 既存の `obsidianClient*.test.ts` 全テストがパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- `appendToDailyNote` / `testConnection` が共有設定構築を経由する統合テスト

### 単体テスト
- 各バリデータ（プロトコル / ホスト / ポート / IPv6）の境界値・不正入力テスト
- `_readBodyWithTimeout` のタイムアウト・ボディ読み取りテスト
- `_handleError` のエラー分類テスト

## 実装アプローチ
- **Outside-In**: まずバリデータの純関数化テストを書き、`ObsidianClient` から委譲する形に変更
- **Red-Green-Refactor**: 抽出は機械的（メソッド本体を関数へ移動し、`this.` 参照を引数化）に進め、テストを green に保つ

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: バリデータは DOM/ネットワーク非依存の純関数にする
- 副作用: 検証ロジックの動作は不変（抽出のみ）。IPv6・ポート検証の既存挙動を契約テストで固定する

## 実装者向け注記

### 現状コードの確認
```bash
# private メソッドの一覧と this 依存を確認
grep -n "_validate\|_isIpv6\|_getConfig\|_readBody\|_handleError\|testConnection" src/background/obsidianClient.ts
# テストがクラス全体をインスタンス化している箇所
grep -rn "new ObsidianClient" src/background/__tests__/obsidianClient*.test.ts | head -20
```

### 現状（2026-08-17 確認済み）
- `obsidianClient.ts:144/172/211/224` に `_validateProtocol` / `_validateHost` / `_isIpv6Address` / `_validatePort` があり、いずれも `this` 依存なし
- `testConnection()`（363行〜）が `override` 引数で `_validateProtocol` / `_validatePort` を呼び、さらに `_getConfig()` を呼ぶ二重経路（368-377行）
- 検証・タイムアウト・セキュリティ・IPv6 など約10ファイルのテストがこの1クラスを対象にしている
- `buildDailyNotePath` は既に別ユーティリティに抽出済み（同パターンの前例）
- 既実装の重複: なし（この PBI は未実装）

### 実装手順
1. `src/utils/obsidianConfigValidator.ts` を新設し、`_validateProtocol` / `_validateHost` / `_validatePort` / `_isIpv6Address` を純関数として移設
2. `_readBodyWithTimeout` を `src/utils/fetch.ts` 系（または専用モジュール）へ移設
3. `_handleError` を純関数化（引数で targetUrl/traceId を受ける）
4. 設定構築を `buildObsidianConfig(settings)` 単一関数に集約し、`_getConfig()` と `testConnection()` の両方から利用
5. `ObsidianClient` はこれらの関数へ委譲する薄いクラスに縮小
6. テストを純関数の直接 import に更新

### 落とし穴
- `_handleError` は「name ベースで下流が検出できる」コメント（`obsidianClient.ts:315` 付近）にある通り、エラー型の分類に依存関係がある。抽出時にエラーの `name`/`message` を変えないこと
- 既存テストは `new ObsidianClient()` 経由で `_` メソッドを呼んでいる可能性が高い。抽出後にテスト側の import を更新する際、振る舞いが変わらないことを確認する
- `testConnection` の `override` パラメータ（protocol/port/apiKey）のセマンティクスを共有設定構築に吸収する際、既存呼び出し元（connectionTests.ts 等）の引数を壊さないこと
- 21箇所の import 元が `ObsidianClient` クラス全体を import している。クラス縮小後も公開 surface（`appendToDailyNote` / `testConnection`）は維持すること

## Definition of Done
- [ ] バリデータが純関数として別モジュールに抽出されている
- [ ] `testConnection()` のインライン設定構築が共有関数化されている
- [ ] 検証系テストがクライアント全体をインスタンス化せず純関数を直接テストしている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
