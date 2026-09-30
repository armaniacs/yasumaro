# Backlog: adversarial code review ラウンド(2026-09-30)

出典: adversarial code review(対象: encryption 関連モジュール一式 — `encryptionSession.ts` / `apiKeyTransition.ts` / `masterPassword.ts` 2種 / `src/utils/crypto/*` / `SettingsRepository.ts` / `settingsMigration.ts`)

検証ステータス: 発見フェーズで 25 件の指摘が出た後、重大度上位を反証エージェントで検証し、主要な到達可能性の主張は配線コードを直接読んで確認済み。反証で却下された指摘は末尾に記録。

## 優先順位表(RICE)

RICE スコア = (Reach × Impact × Confidence) / Effort
- Reach: 10=全ユーザー(APIキー保持者)〜1=稀な条件にしか晒されない層
- Impact: 3=データ損失・乗っ取り級 / 2=大きい / 1=中 / 0.5=小
- Confidence: 1.0=反証済みで確定 / 0.8=配線確認済みだが実行時未再現
- Effort: 0.25≈1 SP / 0.5≈2 SP / 1.0≈3 SP / 1.5≈5 SP の相対値

| 順 | PBI | type | R×I×C/E | スコア | 根拠 |
|---|------|------|---------|--------|------|
| 1 | [匿名 KEK 再生成の fail-closed 化](2026-09-30-01-fix-anon-kek-regeneration-fail-closed.md) | fix | 3×3×1.0/0.25 | 36.0 | 全 API キー孤立を数時間で塞げる quick win |
| 2 | [set 経路の乗っ取りガード](2026-09-30-02-fix-master-password-set-takeover-guard.md) | fix | 2×3×1.0/0.5 | 12.0 | 旧パスワード不要の乗っ取りを service 層で封じる |
| 3 | [AAD 導入による ciphertext フィールド束縛](2026-09-30-03-fix-encryption-aad-field-binding.md) | fix | 10×2×0.8/1.5 | 10.7 | 効果は全 API キー保持者。envelope 互換 migration で工数大 |
| 4 | [KDF iteration の上下限](2026-09-30-04-fix-kdf-iteration-bounds.md) | fix | 2×1×1.0/0.25 | 8.0 | unlock バイパス+DoS を塞ぐ小修正(同点はリスク軽減で C 優先) |
| 5 | [HMAC キー再生の可視化と consent 取扱い](2026-09-30-05-fix-hmac-key-regeneration-visibility.md) | fix | 5×1×0.8/0.5 | 8.0 | 記録ゲートが黙って止まる可用性問題 |
| 6 | [SW 復号失敗の握りつぶし解消](2026-09-30-06-fix-sw-decryption-lock-propagation.md) | fix | 2×3×0.8/1.0 | 4.8 | マスターパスワード ON 時に AI/Obsidian 保存が機能しない機能バグ |
| 7 | [dashboard checkbox/confirm 欄の UI 状態バグ](2026-09-30-07-fix-dashboard-mp-ui-state-bugs.md) | fix | 2×0.5×1.0/0.25 | 4.0 | 候補2の前提条件になる不整合の解消(同点は G 優先) |
| 8 | [PENDING_SALT のパスワード束縛+ドキュメント整合](2026-09-30-08-fix-pending-salt-password-binding.md) | fix | 2×1×1.0/0.5 | 4.0 | 別パスワード再試行時の恒久詰まり防止 |
| 9 | [ローテーションの相互排他](2026-09-30-09-fix-kek-rotation-cross-context-lock.md) | fix | 2×1×0.8/0.5 | 3.2 | 2 タブ同時操作での API キー損失。発生条件は狭い |
| 10 | [テスト信頼性回復](2026-09-30-10-test-restore-assertion-integrity.md) | test | 1×0.5×1.0/0.25 | 2.0 | 他修正の検証基盤(同点 3 件の先頭) |
| 11 | [死蔵並行実装の削除](2026-09-30-11-refactor-remove-dead-masterpassword-module.md) | refactor | 1×0.5×1.0/0.25 | 2.0 | 誤修正・誤 wiring の防止 |
| 12 | [エクスポート HMAC へ iterations 追加](2026-09-30-12-fix-export-hmac-iterations.md) | fix | 1×1×1.0/0.5 | 2.0 | 攻撃前提かつ利用者層が狭い |
| 13 | [IDB キーストア実装の共通化](2026-09-30-13-refactor-idb-keystore-consolidation.md) | refactor | 1×0.5×1.0/0.5 | 1.0 | 保守性のみ |

## 依存・実装順の注意(スコアより優先)

- 順位 2 → 7 の順で着地(同一ファイル `dashboard/masterPassword.ts`。service ガードを先に入れると UI 側は純粋な UX 修正になる)
- 順位 3 / 8 / 9 は `encryptionSession.ts` 周辺が重なるためバッチを分けて直列着地推奨
- 順位 1・4 は他と接触しない独立 quick win

## 反証で却下された指摘(誤検出の記録)

- `isEncryptionLocked()` が SW 再起動直後に常に false — 因果が誤り。`isMasterPasswordRequired = true`(:127)は throw 前に実行されるため、最初のキー導出試行後に true になる。本番呼び出しもゼロ。
- r2 テストが change モード UI バグを固定 — fixture に `hidden` クラスが最初から無く、assertion(:143)は production 動作と無関係に常に通る空テスト。バグの固定ではない(空振りであること自体は順位 10 の PBI で扱う)。
- エクスポート `iterations:1` でパスワード総当たりが可能 — ciphertext 自体は 600k 固定で暗号化されており、改変 iterations は KDF 候補の順序にしか影響しない。成立するのは import ハング(DoS)のみ。
- removeMasterPassword 中断で「永久に読めない」状態 — `removeMasterPassword` 再実行で全 field が `alreadyMigrated` と判定され自己修復する。恒久破壊ではない。
- PENDING_SALT 残置で「永久 stranding」— 同じ失敗パスワードを再入力すれば `alreadyMigrated` 経由で回復する。恒久喪失ではない(詰まりは実在)。
