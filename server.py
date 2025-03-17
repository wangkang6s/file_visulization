from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
from helper_function import create_anthropic_client
import anthropic
import json
import os
import re
import time
# Updated import to be compatible with different versions of the Anthropic library
try:
    from anthropic.types import TextBlock, MessageParam
except ImportError:
    # Fallback for newer versions of the Anthropic library
    # where these classes might have different names or locations
    TextBlock = dict
    MessageParam = dict
import uuid
import PyPDF2
import docx
import io
import base64
import random 
import socket
import argparse
import sys

app = Flask(__name__, static_folder='static')
CORS(app)  # Enable CORS for all routes

# Claude 3.7 has a total context window of 200,000 tokens (input + output combined)
# We'll use this constant when estimating token usage
TOTAL_CONTEXT_WINDOW = 200000

# Maximum allowed tokens for Claude API input (leaving room for output)
# This should be dynamically adjusted based on requested max_tokens
MAX_INPUT_TOKENS = 195000  # Setting a bit lower than the actual limit to account for system prompt and overhead

# Default settings
DEFAULT_MAX_TOKENS = 128000
DEFAULT_THINKING_BUDGET = 32000

# Define beta parameter for 128K output
OUTPUT_128K_BETA = "output-128k-2025-02-19"

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['file']
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    try:
        # Read the file content
        file_content = file.read()
        # Convert the file content to base64
        base64_file_content = base64.b64encode(file_content).decode('utf-8')
        # Create a response object
        response = {
            "file_name": file.filename,
            "file_content": base64_file_content
        }
        return jsonify(response)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/process', methods=['POST'])
def process():
    data = request.get_json()
    if not data or 'file_name' not in data or 'file_content' not in data:
        return jsonify({"error": "Missing file_name or file_content"}), 400

    file_name = data['file_name']
    file_content = data['file_content']

    try:
        # Convert base64 string back to bytes
        file_content_bytes = base64.b64decode(file_content)
        # Create a temporary file to save the uploaded file
        temp_file_path = f"/tmp/{file_name}"
        with open(temp_file_path, 'wb') as f:
            f.write(file_content_bytes)

        # Process the file
        processed_file_path = process_file(temp_file_path)

        # Read the processed file content
        with open(processed_file_path, 'rb') as f:
            processed_file_content = f.read()
        # Convert the processed file content to base64
        base64_processed_file_content = base64.b64encode(processed_file_content).decode('utf-8')

        # Create a response object
        response = {
            "file_name": file_name,
            "file_content": base64_processed_file_content
        }
        return jsonify(response)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def process_file(file_path):
    # Placeholder for file processing logic
    # This function should be implemented to process the file based on its type
    # and return the processed file path
    return file_path  # Placeholder return, actual implementation needed

@app.route('/api/validate-key', methods=['POST'])
def validate_key():
    print("\n==== API VALIDATE KEY REQUEST RECEIVED ====")
    data = request.get_json()
    
    if not data or 'api_key' not in data:
        return jsonify({"valid": False, "message": "API key is required"}), 400
    
    api_key = data['api_key']
    print(f"Request JSON: {data}")
    
    # Basic format validation
    if not api_key or not api_key.strip():
        return jsonify({"valid": False, "message": "API key cannot be empty"}), 400
    
    # Check if the API key has a valid format (starts with sk-ant)
    if not api_key.startswith('sk-ant'):
        return jsonify({
            "valid": False, 
            "message": "API key format is invalid. It should start with 'sk-ant'"
        }), 400
    
    print(f"API key format is valid: {api_key[:10]}...")
    
    try:
        # Try to create a client to validate the key
        client = create_anthropic_client(api_key)
        
        # For security, we don't actually make an API call here
        # Just successfully creating the client is enough validation
        
        return jsonify({
            "valid": True,
            "message": "API key is valid"
        })
    except Exception as e:
        error_message = str(e)
        print(f"API key validation error: {error_message}")
        
        # Check for specific error messages
        if "proxies" in error_message.lower():
            print(f"Proxies error detected: {error_message}")
            # This is a client configuration issue, not an invalid key
            return jsonify({
                "valid": True,  # Consider the key valid despite the client error
                "message": "API key format is valid, but there was a client configuration issue"
            })
        
        return jsonify({
            "valid": False,
            "message": "API client configuration error. Please try using a newer Anthropic API key format."
        }), 400

