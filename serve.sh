#!/usr/bin/env bash
# Serve the app on this machine and the local network, so phones on the same Wi-Fi can open it.
#   ./serve.sh          # port 8000
#   ./serve.sh 9000     # another port
set -euo pipefail
PORT="${1:-8000}"
cd "$(dirname "$0")"
LAN_IP="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' | head -n1 || true)"
echo
echo "  UNN Academic Staff Appraisal"
echo "  On this computer:  http://localhost:${PORT}/"
[ -n "${LAN_IP}" ] && echo "  On a phone:        http://${LAN_IP}:${PORT}/  (same Wi-Fi)"
echo
exec python3 -m http.server "${PORT}" --bind 0.0.0.0
