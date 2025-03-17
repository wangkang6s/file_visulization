#!/bin/bash

echo "===== File Visualizer Server Management ====="
echo "Stopping any existing server processes..."

# Kill any existing Python server processes
for port in $(seq 5000 5020); do
  pid=$(lsof -i :$port | awk 'NR>1 {print $2}' | uniq)
  if [ ! -z "$pid" ]; then
    echo "Killing process $pid using port $port"
    kill -9 $pid 2>/dev/null
  fi
done

# Find and kill any Python server processes by name
echo "Killing any remaining Python server processes..."
pkill -f "python server.py" 2>/dev/null
pkill -f "server.py" 2>/dev/null

# Kill any Flask processes (including reloader processes)
echo "Killing any Flask processes..."
ps aux | grep -E "[p]ython.*[F]lask" | awk '{print $2}' | xargs kill -9 2>/dev/null
ps aux | grep -E "[p]ython.*[s]erver.py" | awk '{print $2}' | xargs kill -9 2>/dev/null

# Wait for ports to be released
echo "Waiting for ports to be released..."
sleep 3

# Check if port 5009 is still in use
if lsof -i :5009 >/dev/null 2>&1; then
  echo "Port 5009 is still in use. Trying more aggressive cleanup..."
  # Try more aggressive cleanup
  lsof -i :5009 | awk 'NR>1 {print $2}' | xargs kill -9 2>/dev/null
  sleep 3
fi

# Check again if port 5009 is still in use
if lsof -i :5009 >/dev/null 2>&1; then
  echo "Port 5009 is still in use. Please try a different port."
  PORT=5015
  echo "Starting server on port $PORT instead..."
else
  PORT=5009
  echo "Starting new server on port $PORT..."
fi

# Start the server with the --no-reload flag to prevent port conflicts
echo "===== Starting File Visualizer Server ====="
echo "Server will be available at: http://localhost:$PORT"
echo "Press Ctrl+C to stop the server"
echo "===== Server Output Below ====="

# Set environment variables and start the server
FLASK_RUN_PORT=$PORT FLASK_APP=server.py python server.py --port $PORT --no-reload 