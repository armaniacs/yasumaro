# PBI: gateway応答の理由保持 ― admission拒否のreason透過（2026-10-25）

## 経緯

PBI 2026-10-23-08（履歴に聞く）の受入基準「縮退・失敗の理由表示と再試行ができる」の検証で発覚。admission拒否の `reason` がgateway正規化で汎用文（`Invalid ASK_HISTORY response`）に置換され、利用者に理由が届かない。契約変更を伴うため本体PBIから分離した。

## 受入基準

- [x] admission拒否の `reason` が正規化後も保持され、パネルに表示される ― 2026-10-26確認: handlerが `rejected.reason` を `error` に写して送出（`askHistoryHandlers.ts`）。gatewayは非空白errorを透過するため `privacy_consent_required` 等がそのままパネルに届き、`translateError` で表示される。verify: handler単体＋gateway透過pin緑
- [x] 既存の gateway 透過テストが緑のままであること ― 2026-10-26: ask/gateway/normalize/union の4スイート52件緑。bare `{success:false}`・blank errorの汎用文フォールバックは維持

## なぜなぜ分析（3立場×5回・要旨）

- 利用者: なぜ汎用文では困るか→理由が分からず対処できない→同意なのか制限なのか待てばよいのか判断できない→reasonコード（consent/rate/paused）は対処に直結する→表示必須
- 保守者: なぜhandler1点か→unionは既に `{success:false;error:string}` を許す→gatewayガードは他経路の安全網として維持すべき→admission側の欠落を送出側で補うのが最小→契約変更は不要と確定（PBI記載の3点見直しはhandlerのみで充足）
- 攻撃者/堅牢性: なぜreasonをそのまま出してよいか→値は自コード内の固定3種のみ（外部入力が混入しない）→gatewayはblank/非stringを今も拒否→表示経路はescape済み→注入路なし

## 備考

- 分離元: [2026-10-23-08-feat-ask-history.md](2026-10-23-08-feat-ask-history.md)（AC4 未チェック）
- 契約変更のため、response 判別共用体・gateway・handler の3点を同時に見直すこと → 見直し結果: handlerのみの写しで充足。union・gatewayは無変更（ガード維持）
