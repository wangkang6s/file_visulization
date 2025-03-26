# Helper functions for server.py
import anthropic
import os
import json
import requests
import time
import uuid
import base64
import traceback

# Import Google Generative AI package
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("Google Generative AI package not available. Some features may be limited.")

def create_anthropic_client(api_key):
    """Create an Anthropic client with the given API key."""
    print(f"Creating Anthropic client with API key: {api_key[:8]}...")
    
    # Check if API key is valid format
    if not api_key or not api_key.strip():
        raise ValueError("API key cannot be empty")
    
    # Try to create the client with the standard approach first
    try:
        # Create client with only the essential parameter
        client = anthropic.Anthropic(api_key=api_key)
        
        # Test a simple call to verify the client works
        try:
            # Try a simple call that doesn't cost tokens
            client.count_tokens("Test")
            return client
        except Exception as e:
            print(f"Warning: Token counting failed but client might still work: {str(e)}")
            return client
            
    except Exception as e:
        print(f"Standard client creation failed: {str(e)}")
        
        # Try the fallback client approach
        try:
            print("Using custom Anthropic client implementation")
            return VercelCompatibleClient(api_key)
        except Exception as e2:
            print(f"Custom client also failed: {str(e2)}")
            raise Exception(f"Failed to create Anthropic client: {str(e)}")

def create_gemini_client(api_key):
    """Create a Google Gemini client with the given API key."""
    if not GEMINI_AVAILABLE:
        raise ImportError("Google Generative AI package is not installed. Please install it with 'pip install google-generativeai'.")
    
    print(f"Creating Google Gemini client with API key: {api_key[:8]}...")
    
    # Check if API key is valid format
    if not api_key or not api_key.strip():
        raise ValueError("API key cannot be empty")
    
    try:
        # Configure the Gemini client
        genai.configure(api_key=api_key)
        
        # Create a simple wrapper class that provides the methods expected by the server
        class GeminiClient:
            def __init__(self):
                pass
                
            def get_model(self, model_name):
                """Create and return a GenerativeModel instance for the specified model."""
                try:
                    return genai.GenerativeModel(model_name)
                except Exception as e:
                    print(f"Error creating model {model_name}: {str(e)}")
                    raise
        
        # Create and return the client wrapper
        return GeminiClient()
            
    except Exception as e:
        print(f"Gemini client creation failed: {str(e)}")
        raise Exception(f"Failed to create Google Gemini client: {str(e)}")

