export interface StatusInfo {
  domainFilter: {
    allowed: boolean;
    mode: 'disabled' | 'whitelist' | 'blacklist';
    matched: boolean;
    matchedPattern?: string;
  };
  privacy: {
    isPrivate: boolean;
    reason?: 'cache-control' | 'set-cookie' | 'authorization';
    hasCache: boolean;
    piiRisk?: 'high' | 'medium' | 'low';
  };
  cache: {
    cacheControl?: string;
    hasCookie: boolean;
    hasAuth: boolean;
    hasCache: boolean;
  };
  lastSaved: {
    timestamp?: number;
    timeAgo?: string;
    formatted?: string;
    exists: boolean;
  };
}

interface TimeFormat {
  timeAgo: string;
  formatted: string;
}

export function formatTimeAgo(timestamp: number): TimeFormat {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);

  // 相対時間
  let timeAgo: string;
  if (diff < 60 * 1000) {
    timeAgo = 'たった今';
  } else if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    timeAgo = `${minutes}分前`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    timeAgo = `${hours}時間前`;
  } else if (diff < 48 * 60 * 60 * 1000) {
    timeAgo = '昨日';
  } else {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    timeAgo = `${days}日前`;
  }

  // 絶対時間
  const today = new Date(now);
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  let formatted: string;

  if (isToday) {
    formatted = `${hours}:${minutes}`;
  } else {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    formatted = `${month}/${day} ${hours}:${minutes}`;
  }

  return { timeAgo, formatted };
}