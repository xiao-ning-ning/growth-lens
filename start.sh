#!/bin/bash
cd "$(dirname "$0")"

# Check if port 3000 is in use, kill the process if so
PORT_PID=$(lsof -ti:3000)
if [ -n "$PORT_PID" ]; then
    echo "[INFO] Port 3000 in use, killing process $PORT_PID..."
    kill -9 $PORT_PID
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
fi

echo "[OK] Starting server..."
node server/index.js --open
