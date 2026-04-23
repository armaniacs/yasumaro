import { describe, it, expect } from 'vitest';
import { getScreenState, setScreenState, clearScreenState, SCREEN_STATES } from '../screenState.js';

describe('screenState', () => {
  afterEach(() => {
    clearScreenState();
  });

  it('default state is MAIN', () => {
    expect(getScreenState()).toBe('main');
  });

  it('setScreenState changes state to settings', () => {
    setScreenState('settings');
    expect(getScreenState()).toBe('settings');
  });

  it('setScreenState changes state to main', () => {
    setScreenState('settings');
    setScreenState('main');
    expect(getScreenState()).toBe('main');
  });

  it('clearScreenState resets to MAIN', () => {
    setScreenState('settings');
    clearScreenState();
    expect(getScreenState()).toBe('main');
  });

  it('SCREEN_STATES constants are frozen', () => {
    expect(SCREEN_STATES.MAIN).toBe('main');
    expect(SCREEN_STATES.SETTINGS).toBe('settings');
  });
});
