# handoff: 08 正式版前の実機スモークテスト

## 状態
チェックリスト作成済み。実機の実施は未着手(owner が実施する)。

## 作業記録(2026-11-24)

- `dev-docs/manual-tests/release-ga-smoke.md` を作成した(準備・必須 10 フロー・結果記録表・自動テスト対応表・実施ログ)。形式は `docs/MANUAL_TEST_ARCHIVE.md` に合わせ、絵文字なし
- `dev-docs/TESTING_GUIDE.md` の Manual Testing Required からリンクした
- 04 の採番は本 PBI の完了後にのみ行う(台帳と PBI 04 に記載済み)

## 残りの手順(owner が実施)

1. 配布用ビルドを 3 つ作る(`OW_E2E_PROBE=0` を確認してから `npx wxt zip -b chrome|firefox|edge`)
2. ブラウザごとに新しいプロファイルでチェックリストの必須項目を実施する
3. 実施ログに記録する(ブラウザの版、拡張の版、OS、実施日、合否)
4. 不合格は修正 PBI を起票し、修正後に再実施する
5. 全必須項目が合格したら 04 の採番に進む

## 要確認
- なし。実施そのものが owner の作業
