from flask import Flask, request, jsonify
import os
import sys
import json
import traceback

# Add the parent directory to sys.path
parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Constants
GEMINI_MODEL = "gemini-1.5-pro"
GEMINI_MAX_OUTPUT_TOKENS = 128000
GEMINI_TEMPERATURE = 1.0
GEMINI_TOP_P = 0.95
GEMINI_TOP_K = 64

# Import helper functions
try:
    from helper_function import create_gemini_client
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("Google Generative AI package not available. Some features may be limited.")

# System instruction
SYSTEM_INSTRUCTION = """
You are a web developer specialized in converting content into beautiful, accessible, responsive HTML with modern CSS.
Generate a single-page website from the given content.
"""

# Initialize Flask app
app = Flask(__name__)

def handler(request):
    """
    Process a file using the Google Gemini API and return HTML.
    """
    # Get the data from the request
    print("\n==== API PROCESS GEMINI REQUEST RECEIVED ====")
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        # Extract the API key and content
        api_key = data.get('api_key')
        content = data.get('content')
        format_prompt = data.get('format_prompt', '')
        max_tokens = int(data.get('max_tokens', GEMINI_MAX_OUTPUT_TOKENS))
        temperature = float(data.get('temperature', GEMINI_TEMPERATURE))
        
        print(f"Processing Gemini request with max_tokens={max_tokens}, content_length={len(content) if content else 0}")
        
        # Check if we have the required data
        if not api_key or not content:
            return jsonify({'error': 'API key and content are required'}), 400
        
        # Check if Gemini is available
        if not GEMINI_AVAILABLE:
            return jsonify({
                'error': 'Google Generative AI package is not installed on the server.'
            }), 500
        
        # Use our helper function to create a Gemini client
        client = create_gemini_client(api_key)
        
        # Prepare user message with content and additional prompt
        user_content = content
        if format_prompt:
            user_content = f"{user_content}\n\n{format_prompt}"
        
        print("Creating Gemini model...")
        
        # Get the model
        model = client.get_model(GEMINI_MODEL)
        
        # Configure generation parameters
        generation_config = {
            "max_output_tokens": max_tokens,
            "temperature": temperature,
            "top_p": GEMINI_TOP_P,
            "top_k": GEMINI_TOP_K
        }
        
        # Create the prompt
        prompt = f"""
{SYSTEM_INSTRUCTION}

Here is the content to transform into a website:

{user_content}
"""
        
        # Generate content
        response = model.generate_content(
            prompt,
            generation_config=generation_config
        )
        
        # Extract the HTML from the response
        html_content = ""
        if hasattr(response, 'text'):
            html_content = response.text
        else:
            # Try to access response parts if available
            if hasattr(response, 'parts') and response.parts:
                html_content = response.parts[0].text
        
        # If we still don't have content, use string representation
        if not html_content:
            html_content = str(response)
        
        # Get usage stats (approximate since Gemini doesn't provide exact token counts)
        input_tokens = len(prompt.split()) * 1.3  # Rough estimate: ~1.3 tokens per word
        output_tokens = len(html_content.split()) * 1.3
        
        # Ensure we don't have zero tokens (minimum of source length / 3)
        input_tokens = max(len(content.split()) * 1.3, input_tokens)
        
        # Round to integers
        input_tokens = max(1, int(input_tokens))
        output_tokens = max(1, int(output_tokens))
        
        # Log response
        print(f"Successfully generated HTML with Gemini. Input tokens: {input_tokens}, Output tokens: {output_tokens}")
        
        # Return the response
        return jsonify({
            'html': html_content,
            'model': GEMINI_MODEL,
            'usage': {
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'total_tokens': input_tokens + output_tokens,
                'total_cost': 0.0  # Gemini API is currently free
            }
        })
    
    except Exception as e:
        error_message = str(e)
        print(f"Error in /api/process-gemini: {error_message}")
        print(traceback.format_exc())
        return jsonify({
            'error': f'Server error: {error_message}',
            'details': traceback.format_exc()
        }), 500

@app.route('/', methods=['POST'])
def process_gemini():
    return handler(request) 