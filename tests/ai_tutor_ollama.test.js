import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { aiService, SYSTEM_PROMPT } from '../src/services/aiService.js';

let server;
let baseUrl;

describe('Issue #24: AI Tutor API & Ollama Service Adapter Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('AC 1: GET /api/ai/status returns HTTP 200 with model name and availability status', async () => {
    const res = await fetch(`${baseUrl}/api/ai/status`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.data);
    assert.ok(json.data.model, 'Must include model name');
    assert.ok(typeof json.data.available === 'boolean', 'Must include available status boolean');
    assert.ok(json.data.system_memory, 'Must include system memory diagnostics');
    assert.ok(typeof json.data.system_memory.total_ram_gb === 'number');
    assert.ok(typeof json.data.system_memory.free_ram_gb === 'number');
  });

  test('AC 2: When Ollama is offline, returns clear guidance onboarding instructions without crashing', async () => {
    const status = await aiService.getStatus();
    if (!status.available) {
      assert.ok(
        status.status_message.includes('not responding') ||
        status.status_message.includes('reachable') ||
        status.status_message.includes('CLOUD_AI_API_KEY')
      );
      assert.ok(Array.isArray(status.onboarding_instructions));
      assert.ok(status.onboarding_instructions.some(i => i.includes('ollama.com')));
      assert.ok(status.onboarding_instructions.some(i => i.includes('ollama serve')));
    } else {
      assert.ok(status.status_message);
    }
  });

  test('AC 4: System prompt enforces Socratic mentoring and prevents direct homework solution leakage', () => {
    assert.ok(SYSTEM_PROMPT.includes('LinkTest AI Tutor'));
    assert.ok(SYSTEM_PROMPT.includes('Socratic'));
    assert.ok(
      SYSTEM_PROMPT.includes('Never provide direct, copy-paste homework solutions outright') ||
      SYSTEM_PROMPT.includes('guide the student')
    );
  });
});