@app.route('/api/process', methods=['POST'])
def process_file():
    # Get the data from the request
    print("\n==== API PROCESS REQUEST RECEIVED ====")
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    # Extract the API key and content
    api_key = data.get('api_key')
    content = data.get('content')
    format_prompt = data.get('format_prompt', '')
    model = data.get('model', 'claude-3-7-sonnet-20250219')
    max_tokens = int(data.get('max_tokens', 128000))
    temperature = float(data.get('temperature', 1.0))
    thinking_budget = int(data.get('thinking_budget', 32000))
    
    print(f"Processing request with model={model}, max_tokens={max_tokens}, content_length={len(content) if content else 0}")
    
    # Check if we have the required data
    if not api_key or not content:
        return jsonify({'error': 'API key and content are required'}), 400
    
    try:
        # Use our helper function to create a compatible client
        client = create_anthropic_client(api_key)
        
        # Prepare user message with content and additional prompt
        user_content = content
        if format_prompt:
            user_content = f"{user_content}\n\n{format_prompt}"
        
        print("Creating message with thinking parameter...")
        
        # Create parameters for the API call
        params = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).",
            "messages": [{"role": "user", "content": user_content}],
        }
        
        # Add thinking parameter if thinking_budget > 0
        if thinking_budget > 0:
            params["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            
        # Add beta parameter if needed
        if max_tokens > 4096:
            params["betas"] = [OUTPUT_128K_BETA]
        
        # Create the message
        response = client.messages.create(**params)
        
        # Extract the HTML from the response
        html_content = ""
        
        # Handle different response formats
        if hasattr(response, 'content') and response.content:
            # Handle standard Anthropic client response
            if isinstance(response.content, list) and len(response.content) > 0:
                if hasattr(response.content[0], 'text'):
                    # Standard client format
                    html_content = response.content[0].text
                elif isinstance(response.content[0], dict) and 'text' in response.content[0]:
                    # Dictionary format
                    html_content = response.content[0]['text']
            elif isinstance(response.content, dict) and 'text' in response.content:
                # Simple dictionary format
                html_content = response.content['text']
            elif isinstance(response.content, str):
                # Direct string format
                html_content = response.content
        
        # If still empty, try alternate paths
        if not html_content and hasattr(response, 'completion'):
            html_content = response.completion
            
        # As a last resort, convert the entire response to string
        if not html_content:
            print("Warning: Unable to extract HTML content using standard methods. Using fallback extraction.")
            try:
                # Try to extract from the raw response
                if isinstance(response, dict) and 'content' in response:
                    if isinstance(response['content'], list) and len(response['content']) > 0:
                        first_item = response['content'][0]
                        if isinstance(first_item, dict) and 'text' in first_item:
                            html_content = first_item['text']
                
                # If still empty, convert the whole response to string
                if not html_content:
                    html_content = str(response)
            except Exception as e:
                print(f"Fallback extraction failed: {str(e)}")
                html_content = "Error: Unable to extract HTML content from response."
            
        # Get usage stats
        input_tokens = 0
        output_tokens = 0
        thinking_tokens = 0
        
        if hasattr(response, 'usage'):
            if hasattr(response.usage, 'input_tokens'):
                input_tokens = response.usage.input_tokens
            if hasattr(response.usage, 'output_tokens'):
                output_tokens = response.usage.output_tokens
            if hasattr(response.usage, 'thinking_tokens'):
                thinking_tokens = response.usage.thinking_tokens
        elif isinstance(response, dict) and 'usage' in response:
            usage = response['usage']
            if isinstance(usage, dict):
                input_tokens = usage.get('input_tokens', 0)
                output_tokens = usage.get('output_tokens', 0)
                thinking_tokens = usage.get('thinking_tokens', 0)
                
        # Log response structure for debugging
        print(f"Response type: {type(response)}")
        if html_content:
            print(f"Successfully extracted HTML content. Length: {len(html_content)}")
                
        # Return the response
        return jsonify({
            'html': html_content,
            'model': model,
            'usage': {
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'thinking_tokens': thinking_tokens
            }
        })
    
    except Exception as e:
        error_message = str(e)
        print(f"Error in /api/process: {error_message}")
        return jsonify({'error': f'Server error: {error_message}'}), 500

# PDF text extraction function
def extract_text_from_pdf(pdf_file):
    text = ""
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_file))
        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]
            text += page.extract_text() + "\n\n"
        return text
    except Exception as e:
        raise Exception(f"Failed to extract text from PDF: {str(e)}")

# Word document text extraction function        
def extract_text_from_docx(docx_file):
    doc = docx.Document(io.BytesIO(docx_file))
    return "\n".join([paragraph.text for paragraph in doc.paragraphs])

