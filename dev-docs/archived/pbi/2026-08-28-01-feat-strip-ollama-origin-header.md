# PBI: Ollama宛リクエストのOriginヘッダー強制削除

## ユーザーストーリー
ローカルAIプロバイダとしてOllamaを利用するユーザーとして、拡張機能からのリクエストでOriginヘッダーが自動的に削除されてほしい、なぜならOllamaのデフォルトCORS設定では拡張機能由来のOriginヘッダーを持つリクエストが拒否され、`OLLAMA_ORIGINS="*"`のようなOllama側の追加設定なしには利用できないから。

## ビジネス価値
- Ollama利用開始までの設定手順が1つ減る（Ollama起動オプション変更が不要になる）
- 「LM Studio/Ollamaを試したが接続できない」という離脱要因を削減できる
- 測定方法: OllamaプロバイダのtestConnection成功率、サポート問い合わせでの「CORS」「Origin」関連の件数

## BDD受け入れシナリオ

```gherkin
Scenario: OllamaのbaseUrlへのリクエストからOriginヘッダーが除去される
  Given ユーザーがAIプロバイダとしてOllama（baseUrl: http://localhost:11434/v1）を設定している
  When  拡張機能がOllamaへチャット補完リクエストを送信する
  Then  そのリクエストにOriginヘッダーが含まれていない

Scenario: OllamaのbaseUrlを変更すると新しいホストにルールが追従する
  Given ユーザーがOllamaのbaseUrlを http://localhost:11434/v1 から http://192.168.1.10:11434/v1 に変更して保存した
  When  拡張機能が新しいbaseUrlへリクエストを送信する
  Then  新しいホスト宛のリクエストからOriginヘッダーが除去されている
  And   旧ホスト（localhost:11434）向けの削除ルールは残存しない
```

## 受け入れ基準
- [x] `chrome.declarativeNetRequest`の動的ルールにより、現在の`OLLAMA_BASE_URL`ホストへの送信リクエストからOriginヘッダーが削除される
- [x] ルールの適用範囲はOllamaのbaseUrlホストのみ（他のローカルプロバイダやObsidian REST APIのリクエストには影響しない）
- [x] サービスワーカー起動時（`onStartup`/`onInstalled`）にルールが登録される
- [x] ユーザーが設定画面でOllamaのbaseUrlを変更・保存した場合、旧ルールが削除され新しいホストに対するルールが再登録される
- [x] `manifest.json`（`wxt.config.ts`生成分）に`declarativeNetRequest`権限が追加されている
- [x] Ollamaプロバイダ以外（LM Studio、Obsidian REST API、クラウドAIプロバイダ）の通信に影響がないことを確認できる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 実際のOllama（またはOllamaのCORSチェックを再現したローカルHTTPサーバー）に対し、拡張機能からリクエストを送信し、サーバー側で受信したヘッダーにOriginが含まれないことを確認する（Playwright + ローカルモックサーバー）

### 統合テスト
- `chrome.declarativeNetRequest`のモックを用い、サービスワーカー起動時に正しいホスト・アクションでルールが登録されることを検証
- baseUrl変更イベント発火時に、旧ルールIDの削除＋新ルールの追加が正しい順序で呼ばれることを検証

### 単体テスト
- baseUrl文字列からホスト名を抽出するロジックの境界値（ポート付き、IPアドレス、末尾スラッシュあり/なし、不正なURL文字列）
- ルール生成関数が期待する`declarativeNetRequest`ルールオブジェクト（`action.type: 'removeHeaders'`, `header: 'Origin'`, `urlFilter`）を返すことの検証
- 例外ハンドリング: `updateDynamicRules`が失敗した場合にログ記録され、拡張機能の他機能をブロックしないこと

