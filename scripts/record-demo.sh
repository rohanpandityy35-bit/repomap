#!/usr/bin/env bash
# Record a 10-second terminal demo GIF of repomap using VHS (https://github.com/charmbracelet/vhs)
# Usage: vhs scripts/demo.tape

set -euo pipefail

cat << 'EOF' > /tmp/repomap-demo.tape
Output docs/demo.gif
Set FontSize 15
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"

Type "npx repomap overview ."
Enter
Sleep 2s

Type "npx repomap find generateMap ."
Enter
Sleep 2s

Type "npx repomap impact src/core/graph.ts ."
Enter
Sleep 3s
EOF

if command -v vhs >/dev/null 2>&1; then
  vhs /tmp/repomap-demo.tape
else
  echo "Install VHS (https://github.com/charmbracelet/vhs) and run: vhs /tmp/repomap-demo.tape"
fi