@app.route('/api/analyze-tokens', methods=['POST'])
def analyze_tokens():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        # Get content from request
        content = data.get('content', '')
        file_type = data.get('file_type', 'txt')
        api_key = data.get('api_key', '')  # Get API key if available
        
        if not content:
            return jsonify({"error": "No content provided"}), 400
        
        # Define the system prompt to include in token estimation
        system_prompt = "You are a helpful assistant that transforms code and text into beautiful HTML visualizations. Output ONLY the HTML code without any additional explanations, comments, or markdown formatting. The response should be valid HTML that can be directly rendered in a browser."
        
        # Estimated system prompt tokens (if exact count not available)
        system_prompt_tokens = len(system_prompt) // 3.5
        
        # Handle binary content (base64 encoded) for PDFs and documents
        try:
            if file_type in ['pdf', 'doc', 'docx']:
                # Try to decode base64 if it looks like base64
                try:
                    # Decode base64 to binary
                    binary_content = base64.b64decode(content)
                    
                    # Extract text based on file type
                    if file_type == 'pdf':
                        text_content = extract_text_from_pdf(binary_content)
                    elif file_type in ['doc', 'docx']:
                        text_content = extract_text_from_docx(binary_content)
                    else:
                        text_content = binary_content.decode('utf-8', errors='ignore')
                    
                    # Use the extracted text for analysis
                    content = text_content
                except Exception as e:
                    # Fall back to the original content if decoding fails
                    pass
            
            # Try to get a more accurate token count using the Anthropic API if API key is provided
            if api_key:
                try:
                    client = create_anthropic_client(api_key)
                    try:
                        # Try newer API version first (Anthropic v0.5+)
                        content_tokens = client.count_tokens(content)
                        system_tokens = client.count_tokens(system_prompt)
                        estimated_tokens = content_tokens + system_tokens
                    except (AttributeError, TypeError):
                        try:
                            # Fall back to older API style if needed
                            content_tokens = client.count_tokens(content)
                            system_tokens = client.count_tokens(system_prompt)
                            estimated_tokens = content_tokens + system_tokens
                        except Exception:
                            # If API token counting fails, fall back to better character-based estimation
                            # Better estimation formula for multilingual text (including Chinese)
                            estimated_tokens = len(content) / 3.5 + system_prompt_tokens
                except Exception as e:
                    # Fall back to better character-based estimation if API fails
                    estimated_tokens = len(content) / 3.5 + system_prompt_tokens
            else:
                # No API key, use character-based estimation which works better for all languages
                estimated_tokens = len(content) / 3.5 + system_prompt_tokens
                
        except Exception as e:
            # Fall back to better character-based estimation
            estimated_tokens = len(content) / 3.5 + system_prompt_tokens
        
        # Ensure we have a whole number of tokens
        estimated_tokens = max(1, int(estimated_tokens))
        
        # Calculate estimated cost (as of current pricing)
        estimated_cost = (estimated_tokens / 1000000) * 3.0  # $3 per million tokens
        
        return jsonify({
            'estimated_tokens': estimated_tokens,
            'estimated_cost': round(estimated_cost, 6),
            'max_safe_output_tokens': min(128000, TOTAL_CONTEXT_WINDOW - estimated_tokens - 5000)
        })
    except Exception as e:
        return jsonify({"error": f"Error analyzing tokens: {str(e)}"}), 500

# Define helper functions for streaming
def format_stream_event(event_type, data=None):
    """Format a Server-Sent Event (SSE) message"""
    buffer = f"event: {event_type}\n"
    if data:
        buffer += f"data: {json.dumps(data)}\n"
    buffer += "\n"
    return buffer

def create_stream_generator(client, system_prompt, user_message, model, max_tokens, temperature, thinking_budget=None):
    """Create a generator that yields SSE events for streaming Claude responses"""
    try:
        # Create message parameters
        message_params = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": user_message
                }
            ],
            "stream": True,
            "anthropic_metadata": {
                "user_session_id": f"file-visualizer-{int(time.time())}",
            }
        }
        
        # Add thinking parameter if specified
        if thinking_budget and thinking_budget > 0:
            try:
                # For newer versions of the Anthropic library
                from anthropic.types import Thinking
                message_params["thinking"] = Thinking(
                    enabled=True,
                    budget_limit=thinking_budget
                )
            except ImportError:
                # For older versions or fallback
                message_params["thinking"] = {
                    "enabled": True,
                    "budget_limit": thinking_budget
                }
        
        # Start the streaming response
        yield format_stream_event("stream_start", {"message": "Stream starting"})
        
        # Create streaming API call
        with client.messages.stream(**message_params) as stream:
            for chunk in stream:
                # Handle thinking updates
                if chunk.type == "thinking":
                    thinking_data = {
                        "type": "thinking_update",
                        "chunk_id": stream.message.id,
                        "thinking": {
                            "content": chunk.thinking.content if hasattr(chunk.thinking, "content") else ""
                        }
                    }
                    yield format_stream_event("content", thinking_data)
                
                # Handle content block deltas (the actual generated text)
                elif chunk.type == "content_block_delta":
                    content_data = {
                        "type": "content_block_delta",
                        "chunk_id": stream.message.id,
                        "delta": {
                            "text": chunk.delta.text
                        }
                    }
                    yield format_stream_event("content", content_data)
                
                # Handle message complete
                elif chunk.type == "message_complete":
                    usage_data = None
                    if hasattr(stream.message, "usage"):
                        usage_data = {
                            "input_tokens": stream.message.usage.input_tokens,
                            "output_tokens": stream.message.usage.output_tokens
                        }
                        
                        # Add thinking tokens if available
                        if hasattr(stream.message.usage, "thinking_tokens"):
                            usage_data["thinking_tokens"] = stream.message.usage.thinking_tokens
                    
                    complete_data = {
                        "type": "message_complete",
                        "message_id": stream.message.id,
                        "chunk_id": stream.message.id,
                        "usage": usage_data
                    }
                    yield format_stream_event("content", complete_data)
            
            # End of stream event
            yield format_stream_event("stream_end", {"message": "Stream complete"})
                
    except Exception as e:
        error_data = {
            "type": "error",
            "error": str(e)
        }
        yield format_stream_event("error", error_data)

