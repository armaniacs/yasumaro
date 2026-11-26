# 引き継ぎ: 2026-11-24-06 webhook E2E の許可リスト方式への追従

- 状態: 完了。実 UI 経由の確認まで済み・緑
- 最終更新: 2026-11-24
- 対象 PBI: [../2026-11-24-06-fix-webhook-egress-e2e-allowlist.md](../2026-11-24-06-fix-webhook-egress-e2e-allowlist.md)

## 済んだこと

ブランチ `1124a` のコミット 545b6be50(test:)に入っています。変更は `testDir/e2e/webhook-egress.spec.ts` のみ。

- 1 本目(CSP): 許可リスト外(example.com)への fetch が connect-src で遮断されることを確認
- 2 本目(送信ゲート): 実ブラウザでは `chrome.permissions.contains` が example.com に true を返すため、判定は専用許可リストで行われることを固定。`judgeWebhookDestination` の 3 通り(リスト外 / https loopback は許可 / http loopback は非 https)を確認
- 3 本目(保存時 pre-flight、新規): 許可リスト内の保存、新規のリスト外と新規の非 https の拒否(書き込み 0 回)、保存済みでもリスト外は拒否、初期集合の http loopback は祖父条項で保存(verdict は非許可のまま)、空 URL は判定対象外

## 実行方法

E2E は `dist/chromium-mv3` を読むので、先にビルドが必要。

```bash
npm --prefix /Users/yaar/Playground/yasumaro run build
npx --prefix /Users/yaar/Playground/yasumaro playwright test --config /Users/yaar/Playground/yasumaro/testDir/playwright.config.ts /Users/yaar/Playground/yasumaro/testDir/e2e/webhook-egress.spec.ts --reporter=line
```

結果: 3 passed(4.1s)。

## 残り

- なし。2 本目と 3 本目は実 UI(`#webhookExportUrl` → `#webhookExportSaveBtn` → `#webhookExportStatus`)と `chrome.storage.local` を通す形に直し、コミット `a24be47be` で `1124a` に取り込み済み
- webhook パネルの開き方は、2026-11-24-02(開発中機能の判定)の結果で変わる可能性がある
- oxlint は testDir を対象外にしている(No files found)

## 作業記録(2026-11-24)

- `impl-webhook-e2e-ui` ブランチの worktree(`/tmp/yasu-webhook-e2e`、`1124a` 基点)でサブエージェントが実装。コミット `b5c15497b` を `1124a` に cherry-pick して取り込み
- `OW_E2E_PROBE=1` ビルド + `--project=extension` で `webhook-egress.spec.ts` 3 passed。固定 sleep なし。CSP pin と `chrome.permissions.contains` pin は維持
- 本番コードの変更は stale コメント 2 件のみ(`src/dashboard/webhookExportSettings.ts` の `defaultResend` 内、`src/background/webhookExport/webhookExportPayload.ts`)。判定ロジックは不変
- 見送り: `entrypoints/options/index.html` の `webhookExportDescription` 既定文と `messages.json`(en/ja)の文言変更は他テストへの影響を避けるため対象外(監査 run-3 の確認項目に回す)
- 文言照合は en/ja 両対応の正規表現で固定(headed Chromium が OS 言語を継承し当機では `chrome.i18n` が ja 解決のため)。`test.use({ locale: 'en-US' })` は将来の en 環境用に付与
- `npm run validate` は緑。初回はマシン負荷で 2 ファイルが forks worker 起動タイムアウトになったが、再実行で 13 件とも緑(引き継ぎ書の既知の現象)
- worktree と作業ブランチは片付け済み(`git cherry 1124a` で `-` のみを確認してから削除)
