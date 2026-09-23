# バックログ: VulnHunt 監査修正の PBI 化 (2026-09-22)

VulnHunt 監査（`obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/`、confirmed 7件・エクスプロイトテスト 11/11 PASS・sweep 残件 0）の修正戦略を 6 PBI 化し、RICE で並べた。VULN-002+003（同一ファイル群・監査が enabler 関係と明記）と VULN-005+007（validators / commonStorageFields の同一位相）を統合。Code Quality 由来の項目は関連する fix PBI に折り込み、残りは監視対象として 11 に束ねた。

## 採点

共通前提: Reach = 今後1年の利用・保守での関与頻度(相対 1-10) / Impact = 3実害・2大きい・1中・0.5小 / Confidence = 裏取り度（全 confirmed はエクスプロイトテスト PASS 済みで 1.0） / Effort = 週。

| 順位 | PBI | 候補 | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 1 | [2026-09-22-06](2026-09-22-06-fix-obsidian-host-credential-pairing.md) | Obsidian ホスト×保存キー修正 (VULN-001 High) | 8 | 3 | 1.0 | 0.5 | **48** |
| 2 | [2026-09-22-07](2026-09-22-07-fix-provider-baseurl-authorization.md) | プロバイダ baseUrl 認可 (VULN-002 High + VULN-003 Medium) | 8 | 3 | 1.0 | 1 | **24** |
| 3 | [2026-09-22-08](2026-09-22-08-fix-archive-restore-resource-caps.md) | アーカイブ復元上限 (VULN-004 Medium) | 3 | 2 | 1.0 | 0.5 | **12** |
| 4 | [2026-09-22-09](2026-09-22-09-fix-message-field-validation.md) | フィールド検証完全化 (VULN-005 + VULN-007 Low) | 7 | 0.5 | 1.0 | 0.5 | **7.0** |
| 5 | [2026-09-22-10](2026-09-22-10-fix-rate-limiter-domain-key.md) | レート制限キー eTLD+1 化 (VULN-006 Low) | 7 | 0.5 | 1.0 | 0.5 | **7.0** |
| 6 | [2026-09-22-11](2026-09-22-11-backlog-defense-in-depth-hardening.md) | 防御深度ハードニング監視（Code Quality 4項） | 2 | 1 | 0.5 | 1 | **1.0** |

## 依存と再検討トリガー

- 06-10: 相互依存なし（ファイル群が分離）。順位 = RICE 順。
- 07: fail-closed 化の前に `buildAllowedUrls` のシードが必須（シード前に空集合 fail-closed にすると FETCH_URL が全拒否になる）。PBI 内に移行パスを記載済み。
- 09: `commonStorageFields.ts` に 05（extraction ガード）由来の変更が並行走っているため、着手時は rebase 競合に注意。
- 11: 実装ではなく監視契約。個別の発火条件（ssrfGuard の新呼び出し元、Firefox 再利用、staging への第2 principal、レガシー KDF 移行期間終了）を観測した時点で分割 PBI 化する。
- 関連（依存なし）: `2026-09-22-03-backlog-local-provider-origin-rule.md` は CORS Origin-strip の一般化で 07/11 と `ssrfGuard.ts` を共有するが、変更対象行は重ならない。

## 純 RICE 順からの逸脱

なし。09 と 10 の同点 (7.0) はスキルの同点タイブレーク規則（リスク軽減効果: 2 findings を閉じる 09 を上位）で解消したもので、逸脱ではない。
