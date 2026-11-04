// Secure Code Execution Service
// LinkTest Enterprise Isolated Container Sandbox Engine
// Issue #23: Isolated Node/Python container execution runner with timeout safeguards,
// zero host execution, strict cgroups, and fail-closed security.

import { dockerSandboxService, SANDBOX_CONFIG } from './dockerSandboxService.js';

const SUPPORTED_LANGUAGES = new Set(['javascript', 'js', 'node', 'nodejs', 'python', 'py']);

/**
 * Defense-in-depth static hazard analysis to reject overt host system, filesystem,
 * and network probes prior to container execution.
 */
export function checkHazardousCalls(code, language = 'javascript') {
  if (typeof code !== 'string') return null;
  const lang = (language || 'javascript').toLowerCase();

  if (lang === 'python' || lang === 'py') {
    const blockedPy = [
      /\bimport\s+(?:os|sys|subprocess|socket|http|urllib|shutil|pathlib)\b/i,
      /\bfrom\s+(?:os|sys|subprocess|socket|http|urllib|shutil|pathlib)\s+import\b/i,
      /\b__import__\s*\(\s*['"](?:os|sys|subprocess|socket|http|urllib|shutil|pathlib)['"]\s*\)/i,
      /\bopen\s*\(/i
    ];
    for (const pattern of blockedPy) {
      if (pattern.test(code)) {
        return 'Host file system and network calls are blocked.';
      }
    }
    return null;
  }

  // JavaScript
  const blockedJs = [
    /\bchild_process\b/i,
    /\brequire\s*\(\s*['"`](?:fs|child_process|net|http|https|dgram|dns|cluster|tls)['"`]\s*\)/i,
    /\bimport\s+(?:[\w*\s{},]+from\s+)?['"`](?:fs|child_process|net|http|https|dgram|dns|cluster|tls)['"`]/i,
    /\bimport\s*\(?['"`](?:fs|child_process|net|http|https|dgram|dns|cluster|tls)['"`]\)?/i,
    /\bprocess\.binding\b/i,
    /\bprocess\.env\b/i,
    /\bprocess\.exit\b/i
  ];
  for (const pattern of blockedJs) {
    if (pattern.test(code)) {
      return 'Host file system and network calls are blocked.';
    }
  }
  return null;
}

export const codeExecutionService = {
  /**
   * Securely runs JavaScript or Python code against test cases in an isolated Docker container sandbox.
   *
   * @param {Object} params
   * @param {string} params.code - Student-submitted code
   * @param {string} [params.language='javascript'] - Language ('javascript' | 'python')
   * @param {Array<Object>} params.testCases - [{ id, input, expected_output, is_hidden }]
   * @param {number} [params.timeLimitSeconds=2.0] - Time limit in seconds
   * @param {number} [params.memoryLimitMb=128] - Memory limit in megabytes
   * @returns {Promise<Object>} Execution result summary
   */
  async executeCode({
    code,
    language = 'javascript',
    testCases = [],
    timeLimitSeconds = 2.0,
    memoryLimitMb = 128
  }) {
    // 1. Validate presence of submitted code
    if (!code || typeof code !== 'string' || !code.trim()) {
      return {
        status: 'compilation_error',
        passed: false,
        score_percentage: 0,
        test_cases_passed: 0,
        total_test_cases: testCases.length,
        execution_time_ms: 0,
        memory_usage_mb: 0,
        error: 'No submitted code was provided for execution.',
        results: []
      };
    }

    // 2. Validate source code size limit (64KB max)
    if (code.length > SANDBOX_CONFIG.MAX_CODE_CHARS) {
      return {
        status: 'compilation_error',
        passed: false,
        score_percentage: 0,
        test_cases_passed: 0,
        total_test_cases: testCases.length,
        execution_time_ms: 0,
        memory_usage_mb: 0,
        error: `Code length (${code.length} chars) exceeds maximum allowed limit of ${SANDBOX_CONFIG.MAX_CODE_CHARS} characters.`,
        results: []
      };
    }

    // 3. Validate supported programming language
    const normalizedLang = (language || '').trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(normalizedLang)) {
      return {
        status: 'compilation_error',
        passed: false,
        score_percentage: 0,
        test_cases_passed: 0,
        total_test_cases: testCases.length,
        execution_time_ms: 0,
        memory_usage_mb: 0,
        error: `INVALID_LANGUAGE: Unsupported programming language '${language}'. Only JavaScript and Python are permitted.`,
        results: []
      };
    }

    // 4. Defense-in-depth static hazard check
    const hazardError = checkHazardousCalls(code, normalizedLang);
    if (hazardError) {
      return {
        status: 'SECURITY_VIOLATION',
        passed: false,
        score_percentage: 0,
        test_cases_passed: 0,
        total_test_cases: testCases.length,
        execution_time_ms: 0,
        memory_usage_mb: 0,
        error: hazardError,
        results: testCases.map((tc, idx) => ({
          test_case_id: tc.id || `tc-${idx + 1}`,
          is_hidden: Boolean(tc.is_hidden),
          passed: false,
          execution_time_ms: 0,
          error: hazardError
        }))
      };
    }

    // 5. Execute exclusively within isolated disposable Docker container
    // If container runtime is unavailable, fails closed with SANDBOX_UNAVAILABLE.
    const canonicalLanguage = (normalizedLang === 'python' || normalizedLang === 'py') ? 'python' : 'javascript';

    return await dockerSandboxService.runInContainer({
      code,
      language: canonicalLanguage,
      testCases,
      timeLimitSeconds,
      memoryLimitMb
    });
  },

  /**
   * Sanitizes test results so that hidden test cases do not reveal their input or expected output.
   * Safe to return directly to students.
   */
  sanitizeResultsForCandidate(executionData) {
    if (!executionData) return null;
    const sanitizedResults = (executionData.results || []).map(r => {
      if (r.is_hidden) {
        return {
          test_case_id: r.test_case_id,
          is_hidden: true,
          passed: r.passed,
          execution_time_ms: r.execution_time_ms,
          error: r.passed ? undefined : 'Hidden Test Case Failed'
        };
      }
      return {
        test_case_id: r.test_case_id,
        is_hidden: false,
        passed: r.passed,
        execution_time_ms: r.execution_time_ms,
        input: r.input,
        expected_output: r.expected_output,
        actual_output: r.actual_output,
        error: r.error
      };
    });

    return {
      status: executionData.status,
      passed: executionData.passed,
      score_percentage: executionData.score_percentage,
      test_cases_passed: executionData.test_cases_passed,
      total_test_cases: executionData.total_test_cases,
      execution_time_ms: executionData.execution_time_ms,
      memory_usage_mb: executionData.memory_usage_mb,
      error: executionData.error,
      results: sanitizedResults
    };
  }
};
