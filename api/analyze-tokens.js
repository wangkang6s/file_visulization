// Simple token analysis function for Vercel
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
    
    // Check if content is provided
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }
    
    // Estimate token count based on a more accurate heuristic
    const tokenCount = estimateTokenCount(content, fileType);
    
    // Format cost estimate with 6 decimal places
    const costEstimate = (tokenCount / 1000000 * 3.0).toFixed(6);
    
    // Return the estimated token count with ALL fields needed by the frontend
    return res.status(200).json({
      success: true,
      token_count: tokenCount,
      estimated_tokens: tokenCount,
      token_count_str: formatNumberWithCommas(tokenCount),
      cost_estimate: parseFloat(costEstimate),
      estimated_cost: parseFloat(costEstimate),
      cost_estimate_str: '$' + costEstimate,
      message: '⚠️ VERCEL DEPLOYMENT: Token count estimated without using Claude API. For accurate counts, please run locally.',
      max_safe_output_tokens: Math.min(128000, 200000 - tokenCount - 5000), // Similar to server.py logic
      is_vercel: true // Flag to indicate this is the Vercel version
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

// More accurate token count estimator based on file type
function estimateTokenCount(text, fileType) {
  if (!text) return 0;
  
  // Base calculation
  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).length;
  
  // Different multipliers based on file type
  let tokenMultiplier = 1.3; // Default multiplier (about 1.3 tokens per word for English text)
  
  // Adjust multiplier based on file type
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
      // Code tends to have more tokens per word due to symbols, operators, etc.
      tokenMultiplier = 1.5;
      break;
    case 'json':
    case 'xml':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'csv':
      // Structured data formats have even more tokens per word
      tokenMultiplier = 1.7;
      break;
    case 'html':
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      // Markup and style languages
      tokenMultiplier = 1.6;
      break;
    case 'markdown':
    case 'md':
    case 'txt':
    case 'text':
      // Plain text or markdown
      tokenMultiplier = 1.3;
      break;
    default:
      // Default case
      tokenMultiplier = 1.3;
  }
  
  // Calculate estimated tokens using both character and word count
  // This is a more sophisticated approach that works better for different languages and formats
  const charBasedEstimate = charCount / 3.5; // Roughly 3.5 characters per token on average
  const wordBasedEstimate = wordCount * tokenMultiplier;
  
  // Take the average of the two estimates
  const estimatedTokens = Math.ceil((charBasedEstimate + wordBasedEstimate) / 2);
  
  // Add a small buffer for safety
  return estimatedTokens + 20;
}

// Helper function to format numbers with commas
function formatNumberWithCommas(number) {
  if (number === undefined || number === null) {
    return "0";
  }
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
} 