/**
 * Luhnアルゴリズムによるクレジットカード番号妥当性検証
 * @param number 検証する番号（文字列または数値）
 * @returns 妥当な場合はtrue
 */
export function validateLuhn(number: string | number): boolean {
    const str = String(number).replace(/\D/g, '');

    if (str.length < 13 || str.length > 19) {
        return false;
    }

    let sum = 0;
    let isEven = false;

    for (let i = str.length - 1; i >= 0; i--) {
        let digit = parseInt(str[i], 10);

        if (isEven) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
        isEven = !isEven;
    }

    return sum % 10 === 0;
}
