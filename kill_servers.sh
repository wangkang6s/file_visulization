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
pkill -f "python server.py" 2>/dev/null

echo "Starting new server on port 5009..."
python server.py --port 5009 