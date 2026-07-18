# PBI: Content-SWメッセージプロトコルにprotocolVersionを追加

## ユーザーストーリー
開発チームとして、Content ScriptとService Worker間のメッセージにプロトコルバージョンを持たせたい、なぜなら現状はバージョニングが一切なく、拡張機能アップデート時に新旧のcontent scriptとservice workerが混在した場合（タブが更新されずに古いcontent scriptが残るケース）に、メッセージ形式の非互換に気づけないから

## ビジネス価値
- 拡張機能アップデート直後の新旧メッセージ形式混在による予期しないエラーを検出可能にする
- 将来のメッセージ形式変更時の後方互換性判断材料を提供

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/background/messageTypes.ts` — `ExtensionMessage`型（123行目〜）、`VALID_MESSAGE_TYPES`（147行目〜）、`CONTENT_SCRIPT_ONLY_TYPES`（168行目〜）、`NO_PAYLOAD_TYPES`（173行目〜）が定義されている
- 現状、いずれのメッセージ型にも `protocolVersion` フィールドは存在しない
- 対処案（親レポートより）: `protocolVersion` を追加

```bash
# 実装前の必須調査コマンド
sed -n '1,180p' src/background/messageTypes.ts
grep -rn "chrome.runtime.sendMessage\|chrome.tabs.sendMessage" src/content/*.ts src/popup/*.ts --include="*.ts" | grep -v __tests__
```

**設計判断が必要**: `protocolVersion` を追加するだけでなく、受信側でバージョン不一致をどう扱うか（警告ログのみ、拒否、下位互換変換）を決める必要がある。本PBIでは「フィールド追加+不一致時の警告ログ」を最小スコープとし、実際の互換性変換ロジックは将来の別PBIとする。

## BDD受け入れシナリオ

```gherkin
Scenario: 全メッセージにprotocolVersionが付与される
  Given Content ScriptまたはPopupからメッセージを送信する
  When メッセージオブジェクトを構築する
  Then メッセージにprotocolVersionフィールドが含まれる（現行バージョン番号）

Scenario: バージョン不一致のメッセージ受信時に警告ログが記録される
  Given Service Workerが異なるprotocolVersionを持つメッセージを受信する
  When メッセージハンドラが処理を開始する
  Then バージョン不一致を検出し警告ログを記録する
  And 処理自体は（本PBIの範囲では）継続される（拒否はしない）
```

## 受け入れ基準
- [ ] `ExtensionMessage` 型（共通のメッセージ基底型）に `protocolVersion: number` フィールドを追加
- [ ] 現行プロトコルバージョン定数（例: `CURRENT_PROTOCOL_VERSION = 1`）を `messageTypes.ts` に定義
- [ ] Content Script・Popupからのメッセージ送信箇所全てに `protocolVersion` を付与
- [ ] Service Worker側のメッセージ受信処理で、バージョン不一致時に警告ログ（`logWarn`）を記録する

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- メッセージ送信→受信のフローで `protocolVersion` が正しく付与・伝達されることを検証
- バージョン不一致メッセージ受信時に警告ログが記録されることを検証

### 単体テスト
- メッセージ構築ヘルパー（あれば）が `protocolVersion` を自動付与することを検証

## 実装アプローチ
- **Outside-In**: 「バージョン不一致で警告ログが出る」統合テストをRedで書き、フィールド追加と検証ロジック実装でGreenにする

## 見積もり
3pt（半日〜1日。全メッセージ送信箇所への追加が必要なため中規模）

## 技術的考慮事項
- 依存関係: メッセージ送信箇所が多数（popup, content script, dashboard等）に分散している可能性が高く、全箇所の洗い出しが必要
- テスタビリティ: メッセージ構築ロジックが共通ヘルパー化されていれば1箇所の変更で済む
- 非機能要件: なし

## 落とし穴
- 既存のメッセージ送信箇所が共通ヘルパーを経由していない場合（各所で直接 `chrome.runtime.sendMessage({type: ..., payload: ...})` を呼んでいる場合）、全箇所を個別に修正する必要があり工数が膨らむ可能性がある。実装前に共通ヘルパーの有無を確認し、なければ先に共通化するステップを挟むことを検討する

## Definition of Done
- [ ] `protocolVersion` フィールドが型定義に追加されている
- [ ] 全メッセージ送信箇所で付与されている
- [ ] バージョン不一致時の警告ログが実装されている
- [ ] 単体・統合テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
