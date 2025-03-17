// Token analysis function for Vercel using same logic as local
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
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
    
    // Check if content is provided
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }
    
    // Generate system prompt based on file type (same as in process-stream.js)
    const systemPrompt = generateSystemPrompt(fileType);
    
    // Estimate token count for both the content and system prompt
    const contentTokens = estimateTokenCount(content);
    const systemPromptTokens = estimateTokenCount(systemPrompt);
    
    // Total tokens including system prompt and message formatting overhead
    const totalTokens = contentTokens + systemPromptTokens + 20; // 20 tokens for message formatting overhead
    
    // Calculate cost estimate (using the same 3.0 per million tokens pricing)
    const costEstimate = (totalTokens / 1000000 * 3.0).toFixed(6);
    
    // Calculate max safe output tokens - same as in server.py
    const maxSafeOutputTokens = Math.min(128000, 200000 - totalTokens - 5000);
    
    // Return the estimated token count with all fields needed by the frontend
    return res.status(200).json({
      success: true,
      token_count: totalTokens,
      estimated_tokens: totalTokens,
      token_count_str: formatNumberWithCommas(totalTokens),
      cost_estimate: parseFloat(costEstimate),
      estimated_cost: parseFloat(costEstimate),
      cost_estimate_str: '$' + costEstimate,
      message: 'Token count estimated for Anthropic Claude API (includes system prompt).',
      max_safe_output_tokens: maxSafeOutputTokens
    });
    
  } catch (error) {
    // Handle any errors
    console.error('Token analysis error:', error);
    return res.status(500).json({
      success: false,
      error: `Error analyzing tokens: ${error.message}`
    });
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

// Token count estimator - matches the algorithm in server.py
function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Simple word-based estimation, matching the local version
  const wordCount = text.trim().split(/\s+/).length;
  const avgTokensPerWord = 1.3;
  
  // Calculate token count based on words
  const tokenEstimate = Math.round(wordCount * avgTokensPerWord);
  
  return tokenEstimate;
}

// Helper function to format numbers with commas
function formatNumberWithCommas(number) {
  if (number === undefined || number === null) {
    return "0";
  }
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
} 