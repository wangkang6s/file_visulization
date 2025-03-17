// Process stream function for Vercel using Anthropic API
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream');
  
  // Handle OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }
  
  try {
    // Get content from request body
    const body = req.body || {};
    
    // Check for both 'content' and 'source' parameters for compatibility
    let content = body.content || '';
    if (!content && body.source) {
      content = body.source; // Fallback to 'source' if 'content' is empty
    }
    
    const fileType = body.file_type || 'txt';
    const apiKey = body.api_key || '';
    const maxTokens = body.max_tokens || 4000; // Reduced for Vercel free plan
    const thinkingBudget = body.thinking_budget || 1000; // Reduced for Vercel free plan
    
    // Check if content and API key are provided
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }
    
    if (!apiKey || !apiKey.startsWith('sk-ant')) {
      res.write('event: message\n');
      res.write(`data: {"type":"error","error":"Valid Anthropic API key is required (should start with sk-ant)"}\n\n`);
      res.end();
      return;
    }
    
    // Ensure response won't time out for long generations (60 seconds max for Vercel free plan)
    req.socket.setTimeout(58 * 1000);
    
    // Send initial stream_start message - match local server format
    res.write('event: message\n');
    res.write(`data: {"type":"stream_start","message":"Stream starting"}\n\n`);
    
    // Log that we're starting the stream
    console.log("Starting stream with Anthropic API...");
    
    // Use the same system prompt as server.py but shortened for Vercel
    const systemPrompt = "Create a visually appealing HTML webpage from the provided content. Use modern design, responsive layout, and proper HTML structure.";

    // Format user content to match local server but limit size for Vercel
    const userContent = `Create an HTML visualization for this content (limited to ${maxTokens} tokens for Vercel): ${content.substring(0, 2000)}`;

    // Use dynamic import to avoid bundling issues
    import('anthropic').then(async (Anthropic) => {
      try {
        // Create an Anthropic client
        const anthropic = new Anthropic.Anthropic({
          apiKey: apiKey
        });
        
        // Generate a unique message ID to match local server behavior
        const messageId = generateUUID();
        console.log("Generated message ID:", messageId);
        
        // Send a message to indicate the process has started
        res.write('event: message\n');
        res.write(`data: {"type":"content","chunk_id":"${messageId}","delta":{"text":"Processing with Claude (Vercel 60s limit)..."}}\n\n`);
        
        try {
          // Create the message parameters to match local server as closely as possible
          console.log("Creating stream with Anthropic API...");
          const message = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-20240307',
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: userContent
              }
            ],
            stream: true
          });
          
          // Collect the streaming response
          let htmlOutput = '';
          
          console.log("Stream created, starting to process chunks...");
          
          // Process the streaming response
          for await (const chunk of message) {
            // Log chunk type for debugging
            console.log("Received chunk type:", chunk.type);
            
            if (chunk.type === 'message_start') {
              console.log("Message started with ID:", chunk.message.id);
            } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
              const textChunk = chunk.delta.text;
              htmlOutput += textChunk;
              
              // Send the chunk to the client in the same format as the local server
              const contentData = {
                type: "content",
                chunk_id: messageId,
                delta: {
                  text: textChunk
                }
              };
              
              res.write('event: message\n');
              res.write(`data: ${JSON.stringify(contentData)}\n\n`);
              
              // Flush the response to ensure chunks are sent immediately
              if (res.flush) {
                res.flush();
              }
            }
          }
          
          console.log("All chunks processed, sending completion message...");
          
          // Calculate token usage the same way as server.py
          const systemPromptTokens = Math.floor(systemPrompt.length / 3);
          const contentTokens = Math.floor(content.length / 4);
          const inputTokens = systemPromptTokens + contentTokens;
          const outputTokens = Math.floor(htmlOutput.length / 4);
          
          // Create usage data object to match local server format
          const usageData = {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            thinking_tokens: thinkingBudget
          };
          
          // Send completion message with the full HTML to match local server format
          const completeData = {
            type: "content",
            chunk_id: messageId,
            message_complete: {
              message_id: messageId,
              usage: usageData,
              html: htmlOutput
            }
          };
          
          res.write('event: message\n');
          res.write(`data: ${JSON.stringify(completeData)}\n\n`);
          
          // Send end message to match local server format
          res.write('event: message\n');
          res.write(`data: {"type":"stream_end","message":"Stream complete"}\n\n`);
          
          console.log("Stream complete, closing connection...");
          res.end();
        } catch (apiError) {
          console.error('API call error:', apiError);
          
          // Handle specific API errors
          let errorMessage = 'Error calling Claude API';
          if (apiError.status === 401) {
            errorMessage = 'Invalid API key or authentication error';
          } else if (apiError.status === 400) {
            errorMessage = 'Bad request: ' + (apiError.message || 'Check input parameters');
          } else if (apiError.status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
          } else if (apiError.status >= 500) {
            errorMessage = 'Claude API service error. Please try again later.';
          }
          
          // Send error in the format expected by the local server
          res.write('event: message\n');
          res.write(`data: {"type":"error","error":"${escapeJSON(errorMessage)}"}\n\n`);
          res.end();
        }
      } catch (error) {
        console.error('Anthropic client error:', error);
        
        res.write('event: message\n');
        res.write(`data: {"type":"error","error":"Anthropic client error: ${escapeJSON(error.message)}"}\n\n`);
        res.end();
      }
    }).catch(importError => {
      console.error('Failed to import Anthropic:', importError);
      
      res.write('event: message\n');
      res.write(`data: {"type":"error","error":"Failed to import Anthropic library: ${escapeJSON(importError.message)}"}\n\n`);
      res.end();
    });
  } catch (error) {
    // Handle any errors
    console.error('Process stream error:', error);
    try {
      // Send error as SSE message
      res.write('event: message\n');
      res.write(`data: {"type":"error","error":"${escapeJSON(error.message)}"}\n\n`);
      res.end();
    } catch (e) {
      // If we can't send as SSE, try JSON
      res.status(500).json({
        success: false,
        error: `Error processing stream: ${error.message}`
      });
    }
  }
};

// Generate a UUID to match the server's behavior
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Escape HTML special characters
function escapeHTML(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Escape special characters for JSON
function escapeJSON(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f');
} 