# バックログ: arch-delivery-loop 0915b — アーキテクチャ診断（2026-09-15 第2回）

第1回診断（archloop-0915・11候補全消化）後の、**未探索領域**（content/visitReporter、crypto/sessionStore、background services）に対する第2回診断（3サブエージェント探索）。8候補を抽出し、上位4件（13〜16）を PBI 化、残り3件は将来候補。

## RICE スコア表（全8候補・同基準）

| スコア順 | 候補 | R | I | C | E(人週) | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | KdfNegotiator — KDF 交渉の3箇所手書き集約 | 3 | 2 | 0.8 | 0.4 | **20.0** | → **PBI 13** |
| 2 | VisitPayload module — 記録ペイロード wire 契約の二重所有解消 | 4 | 2 | 0.8 | 0.4 | **20.0** | → **PBI 14** |
| 3 | alarm 系3つの onAlarm seam 統合 | 3 | 2 | 0.8 | 0.6 | **10.0** | → **PBI 15** |
| 4 | crypto codec/HMAC 統合（atob/btoa 全廃） | 6 | 1 | 0.8 | 0.6 | **8.0** | → **PBI 16** |
| 5 | 合成ルートの二重化解消（compositionManifest 深掘り） | 7 | 2 | 0.5 | 1.0 | 7.0 | 将来候補 |
| 6 | reviewSummary 双子統合 + recordingCache ensureReady | 2 | 1 | 0.5 | 0.4 | 2.5 | 将来候補 |
| 7 | SessionStore durability interface 化 | 3 | 0.5 | 0.5 | 0.4 | 1.9 | 将来候補 |

## 実行順

```
第3ループ（2026-09-15）: 13（KdfNegotiator）→ 14（VisitPayload）→ 15（alarm seam）→ 16（codec/HMAC 統合）
残り（将来候補）: 合成ルート深掘り → reviewSummary → SessionStore の順で再採点
```

## 補足（診断で判明した既存の健全性）

- badgePolicy は深い module として成立（退行なし）
- SessionStore 自体は深い（debounce flush・直列化・quota 退避を所有）
- StorageTransaction / PersistentRetryQueue も深い（CAS + version + post-write verification / TTL + retryCount 所有）
- 直列化プリミティブの4分裂は意図的（Mutex import cycle 回避）— 新規コードは `runSerialized` / `PersistentRetryQueue.mutate` を経由する指針で文書化
