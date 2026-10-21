#!/bin/sh
# Run the milestone gate; exit non-zero if any step fails. Output goes to /tmp/whatleaks-gate.log.
npm run check > /tmp/whatleaks-gate.log 2>&1
status=$?
grep -E "Tests |error|FAIL|✖" /tmp/whatleaks-gate.log | head -20
exit $status