class GeminiStreamingResponse:
    """Custom class to handle streaming responses from Gemini"""
    
    def __init__(self, stream_response, session_id):
        self.stream_response = stream_response
        self.session_id = session_id
        self.chunk_count = 0
        self.generated_text = ""
        self.current_segment = ""
        self.current_segment_size = 0
        self.segment_counter = 0
        self.max_segment_size = 16384  # 16KB per segment
        self.html_segments = []
        self.start_time = time.time()
        self.received_content = False
        self.iterator_complete = False
        
        # Log initialization
        print(f"Initialized GeminiStreamingResponse for session {session_id}")
        
        # Check if the stream_response is an iterator or a single response
        self.is_iterator = hasattr(stream_response, '__iter__') and hasattr(stream_response, '__next__')
        print(f"Response is iterator: {self.is_iterator}, type: {type(stream_response)}")
        
        # If it's a single response, we'll handle it differently
        if not self.is_iterator:
            try:
                # For non-streaming responses, safely check for text content
                if hasattr(stream_response, 'text'):
                    self.generated_text = stream_response.text
                    self.received_content = True
                # If response has parts (common for Gemini)
                elif hasattr(stream_response, 'parts') and len(stream_response.parts) > 0:
                    self.generated_text = stream_response.parts[0].text
                    self.received_content = True
                # Last resort, try string representation
                else:
                    self.generated_text = str(stream_response)
                    self.received_content = True
                
                print(f"Single response mode - content length: {len(self.generated_text) if self.generated_text else 0}")
            except Exception as e:
                print(f"Error extracting text from non-streaming response: {str(e)}")
                # We'll try to handle this in __next__
    
    def __enter__(self):
        print(f"Entering GeminiStreamingResponse context for session {self.session_id}")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        end_time = time.time()
        elapsed = end_time - self.start_time
        
        if exc_type:
            print(f"Exception in GeminiStreamingResponse: {exc_type.__name__}: {exc_val}")
            if exc_tb:
                traceback.print_tb(exc_tb)
            return False  # Re-raise the exception
        
        # Send a final segment with content if content was received but not yet sent
        if self.received_content and self.current_segment and self.current_segment_size > 0:
            try:
                final_segment_event = self._create_content_event()
                print(f"Sending final segment {self.segment_counter} with size {self.current_segment_size}")
                return final_segment_event
            except Exception as e:
                print(f"Error sending final segment: {str(e)}")
        
        # Log completion statistics
        total_segments = len(self.html_segments)
        total_text_length = len(self.generated_text)
        print(f"GeminiStreamingResponse completed: {total_segments} segments, {total_text_length} chars in {elapsed:.2f}s")
    
    def __iter__(self):
        return self
    
    def __next__(self):
        # If we've already indicated the iterator is complete, stop iteration
        if self.iterator_complete:
            print("Iterator already complete, stopping iteration")
            raise StopIteration
        
        # Handle single-response mode (non-iterator)
        if not self.is_iterator:
            if not self.generated_text:
                # No content to return
                self.iterator_complete = True
                raise StopIteration
            
            # We have content to return, mark as complete
            self.iterator_complete = True
            
            # Create a full content event with the entire text
            self.current_segment = self.generated_text
            self.current_segment_size = len(self.generated_text)
            self.html_segments.append(self.current_segment)
            self.segment_counter += 1
            
            # Estimate tokens for usage statistics
            input_tokens = max(1, int(len(self.generated_text.split()) * 1.3))  # ~1.3 tokens per word
            output_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
            
            # Create a message_complete event
            complete_event = format_stream_event("content", {
                "type": "message_complete",
                "chunk_id": f"{self.session_id}_1",
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                    "total_cost": 0.0  # Gemini API is free
                },
                "html": self.generated_text,
                "session_id": self.session_id
            })
            print(f"Single response complete - content length: {len(self.generated_text)}")
            return complete_event
        
        # Handle streaming mode (iterator)
        try:
            # Use a non-recursive approach with a loop to handle chunks
            while True:
                try:
                    # Get the next chunk from the stream
                    chunk = next(self.stream_response)
                    self.chunk_count += 1
                    
                    # Process the chunk if it has text
                    if hasattr(chunk, 'text') and chunk.text:
                        text = chunk.text
                        self.received_content = True
                        self.generated_text += text
                        self.current_segment += text
                        self.current_segment_size += len(text)
                        
                        # Check if we should close and send this segment
                        if (self.current_segment_size >= self.max_segment_size or 
                            (self.current_segment_size > 256 and
                             (text.endswith('</div>') or 
                              text.endswith('</section>') or
                              text.endswith('</p>') or
                              text.endswith('</table>') or
                              text.endswith('</li>') or
                              text.endswith('</h1>') or
                              text.endswith('</h2>') or
                              text.endswith('</h3>') or
                              text.endswith('</html>')))):
                            
                            # Store this segment
                            self.html_segments.append(self.current_segment)
                            self.segment_counter += 1
                            
                            # Create an event for this segment
                            event = self._create_content_event()
                            
                            # Reset the segment buffer
                            self.current_segment = ""
                            self.current_segment_size = 0
                            
                            # Debug log for segment
                            if self.segment_counter % 5 == 0:
                                print(f"Sent segment {self.segment_counter} with size {len(self.html_segments[-1])}")
                            
                            return event
                        
                        # If we're not sending a segment yet, send a keepalive every few chunks
                        if self.chunk_count % 10 == 0:
                            return format_stream_event("keepalive", {
                                "timestamp": time.time(),
                                "session_id": self.session_id,
                                "chunk_count": self.chunk_count
                            })
                    
                    # If we didn't return an event, continue to the next iteration
                    continue
                    
                except StopIteration:
                    # End of stream
                    print("Stream iterator completed")
                    # Send final usage statistics if we have content
                    if self.generated_text:
                        # If we have remaining content in the current segment, send it
                        if self.current_segment and self.current_segment_size > 0:
                            self.html_segments.append(self.current_segment)
                            self.segment_counter += 1
                            final_event = self._create_content_event()
                            self.current_segment = ""
                            self.current_segment_size = 0
                            print(f"Sending final content segment with size {len(self.html_segments[-1])}")
                            return final_event
                        
                        # Create a message_complete event with final stats
                        input_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                        output_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                        
                        completion_event = format_stream_event("content", {
                            "type": "message_complete",
                            "chunk_id": f"{self.session_id}_{self.chunk_count}",
                            "usage": {
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                                "total_cost": 0.0  # Gemini API is free
                            },
                            "html": self.generated_text,
                            "session_id": self.session_id
                        })
                        
                        # Set iterator as complete
                        self.iterator_complete = True
                        print(f"Stream complete - total content length: {len(self.generated_text)}")
                        return completion_event
                    
                    # No content received, so just stop
                    self.iterator_complete = True
                    raise StopIteration
                    
                except (TypeError, AttributeError) as e:
                    # Not an iterator or attribute error when iterating
                    print(f"Error iterating through stream: {str(e)}")
                    
                    # If we have content, return a completion event
                    if self.generated_text:
                        input_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                        output_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                        
                        self.iterator_complete = True
                        return format_stream_event("content", {
                            "type": "message_complete",
                            "chunk_id": f"{self.session_id}_error",
                            "usage": {
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                                "total_cost": 0.0  # Gemini API is free
                            },
                            "html": self.generated_text,
                            "session_id": self.session_id
                        })
                    
                    # No content, just end iteration
                    self.iterator_complete = True
                    raise StopIteration
                    
                except Exception as e:
                    print(f"Unexpected error in stream iteration: {str(e)}")
                    
                    # Special handling for the Google AI library's IncompleteIterationError
                    if "IncompleteIterationError" in str(e):
                        try:
                            # Try to resolve the response
                            if hasattr(self.stream_response, 'resolve'):
                                print("Trying to resolve incomplete response...")
                                resolved = self.stream_response.resolve()
                                if hasattr(resolved, 'text'):
                                    self.generated_text = resolved.text
                                    self.received_content = True
                                    
                                    input_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                                    output_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                                    
                                    self.iterator_complete = True
                                    return format_stream_event("content", {
                                        "type": "message_complete",
                                        "chunk_id": f"{self.session_id}_resolved",
                                        "usage": {
                                            "input_tokens": input_tokens,
                                            "output_tokens": output_tokens,
                                            "total_tokens": input_tokens + output_tokens,
                                            "total_cost": 0.0  # Gemini API is free
                                        },
                                        "html": self.generated_text,
                                        "session_id": self.session_id
                                    })
                        except Exception as resolve_error:
                            print(f"Error resolving response: {str(resolve_error)}")
                    
                    # Break out of the loop and continue to error handler
                    break
            
            # If we get here, we didn't handle the error in specific cases
            # See if we have content to return despite the error
            if self.generated_text:
                input_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                output_tokens = max(1, int(len(self.generated_text.split()) * 1.3))
                
                self.iterator_complete = True
                return format_stream_event("content", {
                    "type": "message_complete",
                    "chunk_id": f"{self.session_id}_recovered",
                    "usage": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens,
                        "total_cost": 0.0  # Gemini API is free
                    },
                    "html": self.generated_text,
                    "session_id": self.session_id
                })
            
        except Exception as outer_e:
            # Catch any other exceptions that might occur
            error_msg = f"Error processing Gemini chunk: {str(outer_e)}"
            print(f"Error: {error_msg}")
            print(traceback.format_exc())
            
            self.iterator_complete = True
            return format_stream_event("error", {
                "type": "error",
                "error": error_msg,
                "details": traceback.format_exc(),
                "session_id": self.session_id
            })
    
    def _create_content_event(self):
        """Create a content event for the current segment"""
        content_data = {
            "type": "content_block_delta",
            "chunk_id": f"{self.session_id}_{self.chunk_count}",
            "delta": {
                "text": self.current_segment
            },
            "segment": self.segment_counter,
            "session_id": self.session_id,
            "chunk_count": self.chunk_count
        }
        return format_stream_event("content", content_data)

