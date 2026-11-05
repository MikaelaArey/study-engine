#!/bin/bash
# Double-click this file to start Study Engine and open it at http://localhost:3001.
# Keep the Terminal window open while you use Study Engine. Close it to stop Study Engine.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

pause() {
  echo
  read -n 1 -s -r -p "Press any key to close this window."
  echo
}

if ! command -v node >/dev/null 2>&1; then
  echo "Study Engine needs Node.js. Install it from https://nodejs.org, then double-click this file again."
  pause
  exit 1
fi

if [ ! -f .env ]; then
  echo "Creating the settings file (.env). Add an Anthropic API key there to turn on live AI."
  cp .env.example .env
fi

node server.js --open || pause
