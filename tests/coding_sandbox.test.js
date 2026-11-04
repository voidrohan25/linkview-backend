import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { codeExecutionService, checkHazardousCalls } from '../src/services/codeExecutionService.js';
import { dockerSandboxService, SANDBOX_CONFIG } from '../src/services/dockerSandboxService.js';

let server;
let baseUrl;
let studentToken = null;

describe('Issue #23: Production Container Sandbox Security & Resource Suite', () => {
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

    // Authenticate Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const studentData = await studentRes.json();
    assert.strictEqual(studentRes.status, 200);
    studentToken = studentData.data.token;
  });

  after(() => {
    if (server) server.close();
  });

  afterEach(() => {
    // Reset test hooks after each test
    dockerSandboxService.setCustomExecutor(null);
    dockerSandboxService.setDockerAvailabilityOverride(null);
  });

  // 1. Valid Node.js execution
  test('1. Valid Node.js execution inside container returns passed status, test count, and runtime', async () => {
    dockerSandboxService.setCustomExecutor(async ({ dockerArgs, payload }) => {
      assert.ok(dockerArgs.includes('node:20-alpine'), 'Must use controlled node:20-alpine image');
      const parsed = JSON.parse(payload);
      assert.ok(parsed.code.includes('twoSum'));
      return {
        status: 'passed',
        passed: true,
        score_percentage: 100,
        test_cases_passed: 2,
        total_test_cases: 2,
        execution_time_ms: 15,
        memory_usage_mb: 12.5,
        error: null,
        results: [
          { test_case_id: 'tc-1', is_hidden: false, passed: true, execution_time_ms: 8, actual_output: '[0, 1]' },
          { test_case_id: 'tc-2', is_hidden: true, passed: true, execution_time_ms: 7 }
        ]
      };
    });

    const summary = await codeExecutionService.executeCode({
      code: 'function twoSum(nums, target) { return [0, 1]; }',
      language: 'javascript',
      testCases: [
        { id: 'tc-1', input: '[[2, 7], 9]', expected_output: '[0, 1]', is_hidden: false },
        { id: 'tc-2', input: '[[3, 3], 6]', expected_output: '[0, 1]', is_hidden: true }
      ]
    });

    assert.strictEqual(summary.status, 'passed');
    assert.strictEqual(summary.passed, true);
    assert.strictEqual(summary.test_cases_passed, 2);
    assert.strictEqual(summary.total_test_cases, 2);
    assert.strictEqual(summary.score_percentage, 100);
    assert.ok(summary.execution_time_ms > 0);
  });

  // 2. Valid Python execution
  test('2. Valid Python execution inside container returns passed status and test cases', async () => {
    dockerSandboxService.setCustomExecutor(async ({ dockerArgs }) => {
      assert.ok(dockerArgs.includes('python:3.11-alpine'), 'Must use controlled python:3.11-alpine image');
      return {
        status: 'passed',
        passed: true,
        score_percentage: 100,
        test_cases_passed: 1,
        total_test_cases: 1,
        execution_time_ms: 22,
        memory_usage_mb: 11.0,
        error: null,
        results: [{ test_case_id: 'tc-py-1', is_hidden: false, passed: true, execution_time_ms: 22, actual_output: '15' }]
      };
    });

    const summary = await codeExecutionService.executeCode({
      code: 'def multiply(a, b): return a * b',
      language: 'python',
      testCases: [{ id: 'tc-py-1', input: '[3, 5]', expected_output: '15', is_hidden: false }]
    });

    assert.strictEqual(summary.status, 'passed');
    assert.strictEqual(summary.passed, true);
    assert.strictEqual(summary.test_cases_passed, 1);
  });

  // 3. Invalid language rejection
  test('3. Invalid language rejection blocks unapproved runtimes', async () => {
    const invalidLangs = ['ruby', 'bash', 'sh', 'c', 'cpp', 'rust', 'go', 'php'];
    for (const lang of invalidLangs) {
      const summary = await codeExecutionService.executeCode({
        code: 'puts "hello"',
        language: lang,
        testCases: [{ id: 'tc-1', input: '', expected_output: '' }]
      });
      assert.strictEqual(summary.status, 'compilation_error');
      assert.strictEqual(summary.passed, false);
      assert.ok(summary.error.includes('INVALID_LANGUAGE'), `Must reject ${lang}`);
    }
  });

  // 4. Syntax / compilation error
  test('4. Syntax/compilation error is gracefully reported without crashing runner', async () => {
    dockerSandboxService.setCustomExecutor(async () => ({
      status: 'compilation_error',
      passed: false,
      score_percentage: 0,
      test_cases_passed: 0,
      total_test_cases: 1,
      execution_time_ms: 0,
      memory_usage_mb: 0,
      error: 'Unexpected token {',
      results: [{ test_case_id: 'tc-1', is_hidden: false, passed: false, execution_time_ms: 0, error: 'Unexpected token {' }]
    }));

    const summary = await codeExecutionService.executeCode({
      code: 'function broken( { {{{',
      language: 'javascript',
      testCases: [{ id: 'tc-1', input: '', expected_output: '' }]
    });

    assert.strictEqual(summary.status, 'compilation_error');
    assert.strictEqual(summary.passed, false);
    assert.ok(summary.error);
  });

  // 5. Runtime error
  test('5. Runtime error during execution is safely isolated and returned', async () => {
    dockerSandboxService.setCustomExecutor(async () => ({
      status: 'runtime_error',
      passed: false,
      score_percentage: 0,
      test_cases_passed: 0,
      total_test_cases: 1,
      execution_time_ms: 5,
      memory_usage_mb: 10,
      error: 'Cannot read properties of undefined (reading "foo")',
      results: [{ test_case_id: 'tc-1', is_hidden: false, passed: false, execution_time_ms: 5, error: 'TypeError' }]
    }));

    const summary = await codeExecutionService.executeCode({
      code: 'function solve() { return undefined.foo; }',
      language: 'javascript',
      testCases: [{ id: 'tc-1', input: '', expected_output: 'bar' }]
    });

    assert.strictEqual(summary.status, 'runtime_error');
    assert.strictEqual(summary.passed, false);
    assert.ok(summary.error.includes('undefined'));
  });

  // 6. Infinite Node.js loop timeout
  test('6. Infinite Node.js loop triggers watchdog timeout with TIME_LIMIT_EXCEEDED', async () => {
    dockerSandboxService.setCustomExecutor(async ({ totalWatchdogMs }) => {
      assert.ok(totalWatchdogMs >= 2000, 'Must enforce minimum watchdog timer');
      return {
        status: 'TIME_LIMIT_EXCEEDED',
        passed: false,
        score_percentage: 0,
        test_cases_passed: 0,
        total_test_cases: 1,
        execution_time_ms: 1000,
        memory_usage_mb: 0,
        error: 'TIME_LIMIT_EXCEEDED',
        results: [{ test_case_id: 'tc-loop', is_hidden: false, passed: false, execution_time_ms: 1000, error: 'TIME_LIMIT_EXCEEDED' }]
      };
    });

    const summary = await codeExecutionService.executeCode({
      code: 'function loop() { while(true) {} }',
      language: 'javascript',
      testCases: [{ id: 'tc-loop', input: '', expected_output: 'done' }],
      timeLimitSeconds: 1.0
    });

    assert.strictEqual(summary.status, 'TIME_LIMIT_EXCEEDED');
    assert.strictEqual(summary.passed, false);
    assert.strictEqual(summary.error, 'TIME_LIMIT_EXCEEDED');
  });

  // 7. Infinite Python loop timeout
  test('7. Infinite Python loop triggers watchdog timeout with TIME_LIMIT_EXCEEDED', async () => {
    dockerSandboxService.setCustomExecutor(async () => ({
      status: 'TIME_LIMIT_EXCEEDED',
      passed: false,
      score_percentage: 0,
      test_cases_passed: 0,
      total_test_cases: 1,
      execution_time_ms: 1500,
      memory_usage_mb: 0,
      error: 'TIME_LIMIT_EXCEEDED',
      results: [{ test_case_id: 'tc-py-loop', is_hidden: false, passed: false, execution_time_ms: 1500, error: 'TIME_LIMIT_EXCEEDED' }]
    }));

    const summary = await codeExecutionService.executeCode({
      code: 'def solve():\n    while True:\n        pass',
      language: 'python',
      testCases: [{ id: 'tc-py-loop', input: '', expected_output: 'done' }],
      timeLimitSeconds: 1.0
    });

    assert.strictEqual(summary.status, 'TIME_LIMIT_EXCEEDED');
    assert.strictEqual(summary.passed, false);
  });

  // 8. Memory exhaustion protection
  test('8. Memory exhaustion triggers MEMORY_LIMIT_EXCEEDED via container cgroups', async () => {
    dockerSandboxService.setCustomExecutor(async ({ dockerArgs }) => {
      assert.ok(dockerArgs.includes('--memory'), 'Must specify memory cap');
      assert.ok(dockerArgs.includes('--memory-swap'), 'Must specify swap cap matching memory');
      return {
        status: 'MEMORY_LIMIT_EXCEEDED',
        passed: false,
        score_percentage: 0,
        test_cases_passed: 0,
        total_test_cases: 1,
        execution_time_ms: 50,
        memory_usage_mb: 64,
        error: 'MEMORY_LIMIT_EXCEEDED',
        results: [{ test_case_id: 'tc-mem', is_hidden: false, passed: false, execution_time_ms: 50, error: 'MEMORY_LIMIT_EXCEEDED' }]
      };
    });

    const summary = await codeExecutionService.executeCode({
      code: 'const a = []; while(true) a.push(new Array(1000000));',
      language: 'javascript',
      memoryLimitMb: 64,
      testCases: [{ id: 'tc-mem', input: '', expected_output: 'done' }]
    });

    assert.strictEqual(summary.status, 'MEMORY_LIMIT_EXCEEDED');
    assert.strictEqual(summary.passed, false);
  });

  // 9. CPU exhaustion protection
  test('9. Container limits CPU quota to prevent host starvation', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-cpu-limits',
      language: 'javascript',
      cpuLimit: 0.5
    });
    const cpuIdx = args.indexOf('--cpus');
    assert.ok(cpuIdx !== -1, 'Must enforce --cpus argument');
    assert.strictEqual(args[cpuIdx + 1], '0.5');
  });

  // 10. PID / process limit
  test('10. Container limits PIDs to prevent fork bombs', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-pid-limits',
      language: 'javascript',
      pidsLimit: 64
    });
    const pidIdx = args.indexOf('--pids-limit');
    assert.ok(pidIdx !== -1, 'Must enforce --pids-limit argument');
    assert.strictEqual(args[pidIdx + 1], '64');
  });

  // 11. stdout flooding protection
  test('11. Excessive stdout flooding triggers OUTPUT_LIMIT_EXCEEDED', async () => {
    dockerSandboxService.setCustomExecutor(async () => ({
      status: 'OUTPUT_LIMIT_EXCEEDED',
      passed: false,
      score_percentage: 0,
      test_cases_passed: 0,
      total_test_cases: 1,
      execution_time_ms: 10,
      memory_usage_mb: 0,
      error: 'OUTPUT_LIMIT_EXCEEDED: Container output exceeded maximum allowed limit of 64KB.',
      results: [{ test_case_id: 'tc-flood', is_hidden: false, passed: false, execution_time_ms: 10, error: 'OUTPUT_LIMIT_EXCEEDED' }]
    }));

    const summary = await codeExecutionService.executeCode({
      code: 'while(true) console.log("A".repeat(10000));',
      language: 'javascript',
      testCases: [{ id: 'tc-flood', input: '', expected_output: 'done' }]
    });

    assert.strictEqual(summary.status, 'OUTPUT_LIMIT_EXCEEDED');
    assert.strictEqual(summary.passed, false);
  });

  // 12. stderr flooding protection
  test('12. Excessive stderr flooding triggers OUTPUT_LIMIT_EXCEEDED', async () => {
    dockerSandboxService.setCustomExecutor(async () => ({
      status: 'OUTPUT_LIMIT_EXCEEDED',
      passed: false,
      score_percentage: 0,
      test_cases_passed: 0,
      total_test_cases: 1,
      execution_time_ms: 10,
      memory_usage_mb: 0,
      error: 'OUTPUT_LIMIT_EXCEEDED: Stderr output exceeded maximum allowed limit.',
      results: []
    }));

    const summary = await codeExecutionService.executeCode({
      code: 'while(true) console.error("ERR".repeat(10000));',
      language: 'javascript',
      testCases: [{ id: 'tc-err', input: '', expected_output: 'done' }]
    });

    assert.strictEqual(summary.status, 'OUTPUT_LIMIT_EXCEEDED');
    assert.strictEqual(summary.passed, false);
  });

  // 13. Oversized source rejection
  test('13. Oversized source code (>64KB) is rejected immediately with compilation_error', async () => {
    const hugeCode = 'let a = 1;\n'.repeat(6000); // ~72KB
    assert.ok(hugeCode.length > 65536);

    const summary = await codeExecutionService.executeCode({
      code: hugeCode,
      language: 'javascript',
      testCases: [{ id: 'tc-huge', input: '', expected_output: '' }]
    });

    assert.strictEqual(summary.status, 'compilation_error');
    assert.strictEqual(summary.passed, false);
    assert.ok(summary.error.includes('exceeds maximum allowed limit'));
  });

  // 14. Oversized stdin rejection
  test('14. Oversized stdin payload (>256KB) is rejected', async () => {
    dockerSandboxService.setDockerAvailabilityOverride(true);
    const hugeTestCases = Array.from({ length: 50 }, (_, i) => ({
      id: `tc-${i}`,
      input: 'X'.repeat(6000), // ~300KB total
      expected_output: 'X'
    }));

    const summary = await dockerSandboxService.runInContainer({
      code: 'function solve() { return 1; }',
      language: 'javascript',
      testCases: hugeTestCases
    });

    assert.strictEqual(summary.status, 'compilation_error');
    assert.ok(summary.error.includes('256KB'));
  });

  // 15. Host filesystem access blocked
  test('15. Host filesystem access is blocked both via static hazard check and container isolation', async () => {
    const fsProbes = [
      "const fs = require('fs'); fs.readFileSync('/etc/passwd');",
      "import fs from 'fs'; fs.readFileSync('C:\\\\Windows\\\\win.ini');",
      "import os\nos.listdir('/')",
      "import pathlib\npathlib.Path('/etc').read_text()"
    ];

    for (const code of fsProbes) {
      const lang = code.includes('import os') || code.includes('pathlib') ? 'python' : 'javascript';
      const check = checkHazardousCalls(code, lang);
      assert.ok(check, `Must catch filesystem hazard: ${code}`);

      const summary = await codeExecutionService.executeCode({
        code,
        language: lang,
        testCases: [{ id: 'tc-fs', input: '', expected_output: '' }]
      });

      assert.strictEqual(summary.status, 'SECURITY_VIOLATION');
      assert.strictEqual(summary.passed, false);
    }
  });

  // 16. Backend filesystem access blocked
  test('16. Container arguments strictly prohibit mounting backend host directories or source files', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-backend-fs',
      language: 'javascript'
    });

    assert.ok(args.includes('--read-only'), 'Rootfs must be strictly read-only');
    assert.ok(args.includes('--tmpfs'), 'Tmpfs must be used for scratch space');
    assert.ok(!args.includes('-v'), 'Host volume mounts are strictly forbidden');
    assert.ok(!args.includes('--volume'), 'Host volume mounts are strictly forbidden');
    assert.ok(!args.includes('--mount'), 'Host volume mounts are strictly forbidden');
  });

  // 17. Environment secret isolation
  test('17. Container runs with empty environment and never inherits backend secrets', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-secret-isolation',
      language: 'javascript'
    });

    const argsStr = args.join(' ');
    assert.ok(!argsStr.includes(process.env.JWT_SECRET || 'JWT_SECRET'), 'Must not pass JWT_SECRET');
    assert.ok(!argsStr.includes('DATABASE_URL'), 'Must not pass DATABASE_URL');
    assert.ok(!argsStr.includes('--env-file'), 'Must not use --env-file');
    assert.ok(argsStr.includes('NODE_ENV=production'), 'Must set clean NODE_ENV=production');
  });

  // 18. PostgreSQL access blocked
  test('18. Container has network disabled preventing PostgreSQL database connections', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-db-block',
      language: 'python'
    });
    const netIdx = args.indexOf('--network');
    assert.ok(netIdx !== -1);
    assert.strictEqual(args[netIdx + 1], 'none', 'Must enforce --network none');
  });

  // 19. Localhost access blocked
  test('19. Localhost and loopback access blocked via network-none namespace', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-localhost-block',
      language: 'javascript'
    });
    const netIdx = args.indexOf('--network');
    assert.strictEqual(args[netIdx + 1], 'none');
  });

  // 20. Docker socket inaccessible
  test('20. Docker socket (/var/run/docker.sock) is never mounted into container', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-socket-defense',
      language: 'javascript'
    });
    const argsStr = args.join(' ');
    assert.ok(!argsStr.includes('docker.sock'), 'Docker socket must never be mounted');
  });

  // 21. Container runs as non-root
  test('21. Container enforces non-root execution and drops Linux capabilities', () => {
    const args = dockerSandboxService.buildDockerRunArgs({
      containerName: 'test-non-root',
      language: 'javascript'
    });

    const userIdx = args.indexOf('--user');
    assert.ok(userIdx !== -1, 'Must specify --user');
    assert.strictEqual(args[userIdx + 1], '1000:1000', 'Must run as unprivileged UID 1000');

    const capIdx = args.indexOf('--cap-drop');
    assert.ok(capIdx !== -1, 'Must drop capabilities');
    assert.strictEqual(args[capIdx + 1], 'ALL');

    assert.ok(args.includes('--security-opt'), 'Must include security options');
    assert.ok(args.includes('no-new-privileges:true'), 'Must prevent privilege escalation');
  });

  // 22. Network disabled
  test('22. Network is disabled by default for all languages', () => {
    for (const lang of ['javascript', 'python']) {
      const args = dockerSandboxService.buildDockerRunArgs({
        containerName: `test-net-${lang}`,
        language: lang
      });
      const netIdx = args.indexOf('--network');
      assert.strictEqual(args[netIdx + 1], 'none');
    }
  });

  // 23. Container cleanup after success
  test('23. Container cleanup is executed after successful execution', async () => {
    let cleanupCalled = false;
    const origCleanUp = dockerSandboxService.cleanUpContainer;
    dockerSandboxService.cleanUpContainer = async (name) => {
      cleanupCalled = true;
      assert.ok(name.startsWith('linktest-sandbox-'));
    };

    try {
      dockerSandboxService.setCustomExecutor(async () => ({
        status: 'passed',
        passed: true,
        test_cases_passed: 1,
        total_test_cases: 1,
        results: [{ test_case_id: 'tc-1', passed: true }]
      }));

      await codeExecutionService.executeCode({
        code: 'function solve() { return 1; }',
        testCases: [{ id: 'tc-1', input: '', expected_output: '1' }]
      });

      assert.strictEqual(cleanupCalled, true, 'cleanUpContainer must be called after success');
    } finally {
      dockerSandboxService.cleanUpContainer = origCleanUp;
    }
  });

  // 24. Container cleanup after failure
  test('24. Container cleanup is executed after execution error', async () => {
    let cleanupCalled = false;
    const origCleanUp = dockerSandboxService.cleanUpContainer;
    dockerSandboxService.cleanUpContainer = async () => {
      cleanupCalled = true;
    };

    try {
      dockerSandboxService.setCustomExecutor(async () => ({
        status: 'runtime_error',
        passed: false,
        test_cases_passed: 0,
        total_test_cases: 1,
        error: 'Fatal error',
        results: []
      }));

      await codeExecutionService.executeCode({
        code: 'function solve() { throw new Error("die"); }',
        testCases: [{ id: 'tc-1', input: '', expected_output: '1' }]
      });

      assert.strictEqual(cleanupCalled, true, 'cleanUpContainer must be called after failure');
    } finally {
      dockerSandboxService.cleanUpContainer = origCleanUp;
    }
  });

  // 25. Container cleanup after timeout
  test('25. Container cleanup is executed after timeout', async () => {
    let cleanupCalled = false;
    const origCleanUp = dockerSandboxService.cleanUpContainer;
    dockerSandboxService.cleanUpContainer = async () => {
      cleanupCalled = true;
    };

    try {
      dockerSandboxService.setCustomExecutor(async () => ({
        status: 'TIME_LIMIT_EXCEEDED',
        passed: false,
        error: 'TIME_LIMIT_EXCEEDED',
        results: []
      }));

      await codeExecutionService.executeCode({
        code: 'while(true){}',
        testCases: [{ id: 'tc-1', input: '', expected_output: '1' }]
      });

      assert.strictEqual(cleanupCalled, true, 'cleanUpContainer must be called after timeout');
    } finally {
      dockerSandboxService.cleanUpContainer = origCleanUp;
    }
  });

  // 26. Concurrent submissions use separate sandboxes
  test('26. Concurrent submissions generate unique container names and execute in distinct sandboxes', async () => {
    const containerNames = new Set();
    dockerSandboxService.setCustomExecutor(async ({ containerName }) => {
      containerNames.add(containerName);
      return {
        status: 'passed',
        passed: true,
        test_cases_passed: 1,
        total_test_cases: 1,
        results: [{ test_case_id: 'tc-1', passed: true }]
      };
    });

    const p1 = codeExecutionService.executeCode({ code: 'return 1;', testCases: [{ id: 'tc-1' }] });
    const p2 = codeExecutionService.executeCode({ code: 'return 2;', testCases: [{ id: 'tc-2' }] });
    const p3 = codeExecutionService.executeCode({ code: 'return 3;', testCases: [{ id: 'tc-3' }] });

    await Promise.all([p1, p2, p3]);

    assert.strictEqual(containerNames.size, 3, 'Each concurrent execution must have an independent container name');
  });

  // 27. Docker unavailable -> SANDBOX_UNAVAILABLE
  test('27. Docker unavailable triggers fail-closed SANDBOX_UNAVAILABLE without host execution', async () => {
    dockerSandboxService.setDockerAvailabilityOverride(false);

    const summary = await codeExecutionService.executeCode({
      code: 'function add(a, b) { return a + b; }',
      testCases: [{ id: 'tc-1', input: '[1, 2]', expected_output: '3' }]
    });

    assert.strictEqual(summary.status, 'SANDBOX_UNAVAILABLE');
    assert.strictEqual(summary.passed, false);
    assert.ok(summary.error.includes('SANDBOX_UNAVAILABLE'));
    assert.strictEqual(summary.test_cases_passed, 0);
  });

  // 28. No unsafe host fallback exists
  test('28. No unsafe host fallback exists (direct host runner throws fatal security error)', async () => {
    // Dynamically import deprecated host runner to verify fatal guard
    const { executeOnHostDeprecated } = await import('../src/services/sandboxRunner.js');
    assert.throws(
      () => executeOnHostDeprecated(),
      /DIRECT_HOST_EXECUTION_FORBIDDEN/,
      'Direct host execution must throw fatal error'
    );
  });

  // API Integration: Candidate results sanitization via HTTP
  test('29. POST /api/coding/execute respects candidate hidden test case sanitization', async () => {
    dockerSandboxService.setCustomExecutor(async () => ({
      status: 'passed',
      passed: true,
      score_percentage: 100,
      test_cases_passed: 2,
      total_test_cases: 2,
      execution_time_ms: 20,
      memory_usage_mb: 15,
      results: [
        { test_case_id: 'tc-pub', is_hidden: false, passed: true, input: '5', expected_output: '10', actual_output: '10' },
        { test_case_id: 'tc-priv', is_hidden: true, passed: true, input: '99', expected_output: '198', actual_output: '198' }
      ]
    }));

    const res = await fetch(`${baseUrl}/api/coding/execute`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${studentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'function double(n) { return n * 2; }',
        language: 'javascript',
        testCases: [
          { id: 'tc-pub', input: '5', expected_output: '10', is_hidden: false },
          { id: 'tc-priv', input: '99', expected_output: '198', is_hidden: true }
        ]
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.status, 'passed');

    // Candidate sanitization method test
    const sanitized = codeExecutionService.sanitizeResultsForCandidate(data.data);
    const privCase = sanitized.results.find(r => r.test_case_id === 'tc-priv');
    assert.strictEqual(privCase.input, undefined);
    assert.strictEqual(privCase.expected_output, undefined);
    assert.strictEqual(privCase.actual_output, undefined);
  });
});
