# DEPRECATED: Unsafe host execution runner removed per Issue #23.
# Student code execution must occur exclusively inside isolated disposable Docker containers.
# Direct execution on the LinkTest host is strictly prohibited.

import sys

if __name__ == '__main__':
    sys.stderr.write("FATAL: Direct host execution of sandboxRunnerPy.py is disabled for security. Use isolated Docker container sandbox.\\n")
    sys.exit(1)
