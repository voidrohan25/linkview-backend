#!/usr/bin/env node
/**
 * LinkTest — Ollama Initialization & Health Diagnostic Script
 *
 * Checks Ollama service connectivity, detects installed models,
 * automatically pulls the target model (qwen3:8b or custom) via streaming API,
 * and runs a warm-up inference test.
 *
 * Usage:
 *   npm run ollama:init
 *   node scripts/init-ollama.js [--model <model>] [--check-only] [--force-pull]
 */

import { config } from '../src/config/env.js';
import { spawn } from 'child_process';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

// Parse CLI flags
const args = process.argv.slice(2);
let targetModel = config.ollama.model || 'qwen3:8b';
let checkOnly = false;
let forcePull = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && args[i + 1]) {
    targetModel = args[i + 1];
    i++;
  } else if (args[i] === '--check-only') {
    checkOnly = true;
  } else if (args[i] === '--force-pull') {
    forcePull = true;
  }
}

const baseUrl = config.ollama.baseUrl.replace(/\/+$/, '');

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderProgressBar(completed, total, statusText = '') {
  const width = 30;
  if (!total || total <= 0) {
    process.stdout.write(`\r  [${statusText || 'Processing...'}]                       `);
    return;
  }

  const percent = Math.min(100, Math.round((completed / total) * 100));
  const filled = Math.min(width, Math.round((completed / total) * width));
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

  const compStr = formatBytes(completed);
  const totStr = formatBytes(total);

  process.stdout.write(`\r  [${bar}] ${percent}% (${compStr} / ${totStr}) ${statusText}   `);
}

async function isOllamaReachable() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

function findOllamaBinary() {
  // Check common Windows / POSIX locations
  const candidatePaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    '/bin/ollama'
  ];

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

async function tryStartOllamaServer(binaryPath) {
  console.log(`\n[LinkTest Ollama Init] Found Ollama binary at: ${binaryPath}`);
  console.log(`[LinkTest Ollama Init] Attempting to launch 'ollama serve' in background...`);

  try {
    const child = spawn(binaryPath, ['serve'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Poll until ready (up to 12 seconds)
    process.stdout.write('  Waiting for Ollama service to start');
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write('.');
      if (await isOllamaReachable()) {
        console.log('\n[LinkTest Ollama Init] Successfully connected to newly launched Ollama service!');
        return true;
      }
    }
    console.log('\n[LinkTest Ollama Init] Timed out waiting for background Ollama service.');
  } catch (err) {
    console.warn('\n[LinkTest Ollama Init] Failed to spawn Ollama:', err.message);
  }
  return false;
}

async function run() {
  console.log('======================================================================');
  console.log('      LinkTest AI Learning Platform — Ollama Initialization           ');
  console.log('======================================================================');
  console.log(`• Ollama Service URL: ${baseUrl}`);
  console.log(`• Target AI Model:    ${targetModel}`);
  console.log('----------------------------------------------------------------------');

  // Step 1: Connectivity check
  process.stdout.write('1. Checking connection to Ollama API... ');
  let reachable = await isOllamaReachable();

  if (!reachable) {
    console.log('FAILED (Service Offline)');
    const binPath = findOllamaBinary();

    if (binPath) {
      const started = await tryStartOllamaServer(binPath);
      if (started) {
        reachable = true;
      }
    }
  } else {
    console.log('CONNECTED');
  }

  if (!reachable) {
    console.log('\n======================================================================');
    console.log('❌ OLLAMA IS NOT REACHABLE AT ' + baseUrl);
    console.log('======================================================================');
    console.log('\nHow to install & run Ollama for LinkTest:\n');
    console.log('Option 1: Windows Package Manager (PowerShell Administrator):');
    console.log('   winget install Ollama.Ollama');
    console.log('\nOption 2: Direct Download:');
    console.log('   Download and install from: https://ollama.com/download/windows');
    console.log('\nOption 3: If already installed, launch the service:');
    console.log('   ollama serve');
    console.log('\nOption 4: Cloud AI Fallback (No local GPU required):');
    console.log('   Add to backend/.env:');
    console.log('   CLOUD_AI_API_KEY=gsk_your_groq_or_openai_api_key');
    console.log('   CLOUD_AI_PROVIDER=groq');
    console.log('   CLOUD_AI_MODEL=llama-3.3-70b-versatile');
    console.log('======================================================================\n');
    process.exit(1);
  }

  // Step 2: Fetch installed models
  process.stdout.write(`2. Checking installed models at ${baseUrl}... `);
  const tagsRes = await fetch(`${baseUrl}/api/tags`);
  const tagsData = await tagsRes.json();
  const installedModels = tagsData.models || [];
  console.log(`Found ${installedModels.length} model(s) installed.`);

  if (installedModels.length > 0) {
    console.log('   Installed models:');
    installedModels.forEach(m => {
      const sizeStr = formatBytes(m.size);
      console.log(`   - ${m.name} (${sizeStr})`);
    });
  }

  const modelMatch = installedModels.find(
    m => m.name === targetModel || m.name.startsWith(targetModel.split(':')[0])
  );

  if (modelMatch && !forcePull) {
    console.log(`\n✔ Target model '${targetModel}' is already installed (${formatBytes(modelMatch.size)}).`);
  } else {
    if (checkOnly) {
      console.log(`\n⚠ Model '${targetModel}' is NOT installed. Run without '--check-only' to pull it.`);
      process.exit(1);
    }

    console.log(`\n3. Pulling '${targetModel}' from Ollama model library...`);
    console.log('   (This downloads weights directly into your local Ollama storage)');

    const pullRes = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: targetModel, stream: true })
    });

    if (!pullRes.ok) {
      console.error(`\n❌ Failed to initiate model pull. Status: ${pullRes.status}`);
      process.exit(1);
    }

    const reader = pullRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete chunk

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line);
          if (payload.status) {
            renderProgressBar(payload.completed || 0, payload.total || 0, payload.status);
          }
          if (payload.error) {
            console.error(`\n❌ Pull error: ${payload.error}`);
            process.exit(1);
          }
        } catch (e) {
          // Ignore JSON parse errors for split chunks
        }
      }
    }
    console.log('\n✔ Model download and assembly completed successfully!');
  }

  // Step 3: Warm-up inference test
  console.log('\n4. Running warm-up inference test...');
  const warmupStart = Date.now();

  try {
    const testRes = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: 'You are LinkTest AI Tutor. In exactly one clear sentence, greet the student and confirm you are online.',
        stream: false
      })
    });

    if (!testRes.ok) {
      throw new Error(`Inference returned HTTP ${testRes.status}`);
    }

    const testData = await testRes.json();
    const elapsed = Date.now() - warmupStart;

    console.log(`✔ Warm-up test succeeded in ${elapsed}ms!`);
    console.log('\n--- Model Response ---');
    console.log(testData.response.trim());
    console.log('----------------------');
  } catch (err) {
    console.warn(`⚠ Warm-up test warning: ${err.message}. Model is installed, but initial load may be slow.`);
  }

  console.log('\n======================================================================');
  console.log('🎉 LINKTEST OLLAMA INITIALIZATION COMPLETE!');
  console.log(`• Model '${targetModel}' is active and ready for:`);
  console.log('  1. AI Tutor Student Chat (/ai-tutor)');
  console.log('  2. AI Question Generation in Teacher Mock Test Studio');
  console.log('  3. Practice Quiz Generation');
  console.log('======================================================================\n');
}

run().catch(err => {
  console.error('\n❌ Fatal initialization error:', err.message);
  process.exit(1);
});
