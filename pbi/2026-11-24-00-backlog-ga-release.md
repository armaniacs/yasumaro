# 台帳: 正式版(GA)リリース準備

2026-11-24 にプロジェクト全体を見渡し、正式版に向けて作成した PBI 群の台帳。
出所: README の機能一覧、PERMISSIONS.md、配布用 manifest(dist/chromium-mv3)、.github/workflows/release.yml、
セキュリティ監査台帳(run-1 / run-2)、将来候補台帳(2026-09-05-00-backlog-future.md)の確認。

## 現状の評価

機能面は正式版として足りている。記録(自動・手動・アドレスバー・ショートカット)、AI 要約(外部 API とブラウザ内蔵 AI)、
Obsidian 連携、ローカル SQLite と全文検索、プライバシー保護(PII マスク、プライベートページ検出、ドメイン別 AI 送信政策)、
暗号化バックアップと復元、全データ削除、3 ストアでの配布がそろっている。
正式版の前に必要なのは新機能ではなく、開発中機能の扱いの決定、直近の変更の仕上げ、配布物の信頼性、最終の監査と実機確認である。

候補から外したもの(確認済み):
- 任意ホスト権限への移動の仕組み: 既に optional_host_permissions(32 件)がある(ADR 2026-03-20-manifest-host-permissions-minimization)
- GitHub Actions の SHA 固定: release.yml は全 action を SHA 固定済み
- セキュリティ監査 run-1 / run-2 の積み残し: すべて完了・アーカイブ済み
- 全データ削除: 実装済み(src/dashboard/panels/staticForm/privacySettingsPanel.ts)

## RICE 採点(同一基準・同一前提)

Reach は正式版利用者への影響範囲(相対 1-10)。Impact は 3=実害解消・必須 / 2=大きい / 1=中 / 0.5=小。
Confidence は 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=要調査。Effort は SP。

| 順位 | 分類 | 候補 | R | I | C | E | RICE | PBI |
|---|---|---|---:|---:|---:|---:|---:|---|
| 01 | 改善 | 開発中 4 機能の正式版での扱いの判定 | 8 | 2 | 0.8 | 2 | 6.4 | [02](2026-11-24-02-feat-ga-dev-feature-graduation.md) |
| 02 | セキュリティ | リリース成果物の SHA256 と provenance | 4 | 2 | 0.8 | 1 | 6.4 | [03](2026-11-24-03-release-artifact-provenance.md) |
| 03 | 改善 | 正式版リリース準備(採番・文書) | 10 | 2 | 1.0 | 2 | 10.0 | [04](2026-11-24-04-release-ga-preparation.md) |
| 04 | 改善 | Obsidian 412 競合の利用者通知 | 5 | 2 | 0.8 | 2 | 4.0 | [05](2026-11-24-05-feat-obsidian-conflict-user-notice.md) |
| 05 | 改善 | webhook E2E の許可リスト方式への追従 | 3 | 1 | 1.0 | 1 | 3.0 | [06](2026-11-24-06-fix-webhook-egress-e2e-allowlist.md) |
| 06 | セキュリティ | 正式版前のセキュリティ監査 run-3 | 10 | 3 | 0.8 | 5 | 4.8 | [07](2026-11-24-07-release-ga-security-audit-run3.md) |
| 07 | 改善 | 正式版前の実機スモークテスト | 10 | 2 | 0.8 | 3 | 5.3 | [08](2026-11-24-08-release-ga-smoke-test.md) |
| 08 | セキュリティ | 必須 host_permissions の最小化 | 8 | 2 | 0.5 | 5 | 1.6 | [09](2026-11-24-09-fix-host-permissions-minimization.md) |
| 09 | 将来 | 端末間の暗号化同期 | 4 | 2 | 0.5 | 13 | 0.3 | [10](2026-11-24-10-backlog-e2e-encrypted-device-sync.md) |
| 10 | 将来 | 過去の記録の再要約 | 5 | 1 | 0.8 | 5 | 0.8 | [11](2026-11-24-11-backlog-resummarize-past-records.md) |
| 11 | 将来 | オプトインの匿名計測基盤 | 10 | 1 | 0.5 | 8 | 0.6 | [12](2026-11-24-12-backlog-opt-in-anonymous-metrics.md) |
| 12 | 将来 | Obsidian 以外のノートアプリへの出力 | 3 | 1 | 0.5 | 8 | 0.2 | [13](2026-11-24-13-backlog-other-note-app-export.md) |

ファイル名の NN は、同日の既存 PBI(01: webhook のサイドバー区分移動、完了)の次から振っているため、順位 + 1 になっている。

## 実行順と逸脱理由

