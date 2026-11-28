# PBI: encryptionSession.ts (1,128 行) の 3 責務分割 ― golden pin 先行・暗号領域

## ユーザーストーリー
保守担当者として、encryptionSession.ts (1,128 行) の 3 責務 (マスターパスワードライフサイクル・anonymous secret envelope・API キー KEK 再暗号化) を単一セッション核 + 3 モジュールに分割したい、なぜならモジュール可変状態 4 つ (cachedEncryptionKey、cachedMasterPassword、isMasterPasswordRequired、cachedHmacSecret) が「鍵のキャッシュ」と「secret のキャッシュ」で混在し、HMAC secret の envelope 形式変更とマスターパスワードのポリシー変更という別理由の変更が常に 1,128 行のファイルを全面編集するから (holistic レビュー テーマ 3、影響度: 中 | 難易度: 高、ロードマップ最終位)。

## ユーザーへの背景 (レビュー報告書: テーマ 3、file:line 実測)
- 3 責務宣言: encryptionSession.ts:1-6
- モジュール状態: :77-85 (4 つ)
- 変更理由が異なる 3 系統: マスターパスワード (setMasterPassword:645、unlockWithPassword:731、changeMasterPassword:846、verifyMasterPasswordWithRehash:797)、anonymous secret envelope (:187、:214、:243)、API キー KEK 再暗号化 (:403、:429、:507)
- 分割先スケッチ: encryptionSessionCore.ts (核)、masterPasswordLifecycle.ts、anonymousSecretEnvelope.ts、apiKeyReencryption.ts

## ビジネス価値
- 暗号領域のレビュー・テスト範囲が「変更理由ごと」に絞れる
- 測定方法: 4 ファイルへの分割後、外部挙動が完全に不変 (golden pin 全緑)、cycle なしの一方向依存が pin されること

## BDD受け入れシナリオ

```gherkin
Scenario: golden pin が外部挙動不変を担保する
  Given 分割前の 1,128 行モジュールに対する golden pin (全 export の挙動 pin) が存在する
  When 4 ファイルへ分割する
  Then 全 golden pin が緑である (外部挙動不変)

Scenario: 依存は一方向 (cycle なし)
  Given masterPasswordLifecycle / anonymousSecretEnvelope / apiKeyReencryption が Core を import する
  When 依存グラフを検査する
  Then Core が 3 モジュールを import しない (cycle なし、rotation は withPreservedSessionCache 順序契約を保持)
```

## 受け入れ基準
- [ ] src/utils/storage/encryptionSessionCore.ts (核: キャッシュ状態 + getOrCreateEncryptionKey + lock/unlock 状態操作 + withPreservedSessionCache) が存在する
- [ ] masterPasswordLifecycle.ts / anonymousSecretEnvelope.ts / apiKeyReencryption.ts が Core を一方向 import する (cycle なし)
- [ ] byte-identical 移設 (golden pin 先行、全 export 35 個の挙動 pin)
- [ ] 既存 try/catch・fail-closed (verifyPasswordWithPBKDF2 失敗扱い、RotationInProgressError 伝播) は各移設先にそのまま移設
- [ ] 既存 encryptionSession.ts テスト群が緑 (外部挙動不変)
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存 E2E が unlock/lockout 経路を通る)

### 統合テスト
- encryptionSession 既存テスト群 (golden pin として維持、無変更で緑)

### 単体テスト
- 分割後モジュールの純粋契約 (golden pin の補完)、cycle 検出 (依存グラフ pin)

## 見積もり
M (8 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-28-0145-holistic-review-1128a.md テーマ 3 [影響度: 中 | 難易度: 高]、ロードマップ最終位 (暗号領域のため最後)
- 外部挙動: 完全に不変 (byte-identical 移設、golden pin 先行)
- 依存関係: なし (encryptionSession.ts 自身)
- golden pin の手法: PBI 2026-11-26-09 (logImportContract.ts 移設) で採った「移設前 pin → 移動 → 同一 pin」手法
- 前提: rotation は masterPasswordLifecycle と apiKeyReencryption 両方に触れるため、Core に withPreservedSessionCache (:390-402) を置いて順序契約を保持

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '1,6p' src/utils/storage/encryptionSession.ts
sed -n '77,85p' src/utils/storage/encryptionSession.ts
grep -c "export" src/utils/storage/encryptionSession.ts
grep -rn "encryptionSession.js" src/ --include="*.ts" | grep -v test | wc -l
```

### 実装手順
1. golden pin 先行 (全 export 35 個の挙動 pin、現行実装で Green 確認)
2. encryptionSessionCore.ts 新設 (核移設)
3. masterPasswordLifecycle / anonymousSecretEnvelope / apiKeyReencryption 移設 (一方向 import)
4. 既存 encryptionSession.ts は re-export モジュールにする (消費者無変更) または消費者を個別 import に差し替える (消費者数次第で判断し、判断を報告に記録)
5. 全テスト緑、cycle 検出

### 落とし穴
- withPreservedSessionCache (:390-402) は Core に置く (rotation 順序契約)
- try/catch・fail-closed (verifyPasswordWithPBKDF2 失敗扱い、RotationInProgressError 伝播) を移設先にそのまま移す (fail-closed の変更は本 PBI スコープ外)
- cachedHmacSecret は anonymousSecretEnvelope 側に属する (鍵キャッシュと secret キャッシュの分離が本 PBI の要点)
- 暗号領域のため、移設中のセッション整合 (並行呼び出し) が壊れないよう golden pin を段階的に維持する
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了 (セキュリティ関連のため For Security Review Agents 観点を PR 説明に明記)
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: 分割前の 1,128 行モジュールに戻す (1 コミット)
- [ ] ドキュメント更新の要否判定: 内部構造のため docs 更新は不要