## 実装アプローチ
- **Outside-In**: まずE2E（擬似Ollamaサーバーでの受信ヘッダー確認）を書いて失敗を確認 → 統合テスト（ルール登録呼び出しの検証）を書いて失敗を確認 → 単体テスト（ホスト抽出・ルール生成ロジック）を書いて失敗を確認 → 実装
- **Red-Green-Refactor**: 各レイヤーでテスト→実装→リファクタリングを反復
- スパイク的要素: `declarativeNetRequest`の`removeHeaders`アクションが実際にOllama側のCORSチェックを回避できるか、実機Ollamaで早期に検証しておく（不確実性が高いため着手直後に確認すること）

## 見積もり
3ポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。ただし`declarativeNetRequest`権限追加はChromeウェブストアの審査で権限の正当性説明が必要になる可能性がある
- テスタビリティ: `chrome.declarativeNetRequest` APIはJest/Vitest環境でネイティブ動作しないため、モックまたはラッパー関数を介したテストが必要
- 非機能要件: ルール登録・更新はサービスワーカーのライフサイクル（いつでも終了されうる）に影響されないよう、起動のたびに冪等に再登録できる設計にする

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -rn "declarativeNetRequest\|OLLAMA_ORIGINS\|removeHeaders" src/
```
調査済み: 上記いずれも現状ヒットなし。`declarativeNetRequest`権限は`wxt.config.ts`の`permissions`配列に未追加（未実装であることを確認済み）。

### 実装手順（Outside-In順）
1. E2Eレベルで、ローカルにOllama互換の簡易HTTPサーバー（またはCORSチェックを模したExpressサーバー）を立て、Playwrightで拡張機能からリクエストを送信し、サーバー側でOriginヘッダー不在を確認するテストを書く（まず失敗させる）
2. 統合レベルで、`chrome.declarativeNetRequest`をモックし、サービスワーカー起動イベントで期待するルールが登録されることを検証するテストを書く（まず失敗させる）
3. 単体レベルで、baseUrl文字列からホストを抽出する関数と、`declarativeNetRequest`ルールオブジェクトを生成する関数のテストを書く（まず失敗させる）
4. `wxt.config.ts`の`permissions`に`declarativeNetRequest`を追加
5. ホスト抽出関数・ルール生成関数を実装（`src/utils/`配下に新規モジュールとして配置することを推奨。既存の`cspDomains.ts`のホスト定義パターンを参考にする）
6. サービスワーカーの`onStartup`/`onInstalled`ハンドラで、現在の`OLLAMA_BASE_URL`設定値を読み出しルールを登録する処理を追加（`src/background/`配下の既存起動処理に統合）
7. `settingsStore.ts`（`saveSettings`相当）でOllamaのbaseUrlが変更されたことを検知し、旧ルールIDを削除して新ルールを登録する処理を追加
8. 全レイヤーのテストをグリーンにし、リファクタリング

### 落とし穴
- `declarativeNetRequest`の`removeHeaders`は、Chrome側で一部の"unsafe"ヘッダー（`Host`など）を扱えない制限があるが、`Origin`は削除可能な対象なので問題ない想定。実機で早期確認すること
- ルールIDは拡張機能内で一意である必要があるため、固定の定数IDを用意し、baseUrl変更時は必ず同じIDを`removeRuleIds`で指定して置き換えること（IDが被ると`updateDynamicRules`が例外を投げる）
- `urlFilter`はホスト名のみで組み立て、ポート番号を含める場合は`||`記法や正規表現ではなくChromeの`urlFilter`構文の制約に注意する（ワイルドカード指定を誤るとLM StudioやObsidian REST APIなど他のローカルポートにも誤爆する可能性がある）
- サービスワーカーは頻繁に終了・再起動されるため、起動のたびに同じルールを再登録しても副作用がない（冪等な）実装にすること
- テスト環境（Vitest/jsdom）では`chrome.declarativeNetRequest`が存在しないため、`vi.stubGlobal`等で明示的にモックを用意する必要がある

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（`AGENTS.md`のFeature Developmentテーブル、必要なら`dev-docs/ADR/`に権限追加の意思決定を記録）
