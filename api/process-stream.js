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
      return res.status(400).json({
        success: false,
        error: 'Valid Anthropic API key is required'
      });
    }
    
    // Start streaming response
    // Send initial message
    res.write('event: message\n');
    res.write(`data: {"type":"start","message":"Starting HTML generation with Claude API..."}\n\n`);
    
    // Import Anthropic (using dynamic import)
    import('anthropic').then(async (Anthropic) => {
      try {
        // Create an Anthropic client
        const anthropic = new Anthropic.Anthropic({
          apiKey: apiKey
        });
        
        // Generate system prompt based on file type
        const systemPrompt = generateSystemPrompt(fileType);
        
        // Send a message to indicate the process has started
        res.write('event: message\n');
        res.write(`data: {"type":"processing","message":"Processing with Claude..."}\n\n`);
        
        // Create the message parameters
        const message = await anthropic.messages.create({
          model: 'claude-3-7-sonnet-20240307',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: content
            }
          ],
          stream: true
        });
        
        // Collect the streaming response
        let htmlOutput = '';
        let messageId = '';
        
        // Process the streaming response
        for await (const chunk of message) {
          if (chunk.type === 'message_start') {
            messageId = chunk.message.id;
          } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
            const textChunk = chunk.delta.text;
            htmlOutput += textChunk;
            
            // Send the chunk to the client
            res.write('event: message\n');
            res.write(`data: {"type":"chunk","content":"${escapeJSON(textChunk)}"}\n\n`);
          }
        }
        
        // Calculate token usage
        const tokenCount = estimateTokenCount(content);
        const outputTokens = estimateTokenCount(htmlOutput);
        
        // Send completion message with the full HTML
        res.write('event: message\n');
        res.write(`data: {"type":"message_complete","message_id":"${messageId}","usage":{"input_tokens":${tokenCount},"output_tokens":${outputTokens},"thinking_tokens":${thinkingBudget}},"html":"${escapeJSON(htmlOutput)}"}\n\n`);
        
        // Send end message
        res.write('event: message\n');
        res.write(`data: {"type":"end","message":"HTML generation complete"}\n\n`);
        res.end();
      } catch (error) {
        console.error('Anthropic API error:', error);
        
        res.write('event: message\n');
        res.write(`data: {"type":"error","error":"Anthropic API error: ${escapeJSON(error.message)}"}\n\n`);
        res.end();
      }
    }).catch(error => {
      console.error('Failed to import Anthropic:', error);
      
      res.write('event: message\n');
      res.write(`data: {"type":"error","error":"Failed to import Anthropic: ${escapeJSON(error.message)}"}\n\n`);
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

// Generate system prompt based on file type
function generateSystemPrompt(fileType) {
  let fileTypePrompt = "";
  
  // Customize prompt based on file type
  switch(fileType.toLowerCase()) {
    case 'code':
    case 'js':
    case 'javascript':
    case 'py':
    case 'python':
    case 'java':
    case 'c':
    case 'cpp':
    case 'cs':
    case 'go':
    case 'rust':
    case 'php':
    case 'ruby':
    case 'swift':
    case 'kotlin':
    case 'typescript':
    case 'ts':
      fileTypePrompt = "The input is source code. Please provide a detailed explanation of what this code does, including function explanations, API usage, algorithm analysis, and potential bugs or improvements.";
      break;
    case 'json':
    case 'xml':
    case 'yaml':
    case 'yml':
    case 'toml':
      fileTypePrompt = "The input is structured data. Please provide a visualization and explanation of this data structure, highlighting key elements and relationships.";
      break;
    case 'html':
    case 'css':
    case 'scss':
      fileTypePrompt = "The input is web markup/styling. Please analyze the structure, styles, and potential rendering, suggesting improvements or issues.";
      break;
    case 'markdown':
    case 'md':
      fileTypePrompt = "The input is markdown text. Please convert it to a beautifully formatted HTML representation with proper styling.";
      break;
    case 'txt':
    case 'text':
    default:
      fileTypePrompt = "The input is plain text. Please analyze and structure this content into a well-formatted HTML document.";
  }
  
  // Generate the complete system prompt
  return `You are an expert file visualization agent that creates HTML representations of various file types. Your goal is to generate a well-structured, informative HTML document that helps users understand the content of their files.

${fileTypePrompt}

Your output must follow these rules:
1. Return ONLY valid HTML that can be directly injected into a web page. Do not include any markdown, explanations outside the HTML, or code blocks.
2. Include a complete HTML document with <html>, <head>, and <body> tags.
3. Include appropriate styling using internal CSS to make your visualization visually appealing and easy to understand.
4. Use semantic HTML elements where appropriate.
5. Include syntax highlighting for code samples.
6. Add visual elements like tables, lists, or sections to organize information.
7. Ensure your HTML is valid and properly escaped.
8. Provide a thorough analysis of the file content.

Return the complete HTML document as your response.`;
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

// Token count estimator
function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Base calculation using the same method as in the Python code
  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).length;
  
  // Use the same multiplier as in the Python code
  const avgTokensPerWord = 1.3;
  
  // Calculate tokens based on words with character-based adjustment
  const tokenEstimate = Math.round(wordCount * avgTokensPerWord);
  
  return tokenEstimate;
} 