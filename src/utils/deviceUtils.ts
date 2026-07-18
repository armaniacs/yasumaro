/**
 * Device detection utilities.
 */

/**
 * Detect whether the given User-Agent string belongs to a mobile device.
 * Defaults to `navigator.userAgent` when called without an argument.
 */
export function isMobileUserAgent(userAgent: string = navigator.userAgent): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
}
