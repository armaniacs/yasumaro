const LEVEL1_FIELDS = [
  'api_key', 'apiKey', 'API_KEY',
  'access_token', 'accessToken',
  'refresh_token', 'refreshToken',
  'password', 'passwd',
  'private_key', 'privateKey',
  'client_secret', 'clientSecret',
];

const LEVEL2_FIELDS = [
  'user_id', 'userId',
  'email',
  'ip', 'ipAddress',
  'session_id', 'sessionId',
];

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0]}***@${domain}`;
}

function maskValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;

  if (LEVEL1_FIELDS.includes(key)) {
    return '***';
  }

  if (LEVEL2_FIELDS.includes(key)) {
    if (key === 'email') {
      return maskEmail(value);
    }
    return '***';
  }

  return value;
}

export function maskSensitiveData(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveData(item));
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value);
    } else {
      masked[key] = maskValue(key, value);
    }
  }

  return masked;
}
