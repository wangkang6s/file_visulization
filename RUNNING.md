# Running the File Visualizer Application

This document provides instructions for running the File Visualizer application on your local machine.

## Prerequisites

- Python 3.7 or higher
- pip (Python package installer)

## Installation

1. Clone the repository or download the source code
2. Navigate to the project directory
3. Install the required dependencies:
   ```
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

## Important Notes

- Ensure you have a stable internet connection as the application communicates with the Anthropic API
- File generation may take some time depending on the size and complexity of your files
- You need a valid Anthropic API key to use this application
- API usage will be billed according to your Anthropic account settings

## Troubleshooting

- If you encounter a "thinking parameter" error, ensure you're using the latest version of the Anthropic Python library
- Check the terminal logs for any error messages if the application is not working as expected
- If the port is already in use, the server will suggest alternative ports or commands to free up the port

## Stopping the Server

To stop the server:
- If running in the foreground: Press `Ctrl+C` in the terminal
- If running in the background: Run `pkill -f "python.*server.py"` 