- 01 と 02 は同点。02 はリスク軽減が大きいが、01 は 03(リリース準備)と 07(実機スモーク)の前提なので先に置く
- 03 は最高点だが、ストア掲載文と README の機能一覧が 01 の判定に依存するため 3 位。採番とリリースの実行は 06 と 07 の完了後に限る
- 06(監査)は 07 より点が低いが、コード変更(04・05)の後の最終コードを監査するため、この位置に置く
- 07(実機スモーク)は全コード変更の後の最終ゲート
- 08 は正式版の必須条件にはしない。権限変更は既存利用者に再許可を求める場合があり、正式版と同時に入れると影響の切り分けが難しいため、GA 直後の最初の改善として扱うかを 01 の判定時に決める

## 依存マップ

- 01 → なし(判定材料の収集と記録)
- 02 → なし(.github/workflows/release.yml と docs)
- 03 → 01(機能一覧・掲載文)、06・07(採番とリリース実行のみ)
- 04 → なし
- 05 → なし
- 06 → 04・05(最終コードを対象にする)
- 07 → 01〜06
- 08 → なし(ただし webhook 初期許可集合の pin との結合に注意)
- 09〜12 → 正式版リリース後

## 引き継ぎ

各 PBI の末尾「引き継ぎ」節と、[handoff/](handoff/) 配下の同名ファイルに、進捗・作業ブランチ・残りの手順を記録する。
handoff ファイルが無い PBI は未着手。引き継ぐモデルは、まずこの台帳と handoff ファイルを読むこと。

判定材料の ADR: [dev-docs/ADR/2026-11-24-ga-dev-feature-graduation.md](../dev-docs/ADR/2026-11-24-ga-dev-feature-graduation.md)(提案中、owner の裁定待ち)。04 と 08 はこの ADR を参照すること。

### 状況(2026-11-24 09:39 開始の 15 分実装枠の後)

| PBI | 状態 | コミット(ブランチ 1124a) | handoff |
|---|---|---|---|
| 02 開発中機能の判定 | 完了(裁定済み) | 4088edea4 | [あり](handoff/2026-11-24-02-feat-ga-dev-feature-graduation.md) |
| 03 SHA256 と provenance | 実装済み・実リリースでの確認待ち | 1a9a52c27 | [あり](handoff/2026-11-24-03-release-artifact-provenance.md) |
| 04 リリース準備 | 6.9.77 に採番済み(残りは 08 と提出) | ― | [あり](handoff/2026-11-24-04-release-ga-preparation.md) |
| 05 412 競合の利用者通知 | 実装済み | f3b8df983 | [あり](handoff/2026-11-24-05-feat-obsidian-conflict-user-notice.md) |
| 06 webhook E2E | 完了(実 UI 経由まで) | a24be47be | [あり](handoff/2026-11-24-06-fix-webhook-egress-e2e-allowlist.md) |
| 07 監査 run-3 | 監査完走・修正 15〜19 実装済み | ca6023508 | [あり](handoff/2026-11-24-07-release-ga-security-audit-run3.md) |
| 08 実機スモーク | チェックリスト作成済み。Chrome E2E 全量は実施済み(製品の赤なし)。実機は owner が実施中(Firefox から) | ― | [あり](handoff/2026-11-24-08-release-ga-smoke-test.md) |
| 09〜13 | 未着手(09 は見送り裁定済み) | ― | なし |

### 引き継ぐモデルへの注意

- Agent の worktree は `main` から分岐する。`1124a` にしかない実装(If-Match、webhook 許可リスト、blob-tier reader など)は入っていない。worktree で作業するなら、先に `1124a` を取り込むか、`1124a` から分岐させること
- 各 PBI の「要確認」節に、owner の判断が必要な点が残っている。主なもの:
  - 04: 7.0.0 の位置付け(docs/RELEASE_POLICY.md は v6 系の方針のみ)、Edge / AMO の掲載文の管理場所
  - 07: run-1 の source ref `4790f224` がこのリポジトリの履歴に無い。代わりの起点として、run-1 台帳を追加したコミット `a1e3ffb23` を使う案を書いた
  - 09: content_scripts が `<all_urls>` のため、Chrome では必須権限を減らしても導入時の警告が変わらない可能性が高い。効果を先に確かめ、無ければ止めて判断する
- webhook の説明が古い方式のまま残っている箇所がある(PERMISSIONS.md の Reviewer Notes 2、options の `webhookExportDescription`、`webhookExportSettings.ts` と `webhookExportPayload.ts` のコメント)。07 の洗い出し対象と 06 の落とし穴に記載済み
- AGENTS.md の Release 節の「manifest.json の version bump」は古い(版の元は package.json)。修正は 04 の受け入れ基準に入れた
