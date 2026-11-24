# 引き継ぎ: 2026-11-24-06 webhook E2E の許可リスト方式への追従

- 状態: 一部完了。判定ロジックの E2E は済み・緑。実 UI 経由の確認(PBI の受け入れ基準)は未着手
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

- 2 本目と 3 本目は、src のモジュールを Playwright の Node 側で import して判定関数を呼んでいるだけで、拡張ページ内では動いていない(3 本目は `dashboardPage` を使っていない)。PBI の受け入れ基準どおり、実 UI(`#webhookExportUrl` → `#webhookExportSaveBtn` → `#webhookExportStatus`)と `chrome.storage.local` を通す形に直す
- PBI に書いたビルドの前提(`OW_E2E_PROBE=1`、`extension` プロジェクト、TLS 証明書の pem)を確認し、上の実行方法を合わせる
- webhook パネルの開き方は、2026-11-24-02(開発中機能の判定)の結果で変わる可能性がある
- 3 本目の最後の `WEBHOOK_EXPORT_SETTINGS_KEY` の値チェックは厳密には不要。消すかは任意
- oxlint は testDir を対象外にしている(No files found)
