// Process stream function for Vercel using Anthropic API
module.exports = async (req, res) => {
  // Set headers for proper chunked streaming
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in Nginx
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }
  
  // Function to write event to stream
  function writeEvent(eventType, data) {
    // Format in the SSE format expected by the client
    const eventString = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    
    try {
      res.write(eventString);
      
      if (res.flush) {
        res.flush();
      }
    } catch (err) {
      console.error('Error flushing:', err);
    }
  }
  
  // Flag to track if response has ended
  let hasResponseEnded = false;
  
  // Function to safely end the response
  function safeEndResponse() {
    if (!hasResponseEnded) {
      try {
        console.log('Safely ending response');
        writeEvent('stream_end', { message: 'Stream complete' });
        res.end();
        hasResponseEnded = true;
      } catch (e) {
        console.error('Error ending response:', e);
      }
    }
  }
  
  // Function to wait
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Start time for tracking elapsed time
  const startTime = Date.now();
  
  // For breaking down processing into smaller chunks
  let completedChunks = 0;
  const MAX_CHUNKS_PER_RESPONSE = 10; // Adjust as needed
  
  // Create keep-alive timer
  let keepaliveInterval = null;
  
  try {
    // Log the start of the request
    console.log('Process-stream request received');
    
    // Get content from request body
    const body = req.body || {};
    const content = body.content || body.source || '';
    const apiKey = body.api_key || '';
    const maxTokens = body.max_tokens || 128000;
    const thinkingBudget = body.thinking_budget || 32000;
    const temperature = body.temperature || 0.5;
    const formatPrompt = body.format_prompt || '';
    
    console.log(`Request params: content length: ${content.length}, maxTokens: ${maxTokens}, temperature: ${temperature}`);
    
    if (!content) {
      console.error('Content is required but was empty');
      writeEvent('error', { error: 'Content is required' });
      safeEndResponse();
      return;
    }
    
    if (!apiKey || !apiKey.startsWith('sk-ant')) {
      console.error('Invalid API key format');
      writeEvent('error', { error: 'Valid API key required' });
      safeEndResponse();
      return;
    }
    
    // Generate messageId
    const messageId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    console.log(`Generated message ID: ${messageId}`);
    
    // Set up global connection timeout
    const CONNECTION_TIMEOUT = 55 * 1000; // 55 seconds max to stay under Vercel's 60s limit
    const connectionTimeout = setTimeout(() => {
      console.log('Global connection timeout reached, ending response');
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      safeEndResponse();
    }, CONNECTION_TIMEOUT);
    
    // Detect client disconnection
    req.on('close', () => {
      console.log('Client disconnected, cleaning up resources');
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (connectionTimeout) clearTimeout(connectionTimeout);
      hasResponseEnded = true; // Mark response as ended to prevent further writes
    });
    
    // Send start event
    writeEvent('stream_start', { message: 'Stream starting' });
    
    // Send initial keepalive message right away
    writeEvent('keepalive', { timestamp: Date.now() / 1000 });
    
    // Setup keepalive interval
    keepaliveInterval = setInterval(() => {
      try {
        if (!hasResponseEnded) {
          writeEvent('keepalive', { timestamp: Date.now() / 1000 });
          console.log('Sent keepalive at', new Date().toISOString());
        } else {
          clearInterval(keepaliveInterval);
        }
      } catch (e) {
        console.error('Error sending keepalive:', e);
        clearInterval(keepaliveInterval);
      }
    }, 500); // Send keepalive every 500ms for more reliability
    
    // System prompt
    const systemPrompt = "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).";
    
    // Format user content - use smaller chunk for Vercel
    const userContent = formatPrompt ? 
      `${formatPrompt}\n\nGenerate HTML for this content: ${content.substring(0, Math.min(content.length, 40000))}` :
      `Generate HTML for this content: ${content.substring(0, Math.min(content.length, 40000))}`;
    
    console.log(`User content prepared, length: ${userContent.length}`);
    
    try {
      console.log('Importing Anthropic...');
      // Import Anthropic dynamically
      const { Anthropic } = await import('@anthropic-ai/sdk');
      console.log('Creating Anthropic client...');
      const anthropic = new Anthropic({
        apiKey: apiKey
      });
      
      console.log('Creating message with streaming...');
      // Create message with streaming
      const streamOpts = {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: maxTokens,
        temperature: temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        stream: true
      };
      
      console.log('Stream options prepared:', JSON.stringify({
        model: streamOpts.model,
        max_tokens: streamOpts.max_tokens,
        temperature: streamOpts.temperature,
        stream: streamOpts.stream
      }));
      
      // Add retry logic with exponential backoff
      let maxRetries = 3; // Reduced from 5 to avoid multiple long-running attempts
      let retryCount = 0;
      let backoffTime = 1000; // Start with 1 second (in ms)
      let success = false;
      let htmlOutput = '';
      let chunkCount = 0;
      let stream;
      
      while (retryCount <= maxRetries && !success && !hasResponseEnded) {
        try {
          console.log(`Attempt ${retryCount + 1}/${maxRetries + 1} to create stream`);
          
          // Create controller to abort request if needed
          const controller = new AbortController();
          const signal = controller.signal;
          
          // Set a timeout for this specific API call
          const apiTimeout = setTimeout(() => {
            console.log('API call timeout, aborting');
            controller.abort();
          }, 30000); // 30 second timeout for API call
          
          try {
            // Add the signal to the options
            stream = await anthropic.messages.create({
              ...streamOpts,
              signal
            });
            
            // Clear the API timeout since the call succeeded
            clearTimeout(apiTimeout);
            
            console.log('Stream created, processing chunks...');
            
            // Process chunks
            for await (const chunk of stream) {
              // Skip processing if response has ended
              if (hasResponseEnded) {
                console.log('Response already ended, stopping chunk processing');
                break;
              }
              
              chunkCount++;
              
              if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
                const textChunk = chunk.delta.text;
                htmlOutput += textChunk;
                
                // Send chunk in content_block_delta format to match server.py
                writeEvent('content', { 
                  type: 'content_block_delta', 
                  delta: { text: escape(textChunk) },
                  chunk_id: `${messageId}-${chunkCount}`
                });
                
                // Log every 20th chunk
                if (chunkCount % 20 === 0) {
                  console.log(`Processed ${chunkCount} chunks so far, current chunk length: ${textChunk.length}`);
                }
              }
              // Handle thinking updates if available
              else if (chunk.type === 'thinking') {
                console.log('Received thinking update');
                writeEvent('content', { 
                  type: 'thinking_update', 
                  thinking: { 
                    content: escape(chunk.thinking ? chunk.thinking.content : '') 
                  },
                  chunk_id: `${messageId}-thinking-${chunkCount}`
                });
              }
            }
            
            // If we get here, streaming completed successfully
            success = true;
            console.log(`Stream completed with ${chunkCount} total chunks`);
            
          } catch (abortError) {
            clearTimeout(apiTimeout);
            if (abortError.name === 'AbortError') {
              console.log('API call was aborted due to timeout');
              throw new Error('API call timed out');
            }
            throw abortError;
          }
          
        } catch (error) {
          console.error(`Error in attempt ${retryCount + 1}:`, error);
          
          // If the response has ended, don't retry
          if (hasResponseEnded) {
            console.log('Response already ended, not retrying');
            break;
          }
          
          // Check if it's an overloaded error (529)
          const isOverloaded = error.status === 529 || 
                               (error.response && error.response.status === 529) ||
                               (error.message && error.message.includes('529'));
          
          if (isOverloaded && retryCount < maxRetries) {
            retryCount++;
            const waitTime = backoffTime / 1000; // Convert to seconds for display
            
            console.log(`Anthropic API overloaded. Retry ${retryCount}/${maxRetries} after ${waitTime}s`);
            
            // Send status update to client
            writeEvent('status', { 
              message: `Anthropic API temporarily overloaded. Retrying in ${waitTime}s...`
            });
            
            await sleep(backoffTime);
            backoffTime *= 2; // Exponential backoff
            continue; // Try again
          } else {
            // Other error or we've exhausted retries
            writeEvent('error', { 
              error: escape(error.message || 'Unknown error'),
              details: JSON.stringify(error)
            });
            console.error('Error details:', error);
            
            // Clean up resources
            if (keepaliveInterval) clearInterval(keepaliveInterval);
            if (connectionTimeout) clearTimeout(connectionTimeout);
            
            safeEndResponse();
            return;
          }
        }
      }
      
      // Clear the keepalive interval
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      
      // Calculate token usage
      const systemPromptTokens = Math.floor(systemPrompt.length / 3);
      const contentTokens = Math.floor(content.length / 4);
      const inputTokens = systemPromptTokens + contentTokens;
      const outputTokens = Math.floor(htmlOutput.length / 4);
      const elapsed = Date.now() - startTime;
      
      console.log(`Calculated usage - inputTokens: ${inputTokens}, outputTokens: ${outputTokens}, time: ${elapsed}ms`);
      
      // Only send completion message if the response hasn't already ended
      if (!hasResponseEnded) {
        // Send completion message in the format expected by the client
        writeEvent('content', {
          type: 'message_complete',
          message_id: messageId,
          chunk_id: `${messageId}-final`,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            thinking_tokens: thinkingBudget,
            total_cost: ((inputTokens + outputTokens) / 1000000 * 3.0),
            time_elapsed: elapsed / 1000 // Convert to seconds
          },
          html: htmlOutput // Don't escape the HTML here
        });
        
        // Clear any remaining timers
        if (connectionTimeout) clearTimeout(connectionTimeout);
        
        // Send end event and end the response
        console.log('Stream response complete, ending response');
        safeEndResponse();
      }
    } catch (error) {
      console.error('Error in Anthropic processing:', error);
      console.error('Error stack:', error.stack);
      
      // Clean up resources
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (connectionTimeout) clearTimeout(connectionTimeout);
      
      // Send error and end response if not already ended
      if (!hasResponseEnded) {
        writeEvent('error', { error: escape(error.message) });
        safeEndResponse();
      }
    }
  } catch (error) {
    console.error('Error in process-stream:', error);
    console.error('Error stack:', error.stack);
    
    // Clean up resources
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    
    // Send error message if response hasn't ended
    try {
      if (!hasResponseEnded) {
        writeEvent('error', { error: escape(error.message) });
        safeEndResponse();
      }
    } catch (responseError) {
      console.error('Error sending error event:', responseError);
    }
  }
};

// Helper function to escape HTML content
function escape(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
} 