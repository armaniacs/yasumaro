/**
 * service-worker-message-validation.test.js
 * メッセージ検証強化に関するテスト
 * タスク1: HTTPS通信の強制と権限の最小化
 */

describe('Service Worker: メッセージ検証強化（タスク1）', () => {
  // メッセージ検証用ヘルパー関数（実装後に実際のコードから移動）
  function validateMessage(rawMessage: unknown) {
    const message = rawMessage as { type?: string; payload?: Record<string, unknown> };
    // 必須フィールドのチェック
    if (!message || typeof message !== 'object') {
      return { valid: false, reason: 'Message must be an object' };
    }

    if (!message.type || typeof message.type !== 'string') {
      return { valid: false, reason: 'Message must have a valid type' };
    }

    // 許可されたメッセージタイプのチェック
    const allowedTypes = [
      'VALID_VISIT',
      'MANUAL_RECORD',
      'PREVIEW_RECORD',
      'SAVE_RECORD'
    ];

    if (!allowedTypes.includes(message.type)) {
      return { valid: false, reason: 'Invalid message type' };
    }

    // payloadの検証
    if (!message.payload || typeof message.payload !== 'object') {
      return { valid: false, reason: 'Message must have a payload object' };
    }

    // payloadの必須フィールドチェック（タイプに応じた検証）
    const requiredFields = {
      'VALID_VISIT': ['content'],
      'MANUAL_RECORD': ['title', 'url', 'content'],
      'PREVIEW_RECORD': ['title', 'url', 'content'],
      'SAVE_RECORD': ['title', 'url', 'content']
    };

    const typeSpecificFields = (requiredFields as Record<string, string[]>)[message.type as string] || [];
    for (const field of typeSpecificFields) {
      if (!(field in message.payload)) {
        return { valid: false, reason: `Missing required field: ${field}` };
      }
    }

    // URLの検証（安全なURLのみ）
    if (message.payload.url) {
      try {
        const url = new URL(message.payload.url as string);
        // http/httpsのみ許可
        if (!url.protocol.startsWith('http')) {
          return { valid: false, reason: 'Only http/https URLs are allowed' };
        }
      } catch (e) {
        return { valid: false, reason: 'Invalid URL format' };
      }
    }

    // XSS対策: ユーザー入力の検証
    const payloadString = JSON.stringify(message.payload);
    const xssPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i
    ];

    for (const pattern of xssPatterns) {
      if (pattern.test(payloadString)) {
        return { valid: false, reason: 'Message contains potentially malicious content' };
      }
    }

    return { valid: true };
  }

  describe('validateMessage関数', () => {
    it('validates a valid VALID_VISIT message', () => {
      const message = {
        type: 'VALID_VISIT',
        payload: {
          content: 'Test page content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(true);
    });

    it('validates a valid MANUAL_RECORD message', () => {
      const message = {
        type: 'MANUAL_RECORD',
        payload: {
          title: 'Test Page',
          url: 'https://example.com',
          content: 'Test content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(true);
    });

    it('validates a valid PREVIEW_RECORD message', () => {
      const message = {
        type: 'PREVIEW_RECORD',
        payload: {
          title: 'Test Page',
          url: 'https://example.com',
          content: 'Test content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(true);
    });

    it('validates a valid SAVE_RECORD message', () => {
      const message = {
        type: 'SAVE_RECORD',
        payload: {
          title: 'Test Page',
          url: 'https://example.com',
          content: 'Test content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(true);
    });

    it('rejects a null message', () => {
      const result = validateMessage(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Message must be an object');
    });

    it('rejects a non-object message', () => {
      const result = validateMessage('string');
      expect(result.valid).toBe(false);
    });

    it('rejects a message without a type', () => {
      const message = {
        payload: { content: 'test' }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Message must have a valid type');
    });

    it('rejects a message with a disallowed type', () => {
      const message = {
        type: 'MALICIOUS_TYPE',
        payload: { content: 'test' }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid message type');
    });

    it('rejects a message without a payload', () => {
      const message = {
        type: 'VALID_VISIT'
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
    });

    it('rejects MANUAL_RECORD with missing required fields', () => {
      const message = {
        type: 'MANUAL_RECORD',
        payload: {
          title: 'Test'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
    });

    it('rejects a non-HTTP/HTTPS URL', () => {
      const message = {
        type: 'MANUAL_RECORD',
        payload: {
          title: 'Test',
          url: 'javascript:alert(1)',
          content: 'Test content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Only http/https URLs are allowed');
    });

    it('rejects a data: URL', () => {
      const message = {
        type: 'MANUAL_RECORD',
        payload: {
          title: 'Test',
          url: 'data:text/html,<script>alert(1)</script>',
          content: 'Test content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
    });

    it('rejects a malformed URL', () => {
      const message = {
        type: 'MANUAL_RECORD',
        payload: {
          title: 'Test',
          url: 'not-a-url',
          content: 'Test content'
        }
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid URL format');
    });

    describe('XSS攻撃の検出', () => {
      it('rejects a message containing a script tag', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <script>alert(1)</script> content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Message contains potentially malicious content');
      });

      it('rejects a message containing an onerror handler', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <img onerror="alert(1)" src=x>'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
      });

      it('rejects a message containing the javascript: protocol', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test javascript:alert(1) content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
      });

      it('rejects a message containing an iframe tag', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <iframe src=evil.com></iframe> content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
      });

      it('rejects a message containing an event handler', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <div onclick="alert(1)">Click</div> content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
      });

      it('rejects a message containing an object tag', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <object data=exploit.swf></object> content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
      });

      it('rejects a message containing an embed tag', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <embed src=exploit.swf> content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(false);
      });
    });

    describe('有効なコンテンツの許可', () => {
      it('allows a message with safe HTML tags', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test <p>content</p> with <h1>safe</h1> HTML'
          }
        };

        const result = validateMessage(message);
        // pやh1は危険ではないため許可
        expect(result.valid).toBe(true);
      });

      it('allows a message with plain text', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Just plain text content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(true);
      });

      it('allows a message with a valid HTTP URL', () => {
        const message = {
          type: 'MANUAL_RECORD',
          payload: {
            title: 'Test',
            url: 'http://example.com',
            content: 'Test content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(true);
      });

      it('allows a message with a valid HTTPS URL', () => {
        const message = {
          type: 'MANUAL_RECORD',
          payload: {
            title: 'Test',
            url: 'https://example.com',
            content: 'Test content'
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(true);
      });
    });

    describe('エッジケース', () => {
      it('allows empty string content', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: ''
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(true);
      });

      it('handles a very long string', () => {
        const longContent = 'a'.repeat(100000);
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: longContent
          }
        };

        const result = validateMessage(message);
        expect(result.valid).toBe(true);
      });

      it('allows safe content containing special characters', () => {
        const message = {
          type: 'VALID_VISIT',
          payload: {
            content: 'Test with special chars: < > & " \''
          }
        };

        const result = validateMessage(message);
        // エンコードされた特殊文字は許可
        expect(result.valid).toBe(true);
      });
    });
  });
});

/**
 * 実装推奨事項:
 *
 * 1. service-worker.jsのchrome.runtime.onMessage.addListenerでvalidateMessageを使用
 * 2. 検証に失敗したメッセージは無視する（エラーログはログにのみ記録）
 * 3. sender.tab情報の検証（タブからのメッセージのみ許可）
 * 4. メッセージのサイズ制限（DoS対策）
 */