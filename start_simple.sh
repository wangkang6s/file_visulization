#!/bin/bash

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
fi

# Check if required packages are installed
if ! python -c "import flask; import anthropic; import PyPDF2; import docx" 2>/dev/null; then
    echo "Installing required packages..."
    pip install -r requirements.txt
fi

# Start the server
echo "Starting server on port 5009..."
python server.py --port=5009 --host=0.0.0.0 