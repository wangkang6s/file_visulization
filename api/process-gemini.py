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
        try:
            print("Generating content with Gemini (non-streaming)")
            response = model.generate_content(
                prompt,
                generation_config=generation_config
            )
            
            # Extract the HTML from the response using multiple methods
            html_content = ""
            
            try:
                # Try standard text attribute first
                if hasattr(response, 'text'):
                    html_content = response.text
                    print(f"Extracted content from text attribute: {len(html_content)} chars")
                # Then try parts
                elif hasattr(response, 'parts') and response.parts:
                    for part in response.parts:
                        if hasattr(part, 'text'):
                            html_content += part.text
                    print(f"Extracted content from parts: {len(html_content)} chars")
                # Then check candidates
                elif hasattr(response, 'candidates') and response.candidates:
                    for candidate in response.candidates:
                        if hasattr(candidate, 'content') and candidate.content:
                            if hasattr(candidate.content, 'parts') and candidate.content.parts:
                                for part in candidate.content.parts:
                                    if hasattr(part, 'text'):
                                        html_content += part.text
                    print(f"Extracted content from candidates: {len(html_content)} chars")
                else:
                    # Last resort: try string conversion
                    html_content = str(response)
                    print(f"Extracted content using string conversion: {len(html_content)} chars")
            except Exception as extract_error:
                print(f"Error extracting content: {str(extract_error)}")
                # Try the resolve method as a fallback
                try:
                    if hasattr(response, 'resolve'):
                        resolved = response.resolve()
                        if hasattr(resolved, 'text'):
                            html_content = resolved.text
                            print(f"Extracted content through resolve: {len(html_content)} chars")
                except Exception as resolve_error:
                    print(f"Error resolving response: {str(resolve_error)}")
            
            # If we still don't have content, this is an error
            if not html_content:
                raise ValueError("Could not extract content from Gemini response")
            
            # Get usage stats (approximate since Gemini doesn't provide exact token counts)
            input_tokens = max(1, int(len(prompt.split()) * 1.3))
            output_tokens = max(1, int(len(html_content.split()) * 1.3))
            
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