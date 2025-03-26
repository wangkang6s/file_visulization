from flask import Flask, request, jsonify
import os
import sys
import json
import traceback
import time

# Add the parent directory to sys.path
parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Constants
GEMINI_MODEL = "models/gemini-2.5-pro-exp-03-25"
GEMINI_MAX_OUTPUT_TOKENS = 128000
GEMINI_TEMPERATURE = 1.0
GEMINI_TOP_P = 0.95
GEMINI_TOP_K = 64

# Import helper functions
try:
    from helper_function import create_gemini_client
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
    print("Google Generative AI module is available")
except ImportError:
    GEMINI_AVAILABLE = False
    print("Google Generative AI module is not installed")

# System instruction
SYSTEM_INSTRUCTION = """You are a web developer tasked with turning content into a beautiful, responsive website. 
Create valid, semantic HTML with embedded CSS (using Tailwind CSS) that transforms the provided content into a well-structured, modern-looking website.

Follow these guidelines:
1. Use Tailwind CSS for styling (via CDN) and create a beautiful, responsive design
2. Structure the content logically with appropriate HTML5 semantic elements
3. Make the website responsive across all device sizes
4. Include dark mode support with a toggle button
5. For code blocks, use proper syntax highlighting
6. Ensure accessibility by using appropriate ARIA attributes and semantics
7. Add subtle animations where appropriate
8. Include a navigation system if the content has distinct sections
9. Avoid using external JavaScript libraries other than Tailwind
10. Only generate HTML, CSS, and minimal JavaScript - no backend code or server setup

Return ONLY the complete HTML document with no explanations. The HTML should be ready to use as a standalone file."""

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
        content = data.get('content', '')
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

@app.route('/', methods=['POST'], endpoint='process_gemini')
def process_gemini():
    """
    Process a non-streaming request using Gemini API.
    """
    try:
        # Extract request data
        data = request.get_json()
        api_key = data.get('api_key')
        
        # Check for both 'content' and 'source' parameters for compatibility
        content = data.get('content', '')
        if not content:
            content = data.get('source', '')  # Fallback to 'source' if 'content' is empty
        
        # If content is empty, return an error
        if not content:
            return jsonify({"success": False, "error": "Source code or text is required"}), 400
        
        format_prompt = data.get('format_prompt', '')
        max_tokens = int(data.get('max_tokens', GEMINI_MAX_OUTPUT_TOKENS))
        temperature = float(data.get('temperature', GEMINI_TEMPERATURE))
        
        # Check if Gemini is available
        if not GEMINI_AVAILABLE:
            error_msg = 'Google Generative AI package is not installed on the server.'
            print(f"Error: {error_msg}")
            return jsonify({
                'error': error_msg,
                'details': 'Please install the Google Generative AI package with "pip install google-generativeai"'
            }), 500
        
        # Create Gemini client
        try:
            client = create_gemini_client(api_key)
            print(f"Gemini client created successfully with API key: {api_key[:4]}...")
        except Exception as e:
            error_msg = f"API key validation failed: {str(e)}"
            print(f"Error: {error_msg}")
            return jsonify({
                "success": False,
                "error": error_msg
            })
        
        # Prepare prompt
        prompt = f"""
{SYSTEM_INSTRUCTION}

Here is the content to transform into a website:

{content[:100000]}
"""
        
        if format_prompt:
            prompt += f"\n\n{format_prompt}"
        
        print(f"Prepared prompt for Gemini with length: {len(prompt)}")
        
        # Generate content
        try:
            # Start timer
            start_time = time.time()
            
            # Configure generation parameters
            generation_config = {
                "max_output_tokens": max_tokens,
                "temperature": temperature,
                "top_p": GEMINI_TOP_P,
                "top_k": GEMINI_TOP_K
            }
            
            # Generate the content using the new Client-based approach
            print("Generating content using Gemini...")
            response = client.models.generate_content(
                model=GEMINI_MODEL.replace("models/", ""),  # Remove 'models/' prefix as it's handled by the client
                contents=prompt,
                generation_config=generation_config
            )
            
            # Get text directly
            try:
                html_content = response.text
                print(f"Got content directly from text attribute: {len(html_content)}")
            except Exception as e:
                print(f"Could not get text attribute: {str(e)}")
                html_content = None
            
            # Check if we have content
            if not html_content:
                print("Failed to extract any content from Gemini response")
                return jsonify({
                    "success": False,
                    "error": "Could not extract content from Gemini response"
                }), 500
            
            end_time = time.time()
            generation_time = end_time - start_time
            
            # Calculate tokens (approximate)
            input_tokens = max(1, int(len(prompt.split()) * 1.3))
            output_tokens = max(1, int(len(html_content.split()) * 1.3))
            
            print(f"Successfully generated HTML with {output_tokens} tokens in {generation_time:.2f}s")
            
            # Return the response
            return jsonify({
                "success": True,
                "html": html_content,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                    "generation_time": generation_time
                }
            })
            
        except Exception as generation_error:
            error_msg = f"Gemini generation error: {str(generation_error)}"
            print(f"Error: {error_msg}")
            traceback.print_exc()
            
            return jsonify({
                "success": False,
                "error": error_msg,
                "details": traceback.format_exc()
            }), 500
            
    except Exception as request_error:
        error_msg = f"Error in request handler: {str(request_error)}"
        print(f"Error: {error_msg}")
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "error": error_msg,
            "details": traceback.format_exc()
        }), 500 