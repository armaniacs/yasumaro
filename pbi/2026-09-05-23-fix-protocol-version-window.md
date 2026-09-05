# PBI: プロトコルバージョン不一致時に段階的移行ウィンドウを設ける

## ユーザーストーリー
拡張機能の利用者として、アップデート前後の混在期間でもメッセージが即座に捨てられず移行してほしい、なぜならコンテンツスクリプトと Service Worker の更新タイミングのずれで一時的にバージョンが食い違うと記録が失われるから

## 優先度
- 順位: 18 / 26
- RICEスコア: 600（Reach=1000 / Impact=2 / Confidence=0.6 / Effort=2.0日）
- 根拠: 全ユーザーに影響する互換性問題だが、現行バージョンが1で不一致が稀なため Confidence は低め。移行ウィンドウの設計・実装に2日を見込む。

## BDD受け入れシナリオ
```gherkin
Scenario: 旧バージョンのメッセージは移行ウィンドウ内では警告付きで受理される
  Given CURRENT_PROTOCOL_VERSION が2に上がり移行ウィンドウが有効な状態
  When  protocolVersion: 1 のメッセージを受信する
  Then  警告ログを記録した上でメッセージが受理される

Scenario: 移行ウィンドウ対象外のバージョンは引き続き拒否される
  Given 移行ウィンドウが直近1世代のみを許容する状態
  When  protocolVersion: 99 のメッセージを受信する
  Then  sendResponse({success: false, error: 'Protocol version mismatch'}) が返される

Scenario: 移行ウィンドウ期限後は旧バージョンも拒否される
  Given 移行ウィンドウの期限が切れた状態
  When  protocolVersion: 1 のメッセージを受信する
  Then  'Protocol version mismatch' で拒否される
```

## 受け入れ基準
- [ ] サポート対象バージョン範囲（例: 直近1世代）が `protocol.ts` 付近の一箇所で宣言されている
- [ ] ウィンドウ内バージョンは受理＋警告ログ、範囲外は従来通り拒否となる
- [ ] 既存の不一致拒否テスト（`envelopePolicy.test.ts`）が新ポリシーに合わせて更新されパスする

## テスト戦略
- 単体: `checkEnvelope` に対し、現行・直前世代・範囲外の3系統の protocolVersion を投入し受理/拒否とログを検証する
- 単体: ウィンドウ期限切れ条件（バージョン定数の切り替え）で旧世代が拒否に戻ることを検証する

## 実装アプローチ
`envelopePolicy.ts` の即時拒否ガードを、許容範囲テーブル（`SUPPORTED_PROTOCOL_VERSIONS` 等）による判定に置き換える。範囲内だが現行でない場合は `logWarn` で移行警告を残し受理、範囲外は従来の拒否応答を維持する。許容世代数と方針は定数コメントに明記する。

## 見積もり
8ポイント（2.0日相当：ポリシー設計・実装・テスト更新が中心）

## 技術的考慮事項
互換性に関わる設計変更のため、メジャーバージョンアップまたはリリースノートでの明記が必要（backlog #17/#18 共通事項）。旧バージョン受理は一時的な移行措置であり、恒久的な多世代サポートに拡大しないこと。

## 実装者向け注記
- 確認済み現状: `src/background/handlers/envelopePolicy.ts:74` が `msg.protocolVersion !== CURRENT_PROTOCOL_VERSION` を即時拒否し、`src/background/messageHandler.ts:41-48` が warn 付きで `sendResponse` する。`validators.ts:99,221` は型チェックのみで値の互換判定はしない
- バージョン定義: `src/messaging/protocol.ts:20`（`CURRENT_PROTOCOL_VERSION = 1`）。`src/content/loader.ts` にハードコード複製あり（protocol.ts の NOTE 参照）
- 既存テスト: `src/background/handlers/__tests__/envelopePolicy.test.ts:46`（不一致拒否）、`src/messaging/__tests__/protocol-sync.test.ts`（定数同期）
- 調査用コマンド: `rg -n "CURRENT_PROTOCOL_VERSION|protocolVersion" src/messaging src/background/handlers src/content/loader.ts`

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（リリースノートに移行ウィンドウ方針を明記）

## 実装メモ

- ウィンドウ定義: `PROTOCOL_VERSION_WINDOW_SIZE = 1`（`src/messaging/protocol.ts` で一箇所宣言、`messageTypes.ts` 経由で再エクスポート）。受理集合は `PROTOCOL_VERSION_POLICY`（`envelopePolicy.ts` の政策テーブル: `{ current, minSupported, windowSize }`）から `classifyProtocolVersion()` で導出。現行→受理、[N-1, N)→`deprecated` 詳細付き受理＋`logWarn`＋応答に `deprecated: true` 付与（`messageHandler.ts`）、範囲外→従来通り拒否（migration/tab-cache 実行前）。欠番（`undefined`）は従来通り受理。
- セキュリティ非弱体化: バージョンゲートのみ段階化し、サイズ上限・trust レベル・スキーム検証・router の trust/strict 順序は不変。拒否は従来と同一位置（pipeline 先頭）で返す。
- N-1 の根拠: 対象の skew は単一アップデートサイクル（旧 content script × 新 SW）のみ。幅広の窓は未検証スキーマ組合せの寿命を延ばすだけでカバレッジが増えず、0 は混在期の記録欠落を再発させる。恒久的多世代サポートに拡大しない（`protocol.ts` コメントに明記）。
