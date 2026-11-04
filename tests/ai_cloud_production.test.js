import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCloudEndpoint, aiService } from '../src/services/aiService.js';
import app from '../src/app.js';

describe('Production Deployment & Cloud AI Verification Suite', () => {

  // =========================================================================
  // 1. Express Proxy Configuration
  // =========================================================================
  test('1. Express app has trust proxy enabled for Render / reverse proxies', () => {
    assert.strictEqual(
      app.get('trust proxy'),
      1,
      "Express 'trust proxy' must be set to 1 to prevent ERR_ERL_UNEXPECTED_X_FORWARDED_FOR"
    );
  });

  // =========================================================================
  // 2. Cloud AI Endpoint URL Normalization
  // =========================================================================
  test('2a. resolveCloudEndpoint normalizes Groq base URL correctly', () => {
    const ep1 = resolveCloudEndpoint('https://api.groq.com/openai/v1', 'groq');
    assert.strictEqual(ep1, 'https://api.groq.com/openai/v1/chat/completions');

    const ep2 = resolveCloudEndpoint('https://api.groq.com/openai/v1/', 'groq');
    assert.strictEqual(ep2, 'https://api.groq.com/openai/v1/chat/completions');
  });

  test('2b. resolveCloudEndpoint handles bare domain without duplicating paths', () => {
    const ep = resolveCloudEndpoint('https://api.groq.com', 'groq');
    assert.strictEqual(ep, 'https://api.groq.com/openai/v1/chat/completions');
  });

  test('2c. resolveCloudEndpoint preserves full /chat/completions without double-appending', () => {
    const ep = resolveCloudEndpoint('https://api.groq.com/openai/v1/chat/completions', 'groq');
    assert.strictEqual(ep, 'https://api.groq.com/openai/v1/chat/completions');
  });

  test('2d. resolveCloudEndpoint defaults cleanly when base URL is empty', () => {
    const epGroq = resolveCloudEndpoint('', 'groq');
    assert.strictEqual(epGroq, 'https://api.groq.com/openai/v1/chat/completions');

    const epOpenAI = resolveCloudEndpoint('', 'openai');
    assert.strictEqual(epOpenAI, 'https://api.openai.com/v1/chat/completions');
  });

  // =========================================================================
  // 3. AI Status Diagnostics
  // =========================================================================
  test('3. AI getStatus reports status cleanly without leaking secrets', async () => {
    const status = await aiService.getStatus();
    assert.ok(typeof status === 'object');
    assert.ok('available' in status);
    assert.ok('model' in status);
    assert.ok('endpoint' in status);
    // Ensure no API keys or credentials exist in the status payload
    const serialized = JSON.stringify(status);
    assert.strictEqual(serialized.includes('gsk_'), false, 'Status must never expose API keys');
    assert.strictEqual(serialized.includes('Bearer'), false, 'Status must never expose Authorization headers');
  });

});
