#!/bin/bash

# Display banner
echo "====================================="
echo "  Claude 3.7 File Visualizer Starter"
echo "====================================="

# Kill any existing server processes
echo "Stopping any existing server processes..."
pkill -f "python.*server.py" 2>/dev/null || true

# Clear any port locks
echo "Clearing port locks..."
for port in {5000..5010}; do
  pid=$(lsof -ti :$port 2>/dev/null)
  if [ ! -z "$pid" ]; then
    echo "Killing process $pid using port $port"
    kill -9 $pid 2>/dev/null || true
  fi
done

# Set default port if not provided
PORT=${1:-5009}
echo "Starting server on port $PORT..."

# Start the server (removed the --no-debug flag which was causing issues)
python server.py --port=$PORT --no-reload

echo "Server stopped."
