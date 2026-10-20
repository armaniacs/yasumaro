# PBI 15: cryptoParams スコアリングの SSOT 化（mirror 削除）

## ユーザーストーリー
メンテナーとして、パスワード強度スコアリングが 1 実装になった状態がほしい、なぜなら mirror コメントで同値を約束する複製は、スコア閾値変更のときに片側だけ更新され検証境界と UI 表示が解けるから。

## 変更点の概要
cryptoParams.ts 内部の scorePassword（mirror 実装）をエクスポートし、masterPassword.ts の calculatePasswordStrength をそこへ委譲させる。スコア・レベル・文言は不変。

## 現状と問題
- src/utils/crypto/cryptoParams.ts:20-33（scorePassword、コメント「mirrors masterPassword.ts:calculatePasswordStrength」）と src/utils/masterPassword.ts:28-63（calculatePasswordStrength）が同型複製
- 依存方向は masterPassword.ts:8 が cryptoParams.js を import 済み → スコアリングを cryptoParams 側へ集約すれば循環 import は発生しない（mirror コメントの理由が消える）
- 呼び出し元: cryptoParams.validatePasswordPolicy（:65）、masterPassword.calculatePasswordStrength（dashboard/masterPassword.ts:132、masterPasswordUiCore.ts:63 が使用）
- テスト: cryptoParams.test.ts / masterPassword.test.ts がスコア境界を検証

## 変更の理由
[DRY] スコア閾値（40/80）や文字タイプ加点の変更が 2 箇所に散在すると、検証境界と UI 表示が解ける。1 実装に集約できる。

## 提案コード（骨子）
- cryptoParams.ts: export function scorePassword(password: string): { score: number; level: string }
- masterPassword.ts: calculatePasswordStrength は scorePassword に委譲し、PasswordStrength enum へ変換（text・level は現行と同一）

## BDD受け入れシナリオ
Scenario: スコア境界の等価性
  Given スコア 39/40/79/80 の境界パスワード
  When calculatePasswordStrength を通す
  Then score・level・text は変更前と同一である

Scenario: 検証と UI の整合
  Given validatePasswordPolicy が reject するパスワード
  When calculatePasswordStrength を通す
  Then 両者が同一の scorePassword を参照する（mirror 複製が消える）

## 見積もり
1 pt（RICE: 20 = Reach 5 × Impact 2 × Confidence 1.0 ÷ Effort 0.5 人日）

## DoD
- [x] mirror 複製が消え、1 実装経由になる
- [x] 既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 実ファイルは src/utils/masterPassword.ts（src/utils/crypto/ 配下ではない）。calculatePasswordStrength 内のスコア計算複製（重み 20/10/20/20/30・上限 100・閾値 40/80）を削除し cryptoParams.scorePassword へ委譲。scorePassword をエクスポートし level を PasswordStrengthLevel 型に narrow、masterPassword 側は LEVEL_TO_STRENGTH マップで enum 変換（返り値形・文言不変、依存方向 masterPassword → cryptoParams のまま）
- pin テスト: cryptoParamsSSOT.test.ts に SSOT 等価 describe（境界 8 ケース・同一入力同値・policy 拒否とスコアの一貫性）追加、masterPassword.test.ts にスコア境界 pin 3 件追加（Red/Green 検証済み）
- 検証: 両ファミリー 28 ファイル 446 tests 全 green、type-check 通過、type-check:test:baseline 453 維持、validate:fast green
