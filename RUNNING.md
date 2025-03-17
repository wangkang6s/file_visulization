# Running the File Visualizer Application

This document provides instructions for running the File Visualizer application on your local machine.

## Prerequisites

- Python 3.8 or higher
- pip (Python package installer)
- Anthropic API key (for Claude 3.7)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/hubeiqiao/File-Visualizer.git
   cd File-Visualizer
   ```

2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running the Server

### Using the Start Script (Recommended)

The easiest way to run the server is using the provided start script:

```bash
./start_server.sh [port]
```

This script will:
- Kill any existing server processes
- Start a new server on port 5001 (or the port you specify)
- Run the server without debug mode for better stability

Example with custom port:
```bash
./start_server.sh 5002
```

### Manual Method

If you prefer to run the server manually:

1. Stop any existing server processes:
   ```bash
   pkill -f "python.*server.py"
   ```

2. Start the server:
   ```bash
   python server.py --port=5001 --no-debug
   ```

## Accessing the Application

Once the server is running, access the application by opening your web browser and navigating to:
```
http://localhost:5001
```
(or the custom port you specified)

## Using the Application

1. Enter your Anthropic API key when prompted
2. Upload a file (PDF, DOCX, TXT) or paste text directly
3. Adjust parameters if needed:
   - Temperature (creativity level)
   - Max tokens (output length)
   - Thinking budget (for Claude's thinking process)
4. Add custom instructions (optional)
5. Click "Generate Visualization"
6. View the result, copy the HTML, or download the file

## Troubleshooting

- If you encounter a "thinking parameter" error, ensure you're using the latest version of the Anthropic Python library
- Check the terminal logs for any error messages if the application is not working as expected
- If the port is already in use, the server will suggest alternative ports or commands to free up the port

## Stopping the Server

To stop the server:
- If running in the foreground: Press `Ctrl+C` in the terminal
- If running in the background: Run `pkill -f "python.*server.py"` 