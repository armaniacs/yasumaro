# PBI: 「記録されなかった理由」の可視化

## ユーザーストーリー

毎日Yasumaroを使うユーザーとして、このページが自動記録されなかった理由をポップアップで直ぐに知りたい。なぜなら、理由が分からないと記録の欠落を疑って不安になるから。

## 優先度

- 順位: 1 / 9（全候補）
- RICEスコア: 30.0（Reach=60 / Impact=1 / Confidence=50% / Effort=1.0人週）
- 根拠: 自動記録条件（滞在5秒以上・スクロール50%以上）を満たさない閲覧は「そもそも記録されないため経路を持たない」と docs/DATA_ANALYTICS_GUIDE.md が明記する。「記録されるはずのページが記録されない」という疑問への答えは docs/RECORDING_CONDITIONS.md のFAQにしかなく、ポップアップからは届かない。条件未達・重複（同日同URL）・adaptive記録のゲート拒否はいずれも利用者に見えず、既存の可視化はドメイン遮断理由表（DOMAIN_BLOCKED）と保留ページ管理のみ。疑問の到達範囲が最も広く（Reach=60）、理由の分岐が既存の単一seam `decideStepOutcome()` に集約されているため表示追加だけで済み、Effort最小で最上位。

## ビジネス価値

- 「なぜ記録されないのか」を利用者が自己解決でき、記録の欠落を疑う不安と誤解ベースの問い合わせを減らす
- 表示は理由種別と回数のみのためURL・タイトル・本文を保存せず、軸3「収集を増やさない」と整合する
- 測定方法: E2Eテスト（条件未達ページ閲覧後にポップアップで理由が見える）の緑、既存テスト全緑、手動確認（ポップアップ表示とバッジ通知の整合）

## BDD受け入れシナリオ

```gherkin
Scenario: 条件未達ページのskip理由がポップアップで見える
  Given 滞在5秒未満のページを閲覧して自動記録がskipされた
  When ポップアップを開く
  Then 直近のskip理由「条件未達」が表示される

Scenario: 同日同URL重複の理由が回数つきで見える
  Given 同じURLを同日に2回自動記録しようとした
  When ポップアップを開く
  Then skip理由「同日重複」とその回数が表示される

Scenario: skip理由の保存は理由種別と回数に限る
  Given 条件未達で自動記録がskipされた
  When skip理由の保存内容を確認する
  Then 理由種別と回数のみでURL・タイトル・本文を含まない
```

## 受け入れ基準

- [x] 滞在5秒未満・スクロール50%未満など自動記録条件未達でskipされた場合、ポップアップに理由種別が表示される（contentKernel の beforeunload 配線 + initSkipReasonPanel。src/content/__tests__/contentKernel.skipReason.test.ts、src/popup/__tests__/skipReasonPanel.test.ts）
- [x] 同日同URLの重複skipとadaptive記録のゲート拒否も、理由種別がポップアップに表示される（decideStepOutcome の DuplicateError/PrivatePageError 分岐。src/background/pipeline/__tests__/recordingOutcome-skipReason.test.ts）
- [x] 理由の表示はタブ内トランジェント、または理由種別と回数のみの直近表示に限り、URL・タイトル・本文を保存しない（skipReason.ts の LastSkipReason は reason + count のみ。payload 検証テストで確認）
- [x] 直近skip理由の状態は chrome.storage.session に置かれ、MV3 service worker の再起動をまたいで保持される（SKIP_REASON_SESSION_KEY = 'last_skip_reason'、session 往復テスト13件）
- [x] バッジ通知（青◎/オレンジ!）とskip理由表示が矛盾しない（パネルは中立/警告系配色のステータス面。styles.css .skip-reason-panel、RECORDING_CONDITIONS.md に方針を記載）
- [x] 既存のドメイン遮断理由表（DOMAIN_BLOCKED）と保留ページ管理の表示が壊れない（DOMAIN_BLOCKED はパイプライン以前の拒否のため記録対象外、全テスト緑で確認）

## テスト戦略

### E2Eテスト

- 条件未達ページ閲覧後、ポップアップで理由が見えること（headed は owner 手動でも可）

### 統合テスト

- skip理由の保存と取得の往復（chrome.storage.session をモックし、service worker 再起動をまたぐ保持も確認）

### 単体テスト

- `decideStepOutcome()` の理由分岐の網羅（PrivatePage・Duplicate・FATAL/RETRY・BEST_EFFORT）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
grep -rn "DOMAIN_BLOCKED" src/
grep -rn "decideStepOutcome\|RecordingOutcome" src/background/pipeline/
grep -rn "PRIVATE_PAGE_DETECTED" src/
```

### 実装手順

1. E2E: 条件未達ページ閲覧後にポップアップで理由が見える失敗テストを先に書き、赤を確認する
2. 統合: chrome.storage.session への理由種別・回数の保存と取得の往復テストを書く
3. 単体: `decideStepOutcome()`（src/background/pipeline/recordingOutcome.ts）の理由分岐テストを書く
4. 実装: `decideStepOutcome()` の分岐結果から理由種別を session 層に記録し、ポップアップに表示する。表示はタブ内トランジェント、または理由種別の直近表示（回数/理由種別のみ）に限る

### 落とし穴

- MV3 service worker は無状態のため、直近skip理由の状態は chrome.storage.session に置くこと。APIキー除外の redactSettingsApiKeys と同じ session 層で、src/background/cache/PrivacyCache.ts と src/background/headerDetector.ts が既存の実装例
- 理由と一緒にURL・タイトル・本文を保存しないこと（軸3「収集を増やさない」違反になる）
- バッジ通知（青◎/オレンジ!）と表示が矛盾しないこと。skip理由表示を記録成功扱いの見た目にしない
- 条件未達はパイプライン以前のゲートで決まる場合があるため、`decideStepOutcome()` の分岐だけを見ない。ゲート拒否（src/content/visitGating.ts の adaptive 記録側を含む）の理由種別も同じ層から渡す配線を忘れない

## 見積もり

2pt目安（1.0人週相当）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（条件未達・同日重複・保存範囲の3シナリオを contentKernel.skipReason / recordingOutcome-skipReason / skipReasonPanel / skipReason の4ファイルで網羅）
- [x] コードレビュー完了（セルフレビュー: 受入基準6項目・URL非保存・session層・監査pin・validate）
- [x] ドキュメント更新済み（docs/RECORDING_CONDITIONS.md に「直近のskip理由をポップアップで見る」節とFAQを追記、文字種チェック通過）
