/**
 * ports.ts
 * Injectable seams (Clock / StoragePort / AlarmPort) shared by services that
 * previously called `Date.now()` / `chrome.storage` / `chrome.alarms` directly,
 * making them impossible to unit test without a full `chrome` global mock.
 */

export interface Clock {
  now(): number;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
};

/**
 * Minimal subset of chrome.storage.StorageArea used by RateLimitService /
 * SessionAlarmService. Keeping it narrow (get/set/remove) lets tests supply
 * an in-memory implementation without mocking the whole chrome.storage API.
 */
export interface StorageArea {
  get<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface StoragePort {
  local: StorageArea;
  session: StorageArea;
}

export function chromeStorageAreaAdapter(area: chrome.storage.StorageArea): StorageArea {
  return {
    get: <T extends Record<string, unknown>>(keys: string[]) =>
      area.get(keys) as Promise<Partial<T>>,
    set: (items: Record<string, unknown>) => area.set(items),
    remove: (keys: string[]) => area.remove(keys),
  };
}

export const CHROME_STORAGE_PORT: StoragePort = {
  get local() {
    return chromeStorageAreaAdapter(chrome.storage.local);
  },
  get session() {
    return chromeStorageAreaAdapter(chrome.storage.session);
  },
};

/**
 * Minimal subset of chrome.alarms used by SessionAlarmService.
 */
export interface AlarmPort {
  create(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void>;
  clear(name: string): Promise<void>;
  onAlarm(listener: (alarm: { name: string }) => void): void;
}

export const CHROME_ALARM_PORT: AlarmPort = {
  create: (name, alarmInfo) => chrome.alarms.create(name, alarmInfo),
  clear: async (name) => {
    await chrome.alarms.clear(name);
  },
  onAlarm: (listener) => {
    chrome.alarms.onAlarm.addListener(listener);
  },
};
