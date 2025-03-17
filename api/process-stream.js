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
    const maxTokens = body.max_tokens || 128000;
    const thinkingBudget = body.thinking_budget || 32000;
    
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
    
    // Ensure response won't time out (limited to 60 seconds for Vercel free plan)
    req.socket.setTimeout(55 * 1000);
    
    // Log request details for debugging
    console.log(`Processing request: ${content.substring(0, 50)}... (${content.length} chars)`);
    
    const messageId = generateUUID();
    
    // Send initial stream_start message
    // IMPORTANT: USING EXACT STRING MATCH FOR EVENTS
    res.write('event: message\n');
    res.write('data: {"type":"start","message":"Starting HTML generation with Claude API..."}\n\n');
    
    // Use the same system prompt as server.py
    const systemPrompt = "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).";

    // Format user content to match local server
    const userContent = `
    
    Here is the content to transform into a website:
    
    ${content}
    `;

    console.log("About to import Anthropic");
    
    // Use dynamic import to avoid bundling issues
    import('anthropic').then(async (Anthropic) => {
      try {
        console.log("Anthropic imported successfully");
        
        // Create an Anthropic client
        const anthropic = new Anthropic.Anthropic({
          apiKey: apiKey
        });
        
        console.log("Anthropic client created");
        
        // Send message indicating processing - EXACT TEXT FORMAT FROM APP.JS LOGS
        res.write('event: message\n');
        res.write(`data: {"type":"chunk","content":"Processing with Claude..."}\n\n`);
        
        try {
          console.log("Creating stream with Anthropic API...");
          
          // Create the message parameters
          const message = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-20240307',
            max_tokens: 4000, // Reduced for Vercel 60s limit but keeping full functionality
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
          let isFirstChunk = true;
          
          console.log("Stream created, starting to process chunks...");
          
          // Process the streaming response
          for await (const chunk of message) {
            if (isFirstChunk) {
              console.log("First chunk received:", chunk.type);
              isFirstChunk = false;
            }
            
            if (chunk.type === 'message_start') {
              console.log("Message started with ID:", chunk.message.id);
            } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
              const textChunk = chunk.delta.text;
              htmlOutput += textChunk;
              
              // IMPORTANT: MATCHING EXACT FORMAT FROM APP.JS LOGS
              res.write('event: message\n');
              res.write(`data: {"type":"chunk","content":"${escapeJSON(textChunk)}"}\n\n`);
              
              // Flush the response to ensure chunks are sent immediately
              if (res.flush) {
                res.flush();
              }
              
              // For debugging, log every 10th chunk or so
              if (htmlOutput.length % 1000 < 10) {
                console.log(`Processed ${htmlOutput.length} chars so far...`);
              }
            }
          }
          
          console.log(`All chunks processed (${htmlOutput.length} chars), sending completion message...`);
          
          // Calculate token usage
          const systemPromptTokens = Math.floor(systemPrompt.length / 3);
          const contentTokens = Math.floor(content.length / 4);
          const inputTokens = systemPromptTokens + contentTokens;
          const outputTokens = Math.floor(htmlOutput.length / 4);
          
          // Create usage data object
          const usageData = {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            thinking_tokens: thinkingBudget
          };
          
          // IMPORTANT: MATCHING EXACT FORMAT FROM APP.JS
          console.log("Sending message_complete event");
          res.write('event: message\n');
          res.write(`data: {"type":"message_complete","message_id":"${messageId}","usage":{"input_tokens":${inputTokens},"output_tokens":${outputTokens},"thinking_tokens":${thinkingBudget}},"html":"${escapeJSON(htmlOutput)}"}\n\n`);
          
          // Send end message - MATCH EXACT FORMAT
          console.log("Sending end event");
          res.write('event: message\n');
          res.write(`data: {"type":"end","message":"HTML generation complete"}\n\n`);
          
          console.log("Stream complete, closing connection...");
          res.end();
        } catch (apiError) {
          console.error('API call error:', apiError);
          
          // Handle specific API errors
          let errorMessage = 'Error calling Claude API - try with a smaller input';
          if (apiError.status === 401) {
            errorMessage = 'Invalid API key or authentication error';
          } else if (apiError.status === 400) {
            errorMessage = 'Bad request: ' + (apiError.message || 'Check input parameters');
          } else if (apiError.status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
          } else if (apiError.status >= 500) {
            errorMessage = 'Claude API service error. Please try again later.';
          } else if (apiError.message && apiError.message.includes('timeout')) {
            errorMessage = 'Request timed out. Try with a smaller input on Vercel (60s limit).';
          }
          
          // Send error in the format expected by the client
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