import { maskSensitiveData } from '../logMasker.js';

describe('maskSensitiveData', () => {
  it('masks Level 1 secrets', () => {
    const input = { api_key: 'secret123', access_token: 'token456' };
    const result = maskSensitiveData(input);
    expect(result.api_key).toBe('***');
    expect(result.access_token).toBe('***');
  });

  it('masks Level 2 confidential data', () => {
    const input = { email: 'user@example.com', user_id: '12345' };
    const result = maskSensitiveData(input);
    expect(result.email).toBe('u***@example.com');
    expect(result.user_id).toBe('***');
  });

  it('preserves Level 4 public data', () => {
    const input = { status: 200, timestamp: '2026-07-25T00:00:00Z' };
    const result = maskSensitiveData(input);
    expect(result.status).toBe(200);
    expect(result.timestamp).toBe('2026-07-25T00:00:00Z');
  });

  it('handles nested objects', () => {
    const input = { user: { email: 'test@example.com' }, data: { api_key: 'secret' } };
    const result = maskSensitiveData(input);
    expect(result.user.email).toBe('t***@example.com');
    expect(result.data.api_key).toBe('***');
  });
});