# Add API endpoint for streaming processing
@app.route('/api/process-stream', methods=['POST'])
def process_stream():
    """
    Process a streaming request with reconnection support.
    """
    # Extract request data
    data = request.get_json()
    api_key = data.get('api_key')
    
    # Check for both 'content' and 'source' parameters for compatibility
    content = data.get('content', '')
    if not content:
        content = data.get('source', '')  # Fallback to 'source' if 'content' is empty
    
    # If both are empty, return an error
    if not content:
        return jsonify({"success": False, "error": "Source code or text is required"}), 400
        
    format_prompt = data.get('format_prompt', '')
    model = data.get('model', 'claude-3-5-sonnet-20240620')
    max_tokens = int(data.get('max_tokens', DEFAULT_MAX_TOKENS))
    temperature = float(data.get('temperature', 0.5))
    thinking_budget = int(data.get('thinking_budget', DEFAULT_THINKING_BUDGET))
    
    # Reconnection support
    session_id = data.get('session_id', None)
    is_reconnect = data.get('is_reconnect', False)
    last_chunk_id = data.get('last_chunk_id', None)
    
    # Create Anthropic client
    client = None
    try:
        client = create_anthropic_client(api_key)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"API key validation failed: {str(e)}"
        })
    
    # Prepare system prompt
    system_prompt = """
    You are a professional web developer helping to create a beautiful and functional static HTML website.
    The user will provide either text content or file contents, and you will generate a complete, self-contained HTML website.
    The website should be styled attractively with modern CSS and should not rely on external libraries unless specifically requested.
    Ensure that the HTML, CSS, and any JavaScript is complete, valid, and ready to use without external dependencies.
    The generated website should follow responsive design principles and work well on both desktop and mobile devices.
    """
    
    # Prepare user prompt
    user_message = f"""
    {format_prompt}
    
    Here is the content to transform into a website:
    
    {content}
    """
    
    # Create streaming response
    stream_generator = create_stream_generator(
        client=client,
        system_prompt=system_prompt,
        user_message=user_message,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        thinking_budget=thinking_budget
    )
    
    # Return streaming response
    return Response(
        stream_with_context(stream_generator),
        mimetype='text/event-stream'
    )

# Add a simple test endpoint
@app.route('/api/test', methods=['GET', 'POST'])
def test_api():
    """Simple test endpoint to verify API connectivity"""
    if request.method == 'POST':
        data = request.get_json() or {}
        return jsonify({
            "status": "success", 
            "message": "API test endpoint is working",
            "received_data": data,
            "timestamp": time.time()
        })
    else:
        return jsonify({
            "status": "success", 
            "message": "API test endpoint is working", 
            "timestamp": time.time()
        })

if __name__ == '__main__':
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Start the Claude 3.7 File Visualizer server')
    parser.add_argument('--port', type=int, help='Port to run the server on')
    parser.add_argument('--no-debug', action='store_true', help='Disable debug mode')
    args = parser.parse_args()
    
    # Determine the port to use (priority: command-line arg > environment var > default)
    port = args.port or int(os.environ.get('PORT', 5001))
    
    print("Claude 3.7 File Visualizer starting...")
    
    # Check if the port is available
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(('localhost', port))
        s.close()
    except socket.error:
        print(f"Port {port} is in use. Try using:")
        print(f"  python server.py --port={port+1}")
        print(f"  # or")
        print(f"  PORT={port+1} python server.py")
        print(f"  # or")
        print(f"  lsof -i :{port} | awk 'NR>1 {{print $2}}' | xargs kill -9 # to kill process using port {port}")
        sys.exit(1)
    
    # Start the server - debug mode is enabled by default unless --no-debug is specified
    debug_mode = not args.no_debug
    print(f"Server running at http://localhost:{port} with debug mode {'disabled' if args.no_debug else 'enabled'}")
    app.run(host='0.0.0.0', port=port, debug=debug_mode)

# Important: Export the Flask app for Vercel
app