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
              
              // Call Anthropic API directly with corrected headers and structure
              const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01', // Required API version
                  'anthropic-beta': 'messages-2023-12-15' // Optional beta features
                },
                body: JSON.stringify({
                  model: 'claude-3-5-sonnet-20240620',
                  max_tokens: maxTokens,
                  temperature: temperature,
                  system: systemPrompt,
                  messages: [{ role: 'user', content: userContent }],
                  stream: true,
                  thinking: { 
                    type: "enabled", 
                    budget_tokens: thinkingBudget 
                  }
                }),
                signal
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error('Anthropic API error response:', errorText);
                throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
              }
              
              console.log('Stream created, processing chunks...');
              
              // Process the response as a stream
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = ''; // Buffer to handle partial chunks
              
              try {
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
                  buffer += chunk;
                  
                  // Split on double newlines to get complete SSE events
                  const events = buffer.split('\n\n');
                  
                  // Process all complete events, and keep the last partial event in the buffer
                  buffer = events.pop() || '';
                  
                  for (const event of events) {
                    if (!event.trim()) continue;
                    
                    const lines = event.split('\n');
                    let eventType = '';
                    let eventData = '';
                    
                    // Extract event type and data
                    for (const line of lines) {
                      if (line.startsWith('event:')) {
                        eventType = line.slice(6).trim();
                      } else if (line.startsWith('data:')) {
                        eventData = line.slice(5).trim();
                      }
                    }
                    
                    // Skip if no data
                    if (!eventData) continue;
                    
                    // Handle ping events specially
                    if (eventType === 'ping') {
                      console.log('Received ping event');
                      continue;
                    }
                    
                    try {
                      const parsed = JSON.parse(eventData);
                      
                      // Process content block delta (the text chunks)
                      if (parsed.type === 'content_block_delta' && 
                          parsed.delta && 
                          parsed.delta.type === 'text_delta') {
                        const textChunk = parsed.delta.text;
                        htmlOutput += textChunk;
                        chunkCount++;
                        
                        // Send chunk in content_block_delta format to match server.py
                        writeEvent('content', { 
                          type: 'content_block_delta', 
                          chunk_id: `${messageId}_${chunkCount}`,
                          delta: {
                            text: textChunk
                          }
                        });
                        
                        // More frequent keepalives during processing
                        writeEvent('keepalive', { 
                          timestamp: Date.now() / 1000,
                          chunk_count: chunkCount
                        });
                        
                        // Debug logging
                        if (chunkCount % 10 === 0) {
                          console.log(`Processed ${chunkCount} chunks, current length: ${htmlOutput.length}`);
                        }
                      } else if (parsed.type === 'thinking') {
                        // Pass thinking update to client
                        writeEvent('thinking_update', {
                          thinking: parsed
                        });
                      } else if (parsed.type === 'message_start') {
                        console.log('Message start received');
                        writeEvent('keepalive', { timestamp: Date.now() / 1000 });
                      } else if (parsed.type === 'message_delta') {
                        if (parsed.delta && parsed.delta.stop_reason) {
                          console.log(`Message completion: ${parsed.delta.stop_reason}`);
                        }
                      } else if (parsed.type === 'message_stop') {
                        // Final message completion
                        console.log('Message stop received');
                        
                        // Send message complete event
                        writeEvent('message_complete', {
                          message: 'Content generation complete'
                        });
                        
                        // Mark as successful
                        success = true;
                      } else {
                        console.log(`Other event type: ${parsed.type}`);
                      }
                    } catch (e) {
                      console.error('Error parsing event data:', e);
                      console.error('Event data:', eventData.substring(0, 200));
                    }
                  }
                }
                
                // If we've completed successfully, break the retry loop
                if (success) {
                  console.log(`HTML generation complete, length: ${htmlOutput.length} characters`);
                  break;
                }
              } catch (streamError) {
                console.error('Error during stream processing:', streamError);
                throw streamError; // Rethrow to be caught by the retry logic
              }
              
            } catch (requestError) {
              console.error('Error during request/streaming:', requestError);
              
              // Check if we've already tried the maximum number of times
              if (retryCount >= maxRetries) {
                writeEvent('error', { 
                  error: `Failed after ${maxRetries + 1} attempts: ${requestError.message}` 
                });
                throw requestError;
              }
              
              // Increment retry count and apply exponential backoff
              retryCount++;
              const jitter = Math.random() * 500;
              backoffTime = Math.min(10000, backoffTime * 2) + jitter;
              
              console.log(`Retrying after ${backoffTime}ms...`);
              
              // Let the client know we're retrying
              writeEvent('status', { 
                message: `Request attempt ${retryCount}/${maxRetries + 1} failed, retrying in ${Math.round(backoffTime/1000)}s...` 
              });
              
              // Wait before the next retry
              await sleep(backoffTime);
            }
          }
          
          // Process the HTML output before completing
          if (htmlOutput) {
            // Create a complete HTML document if it doesn't look like one already
            let finalHtml = htmlOutput;
            if (!finalHtml.trim().toLowerCase().startsWith('<!doctype html>') && 
                !finalHtml.trim().toLowerCase().startsWith('<html')) {
              finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Visualization</title>
</head>
<body>
  ${finalHtml}
</body>
</html>`;
            }
            
            // Send complete content event with the full HTML
            writeEvent('content_complete', { 
              content: finalHtml,
              length: finalHtml.length,
              chunks: chunkCount
            });
            
            console.log(`Content complete sent, length: ${finalHtml.length}`);
          }
          
          // Complete the stream after sending all the data
          const elapsed = (Date.now() - startTime) / 1000;
          writeEvent('complete', { 
            message: 'Stream processing complete',
            elapsed: elapsed,
            html_length: htmlOutput.length,
            success: true
          });
          
          console.log(`Generation complete. Elapsed time: ${elapsed}s`);
          
        } catch (error) {
          console.error('Error in stream processing:', error);
          
          writeEvent('error', { 
            error: `Stream processing error: ${error.message}` 
          });
        } finally {
          // Ensure timer is cleaned up
          if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
          }
          
          // Always send a final event indicating the stream is done
          writeEvent('stream_end', { 
            message: 'Stream finished', 
            timestamp: Date.now() / 1000,
            success: success || false
          });
          
          // Safely close the controller
          safeEndStream();
        }
      } catch (e) {
        console.error('Fatal error in handler:', e);
        
        // Try to send a final error event
        try {
          writeEvent('error', { error: `Fatal error: ${e.message}` });
        } catch (_) {
          console.error('Failed to send error event');
        }
        
        // Ensure the stream is closed properly
        safeEndStream();
      }
    }
  });
  
  // Return the stream as the response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// Helper to escape HTML
function escape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
} 