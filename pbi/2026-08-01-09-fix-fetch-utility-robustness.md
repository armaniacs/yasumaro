# PBI: fetch ユーティリティの検証と堅牢性を向上する

## ユーザーストーリー
開発者として、`fetchWithTimeout`/`fetchWithRetry` の API が直感的に使え、タイムアウト判定が環境依存せず、SSRF 防御が IPv6 や別形式 IP に対しても機能するようにしたい。

## ビジネス価値
- タイムアウト制御の信頼性向上
- 内部ネットワークへの意図しないアクセスを防ぐ
- デバッグ時の原因特定を容易にする

## BDD受け入れシナリオ

```gherkin
Scenario: timeoutMs オプションが実際に効く
  Given fetchWithTimeout に { timeoutMs: 5000 } を渡す
  When サーバが応答しない
  Then 5秒後にタイムアウトする

Scenario: タイムアウト判定が名前ベース
  Given fetch が AbortError を投げる
  When タイムアウトを検知する
  Then error.name === 'AbortError' で判定する

Scenario: ブラケット付き IPv6 プライベート IP をブロックする
  Given URL が "http://[::1]:8080/"
  When validateUrlForFilterImport を実行する
  Then プライベート IP としてブロックされる

Scenario: localhost ホスト名もブロックする
  Given blockLocalhost: true で "http://localhost:9999" を検証する
  When isPrivateIpAddress を実行する
  Then ブロックされる
```

## 受け入れ基準
- [ ] `timeoutMs` オプションが実際にタイムアウト値として使われる
- [ ] タイムアウト判定が `error.name === 'AbortError'` ベース
- [ ] IPv6 ブラケットを正規化してからプライベート IP 判定
- [ ] `isLocalhostAddress` に `localhost` ホスト名を追加
- [ ] `blockLocalhost` 時に `127.0.0.1`/`localhost` をブロック

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `timeoutMs` テスト
- タイムアウト判定のクロスブラウザケース
- IPv6/localhost 判定テスト

## 実装アプローチ
- **Outside-In**: AI プロバイダーと uBlock インポートの呼び出し側から修正
- **Red-Green-Refactor**: 各バグケースのテストを Red から作成

## 見積もり
2pt

## 技術的考慮事項
- WHATWG URL パーサの IPv6 ブラケット仕様に従う
- `blockLocalhost` の呼び出し元が現状ゼロのため影響範囲を確認

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "timeoutMs\|isPrivateIpAddress\|isLocalhostAddress" src/utils/fetch.ts
```

### 実装手順
1. `fetchWithTimeout` で `options.timeoutMs` を優先
2. タイムアウト判定を `error.name` ベースに
3. `isPrivateIpAddress` にブラケット剥がしを追加
4. `isLocalhostAddress` を拡張

### 落とし穴
- URL 正規化が不完全だと新たなバイパスが生まれる
- `blockLocalhost` を有効化すると既存の動作に影響

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
