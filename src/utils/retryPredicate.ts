const RETRYABLE_NETWORK_MARKERS = [
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'networkerror',
  'connection reset',
  'connection refused',
  'connection closed',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'enetunreach',
  'ehostunreach',
  'etimedout',
];

const TERMINAL_ERROR_MARKERS = [
  'api key',
  'blocked by csp',
  'csp blocked',
  'csp policy',
  'invalid url',
  'configuration',
  'protocol must',
  'port must',
  'host contains',
  'not allowed',
];

function getStringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) {
    return '';
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : '';
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const name = getStringProperty(error, 'name');
  const message = getStringProperty(error, 'message');
  const code = getStringProperty(error, 'code');
  const cause = (error as { cause?: unknown }).cause;
  const causeMessage = typeof cause === 'string'
    ? cause
    : typeof cause === 'object' && cause !== null
      ? `${getStringProperty(cause, 'name')} ${getStringProperty(cause, 'message')} ${getStringProperty(cause, 'code')}`
      : '';
  const text = `${name} ${message} ${code} ${causeMessage}`.toLowerCase();

  if (TERMINAL_ERROR_MARKERS.some((marker) => text.includes(marker))) {
    return false;
  }
  if (name === 'AbortError' || text.includes('timed out')) {
    return true;
  }
  return RETRYABLE_NETWORK_MARKERS.some((marker) => text.includes(marker));
}

export function isRetryableStatus(status: number, retryableStatusCodes: readonly number[]): boolean {
  return retryableStatusCodes.includes(status);
}

export function retryDelayMs(retryIndex: number, initialDelayMs: number, multiplier: number): number {
  return initialDelayMs * Math.pow(multiplier, retryIndex);
}

export async function waitForRetry(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
