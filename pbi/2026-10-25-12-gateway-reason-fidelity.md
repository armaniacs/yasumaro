# PBI: gateway応答の理由保持 ― admission拒否のreason透過（2026-10-25）

## 経緯

PBI 2026-10-23-08（履歴に聞く）の受入基準「縮退・失敗の理由表示と再試行ができる」の検証で発覚。admission拒否の `reason` がgateway正規化で汎用文（`Invalid ASK_HISTORY response`）に置換され、利用者に理由が届かない。契約変更を伴うため本体PBIから分離した。

## 受入基準

- [ ] admission拒否の `reason` が正規化後も保持され、パネルに表示される
- [ ] 既存の gateway 透過テストが緑のままであること

## 備考

- 分離元: [2026-10-23-08-feat-ask-history.md](2026-10-23-08-feat-ask-history.md)（AC4 未チェック）
- 契約変更のため、response 判別共用体・gateway・handler の3点を同時に見直すこと
