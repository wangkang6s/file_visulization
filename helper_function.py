# Helper functions for server.py
import anthropic
import os
import json
import requests
import time

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
                
                # Make the API request to stream response
                try:
                    stream_response = requests.post(
                        f"{self.client.base_url}/messages",
                        headers=headers,
                        json=payload,
                        stream=True,
                        timeout=timeout
                    )
                    
                    if stream_response.status_code != 200:
                        # Try to get error message
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
                        raise Exception(f"Vercel timeout - client should continue with session: {session_id}")
                    else:
                        raise Exception(f"Request timed out after {timeout} seconds")
                except Exception as e:
                    raise Exception(f"API request failed: {str(e)}")
    
    # Regular messages namespace
    class _MessagesNamespace:
        def __init__(self, client):
            self.client = client
        
        def create(self, model, max_tokens, temperature, system, messages, thinking=None, betas=None, beta=None):
            """
            Create a message with the Anthropic API directly.
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
            
            # Retry logic with exponential backoff
            max_retries = 5
            retry_count = 0
            base_delay = 1  # Starting delay in seconds
            
            while True:
                try:
                    print(f"Making direct API request to Anthropic (attempt {retry_count + 1}/{max_retries + 1})...")
                    response = requests.post(
                        "https://api.anthropic.com/v1/messages",
                        json=payload,
                        headers=headers,
                        timeout=600  # Increased timeout for large responses
                    )
                    
                    # Check for overloaded error (529)
                    if response.status_code == 529:
                        retry_count += 1
                        if retry_count <= max_retries:
                            delay = base_delay * (2 ** (retry_count - 1))  # Exponential backoff
                            print(f"Anthropic API overloaded (529). Retrying in {delay} seconds... (Attempt {retry_count}/{max_retries})")
                            time.sleep(delay)
                            continue
                    
                    # Check for other errors
                    if response.status_code != 200:
                        error_data = response.json() if response.text else {"error": "Unknown error"}
                        error_message = f"Request error: API error {response.status_code}: {error_data}"
                        print(f"Error in message creation: {error_message}")
                        raise Exception(f"Message creation failed: {error_message}")
                    
                    # Parse the response
                    result = response.json()
                    
                    # Return a formatted response object
                    return VercelMessageResponse(result)
                    
                except requests.exceptions.RequestException as e:
                    # Handle network errors with retry
                    retry_count += 1
                    if retry_count <= max_retries:
                        delay = base_delay * (2 ** (retry_count - 1))
                        print(f"Network error: {str(e)}. Retrying in {delay} seconds... (Attempt {retry_count}/{max_retries})")
                        time.sleep(delay)
                    else:
                        print(f"Max retries exceeded for network error: {str(e)}")
                        raise Exception(f"Message creation failed after {max_retries} retries: {str(e)}")
                except Exception as e:
                    print(f"Error in message creation: {str(e)}")
                    raise Exception(f"Message creation failed: {str(e)}")

# Wrapper for the streaming response
class VercelStreamingResponse:
    def __init__(self, stream_response, client, session_id=None, is_vercel=False):
        self.stream_response = stream_response
        self.client = client
        self.usage = None
        self.session_id = session_id
        self.is_vercel = is_vercel
        self.chunk_buffer = []  # Buffer to store chunks for reconnection
        
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stream_response.close()
    
    def __iter__(self):
        """Iterator that parses SSE format and yields message chunks"""
        buffer = ""
        input_tokens = 0
        output_tokens = 0
        thinking_tokens = 0
        chunk_count = 0
        
        try:
            for line in self.stream_response.iter_lines():
                if not line:
                    continue
                    
                line_text = line.decode('utf-8')
                
                # Skip lines that don't start with 'data: '
                if not line_text.startswith('data: '):
                    continue
                    
                # Extract the JSON data
                data = line_text[6:]  # Remove 'data: ' prefix
                
                # Check for the [DONE] message
                if data == "[DONE]":
                    # Create usage object at the end
                    self.usage = self._UsageInfo(input_tokens, output_tokens, thinking_tokens)
                    break
                
                try:
                    # Parse the chunk JSON
                    chunk = json.loads(data)
                    chunk_count += 1
                    
                    # Extract any usage information
                    if 'usage' in chunk:
                        if 'input_tokens' in chunk['usage']:
                            input_tokens = chunk['usage']['input_tokens']
                        if 'output_tokens' in chunk['usage']:
                            output_tokens = chunk['usage']['output_tokens']
                        if 'thinking_tokens' in chunk['usage'] or 'thinking' in chunk['usage']:
                            thinking_tokens = chunk['usage'].get('thinking_tokens', chunk['usage'].get('thinking', 0))
                    
                    # For Vercel with potential timeouts, save chunks for client reconnection
                    if self.is_vercel:
                        # Store the chunk in our buffer (limiting to last 100 chunks to avoid memory issues)
                        if len(self.chunk_buffer) >= 100:
                            self.chunk_buffer.pop(0)  # Remove oldest chunk
                        self.chunk_buffer.append(chunk)
                    
                    # Create a compatible chunk object based on the event type
                    if chunk.get('type') == 'message_start':
                        yield self._ChunkObject('message_start')
                    elif chunk.get('type') == 'content_block_start':
                        yield self._ChunkObject('content_block_start')
                    elif chunk.get('type') == 'content_block_delta':
                        if 'delta' in chunk and 'text' in chunk['delta']:
                            yield self._ContentDeltaChunk(chunk['delta']['text'])
                    elif chunk.get('type') == 'thinking_start':
                        yield self._ChunkObject('thinking_start')
                    elif chunk.get('type') == 'thinking_update':
                        if 'thinking' in chunk and 'content' in chunk['thinking']:
                            thinking_obj = self._ThinkingObject(chunk['thinking']['content'])
                            yield self._ThinkingUpdateChunk(thinking_obj)
                    elif chunk.get('type') == 'thinking_end':
                        yield self._ChunkObject('thinking_end')
                    elif chunk.get('type') == 'message_delta':
                        content = ""
                        if 'delta' in chunk and 'content' in chunk['delta']:
                            content = chunk['delta']['content']
                        elif 'delta' in chunk and 'text' in chunk['delta']:
                            content = chunk['delta']['text']
                        
                        if content:
                            delta_obj = self._DeltaObject(content)
                            yield self._MessageDeltaChunk(delta_obj)
                    elif chunk.get('type') == 'message_stop':
                        yield self._ChunkObject('message_stop')
                    
                except json.JSONDecodeError:
                    # Skip malformed chunks
                    continue
                
                # Check if we need to implement Vercel timeout protection
                # If we're getting close to Vercel's timeout limit, we'll signal to the client
                # that they need to request the continuation of this stream
                if self.is_vercel and chunk_count > 0 and chunk_count % 10 == 0:
                    # Every 10 chunks, check how much time has passed
                    # This is a simplified approach - in a production environment you might 
                    # want to actually track time elapsed
                    pass
        
        except requests.exceptions.ChunkedEncodingError:
            # This can happen when the connection is terminated early
            if self.is_vercel:
                # Signal that the client needs to reconnect
                yield self._ReconnectSignal(self.session_id, chunk_count)
            else:
                # For local environment, just let the exception propagate
                raise
        except Exception as e:
            # Handle other exceptions
            print(f"Error in streaming response: {str(e)}")
            if self.is_vercel:
                yield self._ErrorChunk(str(e))
    
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