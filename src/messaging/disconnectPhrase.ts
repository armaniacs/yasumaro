/**
 * disconnectPhrase.ts — 切断文言の SSOT 判定 (PBI 2026-10-05-23)。
 *
 * 中立 wire 層の pure module: background / chrome への依存を持たない。
 * Chrome が切断済み相手への sendMessage に返す2文言だけを受け持ち、
 * 分類 (retriable / offscreen_lost / 注入競合) は呼び出し側のポリシー。
 * NN13 の messageTransport.ts には触れない (競合回避)。
 *
 * 大小無視で照合する: 旧3箇所の表記が割れていた
 * ('Receiving end...' / 'receiving end...') ため、和集合が旧挙動を保つ。
 */
export const DISCONNECT_PHRASES: string[] = [
  'Receiving end does not exist',
  'Could not establish connection',
];

export function isDisconnectMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return DISCONNECT_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()));
}
