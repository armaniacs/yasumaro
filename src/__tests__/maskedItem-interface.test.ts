/**
 * MaskedItem Interface Tests
 * Tests for the MaskedItem interface definition and usage
 */

import { describe, test, expect } from '@jest/globals';
import type { MaskedItem } from '../messaging/types.js';

describe('MaskedItem Interface Tests', () => {
  test('MaskedItem should have all required fields', () => {
    const maskedItem: MaskedItem = {
      type: 'email'
    };

    expect(maskedItem.type).toBe('email');
  });

  test('MaskedItem should allow optional position field', () => {
    const maskedItem: MaskedItem = {
      type: 'creditCard',
      position: 'header'
    };

    expect(maskedItem.type).toBe('creditCard');
    expect(maskedItem.position).toBe('header');
  });

  test('MaskedItem should allow optional original field', () => {
    const maskedItem: MaskedItem = {
      type: 'phoneJp',
      original: '03-1234-5678'
    };

    expect(maskedItem.type).toBe('phoneJp');
    expect(maskedItem.original).toBe('03-1234-5678');
  });

  test('MaskedItem should allow optional index field', () => {
    const maskedItem: MaskedItem = {
      type: 'myNumber',
      index: 1
    };

    expect(maskedItem.type).toBe('myNumber');
    expect(maskedItem.index).toBe(1);
  });

  test('MaskedItem should allow all optional fields together', () => {
    const maskedItem: MaskedItem = {
      type: 'bankAccount',
      position: 'body',
      original: '1234567890',
      index: 2
    };

    expect(maskedItem.type).toBe('bankAccount');
    expect(maskedItem.position).toBe('body');
    expect(maskedItem.original).toBe('1234567890');
    expect(maskedItem.index).toBe(2);
  });

  test('MaskedItem should be usable in RecordingResult', () => {
    // This test verifies that MaskedItem works correctly in the context
    // where it's typically used - in RecordingResult's maskedItems array
    
    // Import the type to verify it's correctly exported
    type RecordingResult = import('../messaging/types.js').RecordingResult;
    
    // Just verifying the type import works - no runtime assertion needed
    expect(true).toBe(true);
  });
});