# PBI: fetch.ts から SSRF/IP ポリシーを分離する

## ユーザーストーリー
開発者として、`src/utils/fetch.ts`（562行）にHTTP基盤（timeout/retry/abort）とセキュリティポリシー（IP分類・SSRF防止・localhostポート許可）が混在している状態を分離したい。なぜなら、localhostポート許可リストの変更がリトライロジックを壊すリスクがあり、SSRF関数が独立して有用なのにfetchモジュールに結合しているから。

## 優先度
- 順位: 4 / 6
- RICEスコア: 0.67（Reach=4 / Impact=1 / Confidence=50% / Effort=3人日）
- 根拠: Worth exploring（確信50%）。セキュリティ関心の分離は有用だが、既にSSRFは機能しておりモジュール性改善に留まる。既存PBIと重複なし。

## ビジネス価値
- セキュリティポリシー変更がトランスポートコードに触れない
- SSRFガードがfetchモックなしで単体テスト可能に
- 2アダプタ（fetch.ts ＋ 直接caller）がシームを正当化

## BDD受け入れシナリオ

```gherkin
Scenario: SSRFポリシーが独立モジュールに抽出される
  Given fetch.ts に IP分類・URL検証・ALLOWED_LOCALHOST_PORTS が混在している
  When ssrfGuard.ts へ抽出する
  Then fetch.ts が ssrfGuard を import し
  And トランスポートロジック（timeout/retry/abort）のみが残る

Scenario: 抽出前後でセキュリティ判定が一致する
  Given プライベートIP・localhostポート・IPv6の判定テストがある
  When ssrfGuard を単体で実行する
  Then 抽出前の fetch 経由の判定と完全に一致する
```

## 受け入れ基準
- [ ] `ssrfGuard.ts` が新設され、`isPrivateIpAddress`/`isLocalhostAddress`/`normalizeIpHostname`/`validateUrl*`/`ALLOWED_LOCALHOST_PORTS` を保持している
- [ ] `fetch.ts` が `ssrfGuard` をimportしている
- [ ] 既存の `fetch.test.ts` / `fetch-ipv6.test.ts` がパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Obsidian接続・fetch経由の外部通信が従来通り動作する

### 統合テスト
- fetch.ts が ssrfGuard 経由でURL検証することを確認
- 直接caller（recordingValidator/cspValidator等）が共有定数・関数を参照することを確認

### 単体テスト
- `isPrivateIpAddress` のIPv4/IPv6/特殊ホスト名の境界
- `normalizeIpHostname` の正規化（角括弧・大文字小文字）
- `ALLOWED_LOCALHOST_PORTS` の許可/拒否境界

## 実装アプローチ
- **Outside-In**: 既存 `fetch-ipv6.test.ts` の挙動を契約テストで固定してから抽出
- **Red-Green-Refactor**: 関数単位で移動し、グリーンを維持

## 見積もり
3pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- 副作用: セキュリティ判定。抽出後の挙動一致をテストで固定（IPv6・localhost・特殊ホスト名）。セキュリティ関連のためレビュー必須
- テスタビリティ: ssrfGuardは純関数化してfetchモック不要でテスト可能に

## 実装者向け注記

### 現状コードの確認
```bash
# fetch.ts 内のSSRF関連シンボルを確認
grep -n "isPrivateIpAddress\|isLocalhostAddress\|normalizeIpHostname\|validateUrl\|ALLOWED_LOCALHOST_PORTS" src/utils/fetch.ts
# 共有定数を参照する他のモジュールを確認
grep -rn "ALLOWED_LOCALHOST_PORTS" src/ --glob '!**/__tests__/**'
```

### 現状（2026-08-17 確認済み）
- `fetch.ts` 562行。3関心が混在: ネットワーク基盤（fetchWithTimeout/fetchWithRetry ~200行）、URL検証+SSRF（validateUrl/isUrlAllowed ~200行）、IP分類（isPrivateIpAddress/normalizeIpHostname ~160行）
- `ALLOWED_LOCALHOST_PORTS` は `recordingValidator.ts` / `cspValidator.ts` でも参照

### 実装手順
1. `fetch-ipv6.test.ts` 等で現行挙動を契約テストとして固定
2. `ssrfGuard.ts` を新設し、IP分類・URL検証・ALLOWED_LOCALHOST_PORTS を移行
3. `fetch.ts` を ssrfGuard のimportに更新
4. 直接caller（recordingValidator/cspValidator）の import 元を確認・更新
5. 既存テストでグリーンを確認

### 落とし穴
- `validateUrl` 系がfetchフロー内で相互依存している可能性がある（Worth exploringの理由）。シームを切る前に依存グラフを確認
- `ALLOWED_LOCALHOST_PORTS` は複数モジュールが参照する共有定数。移行時に単一ソースを保つ
- IPv6アドレス判定・`normalizeIpHostname` はセキュリティ境界。抽出後も同一判定であることを契約テストで固定

## Definition of Done
- [ ] `ssrfGuard.ts` が新設され、SSRF/IPポリシーが分離されている
- [ ] `fetch.ts` がトランスポートロジックのみを保持している
- [ ] 共有定数・関数の単一ソースが保たれている
- [ ] 既存のfetch/IPv6テストがパスしている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] セキュリティレビュー完了
- [ ] リファクタリング完了（グリーン後）
