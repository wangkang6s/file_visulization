from flask import Flask, request, jsonify, Response, stream_with_context
import os
import sys
import json
import uuid
import time
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
    from helper_function import create_gemini_client, GeminiStreamingResponse, format_stream_event
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

# Session cache
session_cache = {}

def handler(request):
    """
    Process a streaming request using Google Gemini API.
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
        
        # Reconnection support
        session_id = data.get('session_id', str(uuid.uuid4()))
        
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
        
        # Initialize session cache for this request
        session_cache[session_id] = {
            'created_at': time.time(),
            'last_updated': time.time(),
            'html_segments': [],
            'generated_text': '',
            'chunk_count': 0,
            'user_content': content[:100000],  # Store for potential reconnection
            'format_prompt': format_prompt,
            'model': GEMINI_MODEL,
            'max_tokens': max_tokens,
            'temperature': temperature
        }
        
        # Prepare prompt
        prompt = f"""
{SYSTEM_INSTRUCTION}

Here is the content to transform into a website:

{content[:100000]}
"""
        
        if format_prompt:
            prompt += f"\n\n{format_prompt}"
        
        print(f"Prepared prompt for Gemini with length: {len(prompt)}")
        
        # Define the streaming response generator
        def gemini_stream_generator():
            try:
                yield format_stream_event("stream_start", {"message": "Stream starting", "session_id": session_id})
                
                # Get the model
                try:
                    model = client.get_model(GEMINI_MODEL)
                    print(f"Successfully retrieved Gemini model: {GEMINI_MODEL}")
                except Exception as model_error:
                    error_detail = f"Failed to get Gemini model: {str(model_error)}"
                    print(f"Error: {error_detail}")
                    yield format_stream_event("error", {
                        "type": "error", 
                        "error": "Model creation failed",
                        "details": error_detail,
                        "session_id": session_id
                    })
                    return
                
                # Configure generation parameters
                generation_config = {
                    "max_output_tokens": max_tokens,
                    "temperature": temperature,
                    "top_p": GEMINI_TOP_P,
                    "top_k": GEMINI_TOP_K
                }
                
                print(f"Starting Gemini generation with config: {generation_config}")
                
                # Generate content 
                try:
                    # For Vercel, use non-streaming approach to avoid timeout issues
                    print("Using non-streaming approach for Vercel function")
                    
                    try:
                        # Set a shorter timeout for Vercel environment
                        response = model.generate_content(
                            prompt,
                            generation_config=generation_config,
                            stream=False  # Use non-streaming for Vercel to avoid timeouts
                        )
                        
                        # Process non-streaming response
                        print(f"Non-streaming response received")
                        
                        # Extract text safely
                        content_text = ""
                        try:
                            if hasattr(response, 'text'):
                                content_text = response.text
                            elif hasattr(response, 'parts') and response.parts:
                                content_text = response.parts[0].text
                            else:
                                content_text = str(response)
                            
                            print(f"Extracted content length: {len(content_text)}")
                        except Exception as text_error:
                            print(f"Error extracting text: {str(text_error)}")
                            if hasattr(response, 'resolve'):
                                try:
                                    resolved = response.resolve()
                                    if hasattr(resolved, 'text'):
                                        content_text = resolved.text
                                    print(f"Resolved response text: {len(content_text)}")
                                except Exception as resolve_error:
                                    print(f"Error resolving response: {str(resolve_error)}")
                        
                        # Only continue if we have content
                        if not content_text:
                            raise ValueError("Failed to extract content from Gemini response")
                        
                        # First yield a stream start event
                        yield format_stream_event("stream_start", {"message": "Stream starting", "session_id": session_id})
                        
                        # Then yield a content chunk
                        yield format_stream_event("content", {
                            "type": "content_block_delta",
                            "delta": {"text": content_text},
                            "session_id": session_id,
                            "chunk_id": f"{session_id}_1"
                        })
                        
                        # Then yield completion
                        input_tokens = max(1, int(len(prompt.split()) * 1.3))
                        output_tokens = max(1, int(len(content_text.split()) * 1.3))
                        
                        # Create a message_complete event
                        yield format_stream_event("content", {
                            "type": "message_complete",
                            "chunk_id": f"{session_id}_final",
                            "usage": {
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                                "total_cost": 0.0
                            },
                            "html": content_text,
                            "session_id": session_id
                        })
                        
                        # Stream end event
                        print("Gemini response processed successfully")
                        yield format_stream_event("stream_end", {
                            "message": "Stream complete",
                            "session_id": session_id
                        })
                    except Exception as generate_error:
                        error_detail = f"Failed to generate content: {str(generate_error)}"
                        print(f"Error: {error_detail}")
                        print(traceback.format_exc())
                        
                        yield format_stream_event("error", {
                            "type": "error", 
                            "error": "Generation failed",
                            "details": error_detail,
                            "session_id": session_id
                        })
                
                except Exception as e:
                    error_message = str(e)
                    print(f"Unexpected error in gemini_stream_generator: {error_message}")
                    print(traceback.format_exc())
                    
                    yield format_stream_event("error", {
                        "type": "error",
                        "error": error_message,
                        "details": traceback.format_exc(),
                        "session_id": session_id
                    })
            
            except Exception as e:
                error_message = str(e)
                print(f"Unexpected error in gemini_stream_generator: {error_message}")
                print(traceback.format_exc())
                
                yield format_stream_event("error", {
                    "type": "error",
                    "error": error_message,
                    "details": traceback.format_exc(),
                    "session_id": session_id
                })
        
        # Return the streaming response
        return Response(
            stream_with_context(gemini_stream_generator()),
            content_type='text/event-stream'
        )
    
    except Exception as outer_error:
        # Catch any exceptions that might occur outside the generator
        error_message = str(outer_error)
        print(f"Outer exception in process_gemini_stream: {error_message}")
        print(traceback.format_exc())
        return jsonify({
            'error': error_message,
            'details': traceback.format_exc()
        }), 500

@app.route('/', methods=['POST'])
def process_gemini_stream():
    return handler(request) 