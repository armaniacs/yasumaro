# 暗号化バックアップ モーダル内進捗表示 デザイン

- 日付: 2026-11-05
- 起点: `Recording_2026-11-05_22-05-58.mp4` (16.9秒)
- 状態: 承認済み (2026-11-05)

## 1. 背景と目的

動画では「暗号化バックアップを作成」→パスワード入力→「確認」を押しても
モーダルが閉じず、文言・スピナー・色の変化がない。複数回「確認」を押しても
反応がなく、動作していないように見える。

調査結果:
- `encryptedBackupService` は `onStage` (`readingDb` / `encrypting` /
  `decrypting` / `restoringDb` / `restoringSettings`) を既に発行するが、
  描画先は背後の `encryptedBackupStatus` のみである。
- モーダル (`passwordAuthModal`) OPEN中は背後がぼかしで覆われ、進捗が見えない。
- モーダル内には進捗要素がなく (`passwordAuthError` のみ)、
  `authenticatePassword` は確認ボタンを `disabled` にするだけで
  ラベル変更・スピナーを出さない。二重ガード
  (`submitBtn.disabled` + `exportInFlight` / `importInFlight`) で
  2回目以降のクリックは静かに捨てられる。
- 検証KDF 600,000回 + DB読出し + 暗号化KDF 600,000回が無表示で走るため、
  数秒の無反応がフリーズに見える。

目的:
- バックアップ実行中にパスワードモーダル内で段階・処理中・失敗理由を
  必ず見せること (作成・復元の両方)。
- どこで止まったか分かること (真のハング切分けの最小観測)。

## 2. スコープ / 非目標

対象:
- `passwordAuthModal` 内の進捗表示とビジー表示。
- 作成 (`readingDb` / `encrypting`) と復元
  (`decrypting` / `restoringDb` / `restoringSettings`) の両経路。
- 最小観測 (段階・経過時間・容量の console 記録と失敗文への付加)。

対象外 (別PBI):
- Envelope形式 (`BACKUP_PAYLOAD_VERSION`) の変更。
- KDF回数 (`PBKDF2_ITERATIONS`) の変更。
- `backupDb` のタイムアウト (10秒)・リトライ (単発) 契約の変更。
- ストリーミング暗号化・上限値・タイムアウト設計。
- 背後 `encryptedBackupStatus` の廃止 (残す)。

## 3. 状態遷移

```
idle (入力可)
  → verifying (確認押下: ボタン disabled + 「処理中...」+ 入力無効化)
  → readingDb → encrypting (作成)
  → decrypting → restoringDb → restoringSettings (復元)
  → success: モーダルを閉じる + 背後 status に成功表示 (従来通り)
  → failure: モーダル維持 + passwordAuthError に理由表示
             + 進捗は失敗段階で停止 (再試行可)
```

- 成功時は従来通りモーダルを閉じる (`authenticatePassword` の close 維持)。
- 失敗時は従来通りモーダルを開けたままにする (安全策の維持)。
- 進捗領域は `aria-live="polite"` + `role="status"` とする。

## 4. 変更範囲

1. `entrypoints/options/index.html`
   - `passwordAuthModal` の `modal-body` 内に次を追加するのみ:
   - `<div id="passwordAuthProgress" role="status" aria-live="polite"></div>`
   - 既存の `passwordAuthError` は残す。順序は入力→進捗→エラーを推奨。

2. `src/dashboard/masterPassword.ts`
   - `MasterPasswordController` に進捗セッターを追加する:
   - `setPasswordAuthProgress(message: string | null): void`
   - `setPasswordAuthBusy(busy: boolean): void` (確認ボタンの
     ラベルを `processing` / `confirm` に切替え + 入力の有効無効)
   - `authenticatePassword` で検証開始時に busy ON・進捗に検証中文言
     (既存 `masterPasswordStageRotating` を `getMessageOr` で解決)、
     `action` 完了・失敗時に busy OFF、成功時 close と同時に進捗クリア。
   - 後方互換の関数 export (`setPasswordAuthProgress` 等) を追加する。
   - 段階文言の対応表は持たない (呼出し側が解決済み文字列を渡す)。

3. `src/dashboard/encryptedBackupPanel.ts`
   - `export` / `import` の `onStage` コールバックで、従来の背後
     `setStatus` に加えて `setPasswordAuthProgress` に同文言を出す。
   - 文言は既存キー再利用 (`backupStageReadingDb` 等 +
     `getMessageOr` フォールバック)。新規i18nキーは作らない。
   - 開始時刻を記録し、logger  seam (`logDebug`) に段階・経過ms・DBバイト数・
     envelope文字数を残す (秘密・パスワードは出さない)。
   - `withBusyButton` の対象は変えない (背後ボタンのまま)。

4. `src/dashboard/encryptedBackupService.ts`
   - 変更なし (`onStage` 発行は現状のまま)。

## 5. エラーハンドリング

- 検証失敗 (パスワード誤り・レート制限): 従来通り `passwordAuthError`、
  進捗はクリアする。
- `action` 例外 (`exportDb` 失敗・`backupDb` タイムアウト・暗号化失敗等):
  `authenticatePassword` の catch が `passwordAuthError` に表示し、
  進捗は失敗段階の文言で停止させる (例: 「履歴DBを読み出しています...」
  で失敗ならその旨 + 経過時間を残す)。
- 成功時: 進捗クリア→モーダル close→背後 `setStatus` 成功表示。
- パスワード保持期間は変えない (モーダル存続中のみ)。

## 6. テスト

- 更新: `src/dashboard/__tests__/encryptedBackupPanel.test.ts`
  - stage発行時にモーダル進捗と背後 status の両方が同文言になること。
- 更新: `src/dashboard/__tests__/masterPassword-branches.test.ts` 系
  - busy中の再入ガード、失敗時にモーダルが残りエラーが出ること、
    成功時に進捗クリア＋closeされること。
- モック方針: 実KDF・実DBは使わない (従来通り service をモック)。
- 手動: 実ビルドで作成・復元を各1回ずつ行い、モーダル内で
  段階が切替わることと、失敗時 (誤パスワード・巨大DB) に
  理由が見えることを動画で再確認する。
- ゲート: `npm run type-check`, `npm run check-i18n`,
  `node scripts/check-docs-chars.mjs`。

## 7. リスクと残課題

- ハング真因 (SW/offscreen側) が別にある場合、本対応では直らない。
  ただし「どこで止まったか」は残るため、次の切分けが容易になる。
- 大容量DBの一括 base64＋JSON化の重さ自体は残る。
  ストリーミング化・上限・タイムアウト再設計は別PBIとする。
- 二重表示 (モーダル内＋背後) が冗長に見える可能性がある。
  今回は両方残し、利用実態を見て背後の整理を検討する。
