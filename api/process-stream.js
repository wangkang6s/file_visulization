// Simple process-stream function for Vercel
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
    // Log the request body for debugging
    console.log('Request body:', req.body);
    
    // Get content from request body
    const body = req.body || {};
    
    // Check for both 'content' and 'source' parameters for compatibility
    let content = body.content || '';
    if (!content && body.source) {
      content = body.source; // Fallback to 'source' if 'content' is empty
    }
    
    const fileType = body.file_type || 'txt';
    const apiKey = body.api_key || '';
    
    // Check if content is provided
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }
    
    // Start streaming response
    // Send initial message
    res.write('event: message\n');
    res.write(`data: {"type":"start","message":"⚠️ VERCEL DEPLOYMENT: This is a simplified HTML generation without using Claude API. For full functionality, please run locally."}\n\n`);
    
    // Add a small delay to simulate processing
    setTimeout(() => {
      // Generate a simple HTML representation
      const htmlContent = generateSimpleHTML(content, fileType);
      
      // Split the HTML into chunks to simulate streaming
      const chunks = splitIntoChunks(htmlContent, 500);
      
      // Track the collected HTML for the final message
      let collectedHtml = '';
      
      // Send chunks with a small delay to simulate streaming
      let chunkIndex = 0;
      
      const sendNextChunk = () => {
        if (chunkIndex < chunks.length) {
          const chunk = chunks[chunkIndex];
          collectedHtml += chunk;
          
          res.write('event: message\n');
          res.write(`data: {"type":"chunk","content":"${escapeJSON(chunk)}"}\n\n`);
          chunkIndex++;
          
          // Schedule next chunk
          setTimeout(sendNextChunk, 100);
        } else {
          // Send completion message with the full HTML
          res.write('event: message\n');
          res.write(`data: {"type":"message_complete","message_id":"vercel-${Date.now()}","usage":{"input_tokens":${estimateTokenCount(content)},"output_tokens":${estimateTokenCount(htmlContent)},"thinking_tokens":0},"html":"${escapeJSON(htmlContent)}"}\n\n`);
          
          // Send end message
          res.write('event: message\n');
          res.write(`data: {"type":"end","message":"⚠️ VERCEL DEPLOYMENT: HTML generation complete without using Claude API. For full functionality, please run locally."}\n\n`);
          res.end();
        }
      };
      
      // Start sending chunks
      sendNextChunk();
    }, 1000); // Add a 1-second delay to make it clear this is a simulation
    
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

// Generate a simple HTML representation of the content
function generateSimpleHTML(content, fileType) {
  // Create a basic HTML structure
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>File Visualization</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; margin: 20px; color: #333; }
    pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .highlight { background-color: #ffffcc; }
    h1, h2 { color: #333; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .note { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0; }
    .warning { color: #dc3545; font-weight: bold; }
    code { font-family: monospace; background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>File Visualization</h1>
    <div class="note">
      <p class="warning">⚠️ IMPORTANT: This is a simplified HTML representation generated by the Vercel serverless function WITHOUT using Claude API.</p>
      <p>For full Claude-powered visualization with AI analysis, please run the application locally with your API key.</p>
    </div>
    
    <h2>Content Preview</h2>
    <pre>${escapeHTML(content)}</pre>
    
    <h2>File Type</h2>
    <p><code>${escapeHTML(fileType)}</code></p>
    
    <h2>About This Visualization</h2>
    <p>This is a placeholder response for the Vercel deployment. The actual Claude-powered visualization 
    requires your API key and is only available when running locally.</p>
    
    <h3>How to Run Locally</h3>
    <ol>
      <li>Clone the repository: <code>git clone https://github.com/hubeiqiao/File-Visualizer.git</code></li>
      <li>Install dependencies: <code>pip install -r requirements.txt</code></li>
      <li>Run the server: <code>python server.py --port 5009 --no-reload</code></li>
      <li>Open <a href="http://localhost:5009">http://localhost:5009</a> in your browser</li>
      <li>Enter your Anthropic API key and enjoy the full functionality!</li>
    </ol>
    
    <div class="note">
      <p class="warning">⚠️ NOTE: The Vercel deployment cannot use the Anthropic API because it would require exposing your API key.</p>
      <p>For security reasons, we only provide a simplified visualization here. To use Claude's powerful AI capabilities, please run locally.</p>
    </div>
  </div>
</body>
</html>`;

  return html;
}

// Split text into chunks of specified size
function splitIntoChunks(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
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

// Simple token count estimator
function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Count words (split by whitespace)
  const words = String(text).trim().split(/\s+/).length;
  
  // Estimate tokens (Claude uses about 1.3 tokens per word on average)
  const estimatedTokens = Math.ceil(words * 1.3);
  
  // Add a small buffer for safety
  return estimatedTokens + 10;
} 