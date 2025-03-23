// Process stream function for Vercel Edge Runtime using Anthropic API directly
export const config = {
  runtime: 'edge',
  regions: ['iad1'], // Force specific US region for more consistent performance
};

export default async function handler(req) {
  // Create a new ReadableStream with a controller to manage the flow
  const stream = new ReadableStream({
    async start(controller) {
      // Create TextEncoder once
      const encoder = new TextEncoder();
      
      // Function to write event to stream
      function writeEvent(eventType, data) {
        // Format in the SSE format expected by the client
        const eventString = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(eventString));
      }
      
      // Flag to track if stream has ended
      let hasEnded = false;
      
      // Function to safely end the stream
      function safeEndStream() {
        if (!hasEnded) {
          try {
            console.log('Safely ending stream');
            writeEvent('stream_end', { message: 'Stream complete' });
            controller.close();
            hasEnded = true;
          } catch (e) {
            console.error('Error ending stream:', e);
          }
        }
      }
      
      // Function to wait
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      // Start time for tracking elapsed time
      const startTime = Date.now();
      
      // Create keep-alive timer
      let keepaliveInterval = null;
      let lastEventTime = Date.now();
      
      try {
        // Handle OPTIONS request
        if (req.method === 'OPTIONS') {
          safeEndStream();
          return;
        }
        
        // Only allow POST requests
        if (req.method !== 'POST') {
          writeEvent('error', { error: 'Method not allowed' });
          safeEndStream();
          return;
        }
        
        // Log the start of the request
        console.log('Process-stream request received');
        
        // Get content from request body
        const body = await req.json();
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
          safeEndStream();
          return;
        }
        
        if (!apiKey || !apiKey.startsWith('sk-ant')) {
          console.error('Invalid API key format');
          writeEvent('error', { error: 'Valid API key required' });
          safeEndStream();
          return;
        }
        
        // Generate messageId
        const messageId = crypto.randomUUID();
        console.log(`Generated message ID: ${messageId}`);
        
        // Send start event immediately (crucial)
        writeEvent('stream_start', { message: 'Stream starting' });
        
        // Setup frequently recurring keepalive to ensure the connection stays open
        // Send initial keepalive message right away
        writeEvent('keepalive', { timestamp: Date.now() / 1000 });
        lastEventTime = Date.now();
        
        // Setup keepalive interval - frequent to prevent timeouts
        keepaliveInterval = setInterval(() => {
          try {
            if (!hasEnded) {
              const now = Date.now();
              // Only send if it's been more than 300ms since last event
              if (now - lastEventTime > 300) {
                writeEvent('keepalive', { timestamp: now / 1000 });
                lastEventTime = now;
                console.log('Sent keepalive at', new Date().toISOString());
              }
            } else {
              clearInterval(keepaliveInterval);
            }
          } catch (e) {
            console.error('Error sending keepalive:', e);
            clearInterval(keepaliveInterval);
          }
        }, 500);
        
        // System prompt
        const systemPrompt = "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).";
        
        // Format user content - use smaller chunk for Vercel
        const userContent = formatPrompt ? 
          `${formatPrompt}\n\nGenerate HTML for this content: ${content.substring(0, Math.min(content.length, 40000))}` :
          `Generate HTML for this content: ${content.substring(0, Math.min(content.length, 40000))}`;
        
        console.log(`User content prepared, length: ${userContent.length}`);
        
        try {
          console.log('Preparing to call Anthropic API directly...');
          
          // Add retry logic with exponential backoff
          let maxRetries = 3;
          let retryCount = 0;
          let backoffTime = 1000; // Start with 1 second (in ms)
          let success = false;
          let htmlOutput = '';
          let chunkCount = 0;
          
          while (retryCount <= maxRetries && !success && !hasEnded) {
            try {
              console.log(`Attempt ${retryCount + 1}/${maxRetries + 1} to create stream`);
              
              // Create controller to abort request if needed
              const abortController = new AbortController();
              const signal = abortController.signal;
              
              try {
                // Call Anthropic API directly
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: maxTokens,
                    temperature: temperature,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userContent }],
                    stream: true
                  }),
                  signal
                });
                
                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
                }
                
                console.log('Stream created, processing chunks...');
                
                // Process the response as a stream
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                // Process chunks
                while (true) {
                  const { done, value } = await reader.read();
                  
                  // Update last event time
                  lastEventTime = Date.now();
                  
                  // Skip processing if stream has ended or done
                  if (done || hasEnded) {
                    console.log('Stream ended or closed');
                    break;
                  }
                  
                  // Decode the chunk
                  const chunk = decoder.decode(value, { stream: true });
                  
                  // Parse the chunk - it's a series of SSE lines that need to be parsed
                  const lines = chunk.split('\n');
                  
                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const data = line.slice(6);
                      
                      // Anthropic sends [DONE] when streaming is complete
                      if (data === '[DONE]') {
                        console.log('Received [DONE] marker');
                        break;
                      }
                      
                      try {
                        const parsed = JSON.parse(data);
                        
                        // Process different types of events
                        if (parsed.type === 'content_block_delta' && parsed.delta.type === 'text') {
                          const textChunk = parsed.delta.text;
                          htmlOutput += textChunk;
                          chunkCount++;
                          
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
                        else if (parsed.type === 'thinking') {
                          console.log('Received thinking update');
                          writeEvent('content', { 
                            type: 'thinking_update', 
                            thinking: { 
                              content: escape(parsed.thinking ? parsed.thinking.content : '') 
                            },
                            chunk_id: `${messageId}-thinking-${chunkCount}`
                          });
                        }
                      } catch (parseError) {
                        console.error('Error parsing chunk:', parseError);
                        // Continue processing other chunks even if one fails
                      }
                    }
                  }
                }
                
                // If we get here, streaming completed successfully
                success = true;
                console.log(`Stream completed with ${chunkCount} total chunks`);
                
              } catch (abortError) {
                if (abortError.name === 'AbortError') {
                  console.log('API call was aborted due to timeout');
                  throw new Error('API call timed out');
                }
                throw abortError;
              }
              
            } catch (error) {
              console.error(`Error in attempt ${retryCount + 1}:`, error);
              
              // If the stream has ended, don't retry
              if (hasEnded) {
                console.log('Stream already ended, not retrying');
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
                lastEventTime = Date.now();
                
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
                
                safeEndStream();
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
          
          // Only send completion message if the stream hasn't already ended
          if (!hasEnded) {
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
            
            // Send end event and end the stream
            console.log('Stream response complete, ending stream');
            safeEndStream();
          }
        } catch (error) {
          console.error('Error in Anthropic processing:', error);
          
          // Clean up resources
          if (keepaliveInterval) clearInterval(keepaliveInterval);
          
          // Send error and end stream if not already ended
          if (!hasEnded) {
            writeEvent('error', { error: escape(error.message) });
            safeEndStream();
          }
        }
      } catch (error) {
        console.error('Error in process-stream:', error);
        
        // Clean up resources
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        
        // Send error message if stream hasn't ended
        try {
          if (!hasEnded) {
            writeEvent('error', { error: escape(error.message) });
            safeEndStream();
          }
        } catch (responseError) {
          console.error('Error sending error event:', responseError);
        }
      }
    }
  });

  // Return the stream with appropriate headers
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'X-Accel-Buffering': 'no' // Prevents buffering in some proxies
    }
  });
}

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