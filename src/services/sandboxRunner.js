// DEPRECATED: Unsafe host execution runner removed per Issue #23.
// Student code execution must occur exclusively inside isolated disposable Docker containers.
// Direct execution on the LinkTest host is strictly prohibited.

export function executeOnHostDeprecated() {
  throw new Error('DIRECT_HOST_EXECUTION_FORBIDDEN: Direct host execution of untrusted code is prohibited. Use dockerSandboxService.');
}

if (process.argv[1] && process.argv[1].endsWith('sandboxRunner.js')) {
  process.stderr.write('FATAL: Direct host execution of sandboxRunner.js is disabled for security. Use isolated Docker container sandbox.\\n');
  process.exit(1);
}
