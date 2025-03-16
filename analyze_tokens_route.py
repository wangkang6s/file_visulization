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
        system_prompt = "Create a beautiful, modern, and interactive website visualization from the provided content. Your task is to transform the input into a well-structured, visually engaging webpage that enhances readability and understanding. Follow these guidelines:\n\n1. Generate ONLY the complete HTML code without any explanations, comments, or markdown.\n2. Use modern design elements: clean layout, appropriate typography, responsive structure.\n3. Include necessary styling via Tailwind CSS or embedded CSS.\n4. Add necessary interactivity with minimal JavaScript where appropriate.\n5. Ensure the website is fully responsive and works across different screen sizes.\n6. Include proper semantic HTML structure with appropriate headings, sections, and navigation.\n7. The output should be valid HTML that can be directly rendered in any browser.\n\nDo not include any explanations before or after the HTML code. Deliver only the complete HTML file that can be directly saved and opened in a browser."

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
        
        # Calculate estimated cost (as of current pricing)
        estimated_cost = (estimated_tokens / 1000000) * 3.0  # $3 per million tokens
        
        return jsonify({
            'estimated_tokens': estimated_tokens,
            'estimated_cost': round(estimated_cost, 6),
            'max_safe_output_tokens': min(128000, TOTAL_CONTEXT_WINDOW - estimated_tokens - 5000)
        })
    except Exception as e:
        return jsonify({"error": f"Error analyzing tokens: {str(e)}"}), 500 