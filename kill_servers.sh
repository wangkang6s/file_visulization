#!/bin/bash

# Kill any existing Python server processes
echo "Checking for existing server processes..."

# Find and kill processes using ports 5000-5020
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

# Wait for ports to be released
echo "Waiting for ports to be released..."
sleep 2

# Check if port 5009 is still in use
if lsof -i :5009 >/dev/null 2>&1; then
  echo "Port 5009 is still in use. Trying more aggressive cleanup..."
  # Try more aggressive cleanup
  lsof -i :5009 | awk 'NR>1 {print $2}' | xargs kill -9 2>/dev/null
  sleep 2
fi

# Check again if port 5009 is still in use
if lsof -i :5009 >/dev/null 2>&1; then
  echo "Port 5009 is still in use. Please try a different port."
  echo "Starting server on port 5010 instead..."
  python server.py --port 5010
else
  echo "Starting new server on port 5009..."
  python server.py --port 5009
fi 