# Special client class for Vercel that doesn't use the standard Anthropic library
class VercelCompatibleClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.anthropic.com/v1"
        self.headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }
        
        # Add beta and messages namespaces for compatibility
        self.beta = self._BetaNamespace(self)
        self.messages = self._MessagesNamespace(self)
    
    def post(self, url, json=None, headers=None, timeout=None):
        """Send a POST request to the specified URL with the given JSON data."""
        _headers = dict(self.headers)
        if headers:
            _headers.update(headers)
        
        response = requests.post(
            url,
            json=json,
            headers=_headers,
            timeout=timeout or 120
        )
        return response
    
    def models(self):
        # Lightweight method to check if the API key is valid
        class ModelList:
            def __init__(self, client):
                self.client = client
                
            def list(self):
                response = requests.get(
                    f"{self.client.base_url}/models",
                    headers=self.client.headers
                )
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 401:
                    raise Exception(f"Authentication failed: {response.json().get('error', {}).get('message', 'Invalid API key')}")
                else:
                    raise Exception(f"Error {response.status_code}: {response.text}")
        
        return ModelList(self)
    
    def count_tokens(self, text):
        # Simple approximation (1 token ≈ 4 characters)
        return len(text) // 4
    
    # Beta namespace for streaming
    class _BetaNamespace:
        def __init__(self, client):
            self.client = client
            self.messages = self._MessagesStreamingNamespace(client)
    
        # Streaming messages namespace
        class _MessagesStreamingNamespace:
            def __init__(self, client):
                self.client = client
            
            def stream(self, model, max_tokens, temperature, system, messages, thinking=None, betas=None, beta=None):
                """
                Stream the response from the Anthropic API directly with improved timeout handling
                for Vercel environment. Uses a stateful approach that supports reconnection.
                """
                # Check if we're on Vercel - if so, we need to handle timeouts differently
                is_vercel = os.environ.get('VERCEL', False)
                
                # Generate a unique ID for this streaming session
                session_id = str(int(time.time())) + "-" + str(hash(str(messages)))[1:8]
                
                # Convert messages to API format
                formatted_messages = []
                for msg in messages:
                    formatted_message = {"role": msg["role"]}
                    
                    # Handle different content formats
                    if isinstance(msg["content"], list):
                        formatted_content = []
                        for content_item in msg["content"]:
                            if isinstance(content_item, dict) and "text" in content_item:
                                formatted_content.append({
                                    "type": "text", 
                                    "text": content_item["text"]
                                })
                            elif isinstance(content_item, dict) and "type" in content_item and "text" in content_item:
                                formatted_content.append(content_item)
                        formatted_message["content"] = formatted_content
                    else:
                        formatted_message["content"] = msg["content"]
                    
                    formatted_messages.append(formatted_message)
                
                # Prepare the payload
                payload = {
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "system": system,
                    "messages": formatted_messages,
                    "stream": True
                }
                
                # Add thinking parameter if provided
                if thinking:
                    # Handle both new and old thinking parameter formats
                    if isinstance(thinking, dict) and "type" in thinking and thinking["type"] == "enabled":
                        # New format with 'type' and 'budget_tokens'
                        payload["thinking"] = thinking
                    elif isinstance(thinking, dict) and "enabled" in thinking:
                        # Old format with just 'enabled'
                        payload["thinking"] = {
                            "type": "enabled",
                            "budget_tokens": thinking.get("budget_tokens", 32000)
                        }
                    else:
                        # Default to enabled with a budget
                        payload["thinking"] = {
                            "type": "enabled",
                            "budget_tokens": 32000
                        }
                
                # Add beta features if specified - Fixed to use the correct format
                # The Anthropic API expects beta features in the 'anthropic-beta' header
                headers = dict(self.client.headers)
                
                # Handle both beta and betas parameters
                if beta:
                    headers["anthropic-beta"] = beta
                elif betas and isinstance(betas, list) and len(betas) > 0:
                    headers["anthropic-beta"] = ",".join(betas)
                
                # For Vercel, reduce the expected response timeout and add retry mechanism
                if is_vercel:
                    # Add a shorter timeout for Vercel environment
                    timeout = 8  # 8 seconds to stay under Vercel's 10s limit
                else:
                    # For local environment, use a longer timeout
                    timeout = 30
                
                # Implement retry logic with exponential backoff
                max_retries = 5
                retry_count = 0
                base_delay = 2  # Start with a 2-second delay
                
                while retry_count < max_retries:
                    try:
                        # Make the API request to stream response
                        stream_response = requests.post(
                            f"{self.client.base_url}/messages",
                            headers=headers,
                            json=payload,
                            stream=True,
                            timeout=timeout
                        )
                        
                        if stream_response.status_code not in [200, 201]:
                            error_msg = None
                            # Handle error responses with retry logic
                            if stream_response.status_code == 529:  # Overloaded
                                retry_count += 1
                                retry_delay = base_delay * (2 ** retry_count)  # Exponential backoff
                                print(f"API overloaded (529), retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                                time.sleep(retry_delay)
                                continue
                            elif stream_response.status_code == 500:  # Internal server error
                                retry_count += 1
                                retry_delay = base_delay * (2 ** retry_count)  # Exponential backoff
                                print(f"API internal error (500), retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                                time.sleep(retry_delay)
                                continue
                            elif stream_response.status_code == 408:  # Timeout
                                retry_count += 1
                                retry_delay = base_delay * (2 ** retry_count)  # Exponential backoff
                                print(f"API timeout (408), retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                                time.sleep(retry_delay)
                                continue
                            
                            # If not a retriable error or we couldn't extract an error message
                            try:
                                error_text = next(stream_response.iter_lines()).decode('utf-8')
                                if error_text.startswith('data: '):
                                    error_json = json.loads(error_text[6:])
                                    error_msg = error_json.get('error', {}).get('message', error_text)
                                else:
                                    error_msg = error_text
                            except Exception:
                                error_msg = f"HTTP Error {stream_response.status_code}"
                            
                            raise Exception(f"API request failed: {error_msg}")
                        
                        # Return a streaming response wrapper that mimics the Anthropic client
                        # Add the session_id and is_vercel flags to help with timeout handling
                        return VercelStreamingResponse(stream_response, self.client, 
                                                     session_id=session_id,
                                                     is_vercel=is_vercel)
                        
                    except requests.exceptions.Timeout:
                        # If timeout occurs on Vercel, provide information for client reconnection
                        if is_vercel:
                            retry_count += 1
                            if retry_count >= max_retries:
                                raise Exception(f"Vercel timeout after {max_retries} retries - client should continue with session: {session_id}")
                            retry_delay = base_delay * (2 ** retry_count)
                            print(f"Vercel timeout, retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                            time.sleep(retry_delay)
                            continue
                        else:
                            retry_count += 1
                            if retry_count >= max_retries:
                                raise Exception(f"Request timed out after {max_retries} retries")
                            retry_delay = base_delay * (2 ** retry_count)
                            print(f"Request timed out, retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                            time.sleep(retry_delay)
                            continue
                            
                    except Exception as e:
                        # For network/connection errors, retry
                        if "connection" in str(e).lower() or "timeout" in str(e).lower():
                            retry_count += 1
                            if retry_count >= max_retries:
                                raise Exception(f"Connection error after {max_retries} retries: {str(e)}")
                            retry_delay = base_delay * (2 ** retry_count)
                            print(f"Connection error, retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                            time.sleep(retry_delay)
                            continue
                        else:
                            raise Exception(f"API request failed: {str(e)}")
                
                # If we've exhausted all retries
                raise Exception(f"API request failed after {max_retries} retries")
    
    # Regular messages namespace
    class _MessagesNamespace:
        def __init__(self, client):
            self.client = client
        
        def create(self, model, max_tokens, temperature, system, messages, thinking=None, betas=None, beta=None):
            """
            Create a message with the Anthropic API directly with retry logic for 529 overloaded errors.
            Implements exponential backoff for retries.
            """
            # Convert messages to API format
            formatted_messages = []
            for msg in messages:
                formatted_message = {"role": msg["role"]}
                
                # Handle different content formats
                if isinstance(msg["content"], list):
                    formatted_content = []
                    for content_item in msg["content"]:
                        if isinstance(content_item, dict) and "text" in content_item:
                            formatted_content.append({
                                "type": "text", 
                                "text": content_item["text"]
                            })
                        elif isinstance(content_item, dict) and "type" in content_item and "text" in content_item:
                            formatted_content.append(content_item)
                else:
                    formatted_message["content"] = msg["content"]
                
                formatted_messages.append(formatted_message)
            
            # Prepare the payload
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system,
                "messages": formatted_messages
            }
            
            # Add thinking parameter if provided
            if thinking:
                # Handle both new and old thinking parameter formats
                if isinstance(thinking, dict) and "type" in thinking and thinking["type"] == "enabled":
                    # New format with 'type' and 'budget_tokens'
                    payload["thinking"] = thinking
                elif isinstance(thinking, dict) and "enabled" in thinking:
                    # Old format with just 'enabled'
                    payload["thinking"] = {
                        "type": "enabled",
                        "budget_tokens": thinking.get("budget_tokens", 32000)
                    }
                else:
                    # Default to enabled with a budget
                    payload["thinking"] = {
                        "type": "enabled",
                        "budget_tokens": 32000
                    }
            
            # Add beta features if specified
            headers = dict(self.client.headers)
            
            # Handle both beta and betas parameters
            if beta:
                headers["anthropic-beta"] = beta
            elif betas and isinstance(betas, list) and len(betas) > 0:
                headers["anthropic-beta"] = ",".join(betas)
            
            # Implement retry logic with exponential backoff
            max_retries = 5
            retry_count = 0
            base_delay = 2  # Start with a 2-second delay
            
            while retry_count < max_retries:
                try:
                    # Make the API request with a longer timeout for large requests
                    response = requests.post(
                        f"{self.client.base_url}/messages",
                        headers=headers,
                        json=payload,
                        timeout=600  # 10 minutes timeout for large requests
                    )
                    
                    # Check if we received a successful response
                    if response.status_code == 200:
                        # Parse the result
                        result = response.json()
                        
                        # Return a response wrapper that mimics the Anthropic client
                        return VercelMessageResponse(result)
                        
                    # Handle specific error codes with retries
                    elif response.status_code == 529:  # Overloaded
                        retry_count += 1
                        retry_delay = base_delay * (2 ** retry_count)  # Exponential backoff
                        print(f"API overloaded (529), retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                        time.sleep(retry_delay)
                        continue
                        
                    elif response.status_code == 500:  # Internal server error
                        retry_count += 1
                        retry_delay = base_delay * (2 ** retry_count)  # Exponential backoff
                        print(f"API internal error (500), retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                        time.sleep(retry_delay)
                        continue
                        
                    elif response.status_code == 408:  # Timeout
                        retry_count += 1
                        retry_delay = base_delay * (2 ** retry_count)  # Exponential backoff
                        print(f"API timeout (408), retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                        time.sleep(retry_delay)
                        continue
                    
                    else:
                        # Try to get detailed error message
                        try:
                            error_json = response.json()
                            error_msg = error_json.get('error', {}).get('message', f"HTTP {response.status_code}")
                        except Exception:
                            error_msg = f"HTTP Error {response.status_code}: {response.text[:100]}"
                        
                        raise Exception(f"API request failed: {error_msg}")
                        
                except requests.exceptions.Timeout:
                    retry_count += 1
                    retry_delay = base_delay * (2 ** retry_count)
                    print(f"Request timed out, retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                    time.sleep(retry_delay)
                    continue
                    
                except Exception as e:
                    # For other exceptions, retry a few times
                    if "connection" in str(e).lower() or "timeout" in str(e).lower():
                        retry_count += 1
                        retry_delay = base_delay * (2 ** retry_count)
                        print(f"Connection error, retrying in {retry_delay} seconds (attempt {retry_count}/{max_retries})")
                        time.sleep(retry_delay)
                        continue
                    else:
                        raise Exception(f"API request failed: {str(e)}")
            
            # If we've exhausted all retries
            raise Exception(f"API request failed after {max_retries} retries")

# Wrapper for the streaming response
class VercelStreamingResponse:
    def __init__(self, stream_response, client, session_id=None, is_vercel=False):
        self.stream_response = stream_response
        self.client = client
        self.is_vercel = is_vercel
        self.session_id = session_id or str(uuid.uuid4())
        self.chunk_count = 0
        self.buffer = []
        self.buffer_limit = 10  # Maximum number of chunks to buffer
        self.last_error = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def __iter__(self):
        # Keep track of the total output size
        total_output_text = 0
        chunk_batch = []  # To batch small chunks for efficiency
        
        try:
            # Track chunk count for reconnection support
            self.chunk_count = 0
            
            # Stream begins event
            yield self._ChunkObject("stream_start")
            
            for chunk in self.stream_response:
                try:
                    self.chunk_count += 1
                    
                    # Process each chunk based on its type
                    if hasattr(chunk, 'delta') and hasattr(chunk.delta, 'text'):
                        # We have content delta
                        delta_text = chunk.delta.text
                        total_output_text += len(delta_text)
                        
                        # Create delta object with metadata for reconnection
                        delta_obj = self._MessageDeltaChunk(
                            self._DeltaObject(delta_text)
                        )
                        
                        # Add metadata for reconnection
                        delta_obj.chunk_id = f"{self.session_id}_{self.chunk_count}"
                        delta_obj.session_id = self.session_id
                        delta_obj.chunk_count = self.chunk_count
                        
                        # Add to buffer for potential reconnection
                        self._add_to_buffer(delta_obj)
                        
                        # Send heartbeat/keepalive every 50 chunks
                        if self.chunk_count % 50 == 0:
                            yield self._create_keepalive()
                        
                        # Yield the chunk
                        yield delta_obj
                        
                    elif hasattr(chunk, 'thinking') and chunk.thinking:
                        # We have thinking update
                        thinking_content = chunk.thinking.content if hasattr(chunk.thinking, "content") else ""
                        thinking_obj = self._ThinkingUpdateChunk(
                            self._ThinkingObject(thinking_content)
                        )
                        
                        # Add metadata for reconnection
                        thinking_obj.chunk_id = f"{self.session_id}_{self.chunk_count}"
                        thinking_obj.session_id = self.session_id
                        thinking_obj.chunk_count = self.chunk_count
                        
                        # Yield thinking update
                        yield thinking_obj
                        
                except Exception as e:
                    # Log any errors but continue
                    print(f"Error processing chunk: {str(e)}")
                    self.last_error = str(e)
                    # Don't break the iteration - continue to next chunk
            
            # Stream completed successfully
            # Create a completion object with usage statistics
            # This is important for large content to know when it's complete
            usage_info = None
            if hasattr(self.stream_response, 'usage'):
                usage_obj = self.stream_response.usage
                usage_info = self._UsageInfo(
                    getattr(usage_obj, 'input_tokens', 0),
                    getattr(usage_obj, 'output_tokens', 0),
                    getattr(usage_obj, 'thinking_tokens', 0)
                )
            
            # Create a completion message
            completion = {
                "type": "message_complete",
                "id": self.session_id,
                "chunk_id": f"{self.session_id}_{self.chunk_count}",
                "session_id": self.session_id,
                "final_chunk_count": self.chunk_count,
                "usage": usage_info.__dict__ if usage_info else None
            }
            
            # For JSON serialization, we just need a simple object with attributes
            completion_obj = type('CompletionObject', (), completion)
            yield completion_obj
            
            # End the stream
            end_event = {
                "type": "stream_end",
                "session_id": self.session_id
            }
            end_event_obj = type('EndEvent', (), end_event)
            yield end_event_obj
            
        except Exception as e:
            # If there's a terminal error, send an error message
            print(f"Stream error: {str(e)}")
            error_obj = self._ErrorChunk(str(e))
            error_obj.session_id = self.session_id
            yield error_obj

    def _add_to_buffer(self, chunk):
        """Add a chunk to the reconnection buffer, maintaining max buffer size"""
        self.buffer.append(chunk)
        if len(self.buffer) > self.buffer_limit:
            self.buffer.pop(0)  # Remove oldest chunk
    
    def _create_keepalive(self):
        """Create a keepalive message to prevent timeout"""
        keepalive = {
            "type": "keepalive",
            "timestamp": time.time(),
            "session_id": self.session_id,
            "chunk_count": self.chunk_count
        }
        return type('KeepaliveObject', (), keepalive)

    # Helper classes to mimic Anthropic client objects
    class _ChunkObject:
        def __init__(self, type_name):
            self.type = type_name
    
    class _ContentDeltaChunk:
        def __init__(self, text):
            self.type = 'content_block_delta'
            self.delta = self._TextDelta(text)
        
        class _TextDelta:
            def __init__(self, text):
                self.text = text
    
    class _ThinkingObject:
        def __init__(self, content):
            self.content = content
    
    class _ThinkingUpdateChunk:
        def __init__(self, thinking):
            self.type = 'thinking_update'
            self.thinking = thinking
    
    class _DeltaObject:
        def __init__(self, text):
            self.content = text
            self.text = text
    
    class _MessageDeltaChunk:
        def __init__(self, delta):
            self.type = 'message_delta'
            self.delta = delta
    
    class _ReconnectSignal:
        def __init__(self, session_id, chunk_count):
            self.type = 'reconnect_signal'
            self.session_id = session_id
            self.chunk_count = chunk_count
    
    class _ErrorChunk:
        def __init__(self, error_message):
            self.type = 'error'
            self.error = error_message
    
    class _UsageInfo:
        def __init__(self, input_tokens, output_tokens, thinking_tokens):
            self.input_tokens = input_tokens
            self.output_tokens = output_tokens
            self.thinking_tokens = thinking_tokens

# Response object for non-streaming API calls
class VercelMessageResponse:
    def __init__(self, result):
        self.id = result.get('id')
        self.content = self._format_content(result.get('content', []))
        self.role = result.get('role', 'assistant')
        self.model = result.get('model')
        self.usage = self._UsageInfo(
            result.get('usage', {}).get('input_tokens', 0),
            result.get('usage', {}).get('output_tokens', 0),
            result.get('usage', {}).get('thinking_tokens', 0)
        )
    
    def _format_content(self, content):
        """Format the content to match how the original client would return it"""
        if isinstance(content, list):
            # For list-type content, transform to expected format
            formatted_content = []
            for item in content:
                if isinstance(item, dict) and 'type' in item and item['type'] == 'text':
                    formatted_content.append({'type': 'text', 'text': item.get('text', '')})
            return formatted_content
        elif isinstance(content, str):
            # For string content, wrap in a list with text object
            return [{'type': 'text', 'text': content}]
        else:
            # Default fallback
            return [{'type': 'text', 'text': str(content) if content else ''}]
    
    class _UsageInfo:
        def __init__(self, input_tokens, output_tokens, thinking_tokens):
            self.input_tokens = input_tokens
            self.output_tokens = output_tokens
            self.thinking_tokens = thinking_tokens

def format_stream_event(event_type, data=None):
    """
    Format data as a server-sent event
    """
    event = {"type": event_type}
    
    if data:
        event.update(data)
    
    # Format as SSE
    return f"data: {json.dumps(event)}\n\n" 