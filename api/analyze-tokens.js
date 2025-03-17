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
    
    // Estimate token count using the same algorithm as in server.py
    const tokenCount = estimateTokenCount(content);
    
    // Calculate cost estimate (using the same 3.0 per million tokens pricing)
    const costEstimate = (tokenCount / 1000000 * 3.0).toFixed(6);
    
    // Calculate max safe output tokens - same as in server.py
    const maxSafeOutputTokens = Math.min(128000, 200000 - tokenCount - 5000);
    
    // Return the estimated token count with all fields needed by the frontend
    return res.status(200).json({
      success: true,
      token_count: tokenCount,
      estimated_tokens: tokenCount,
      token_count_str: formatNumberWithCommas(tokenCount),
      cost_estimate: parseFloat(costEstimate),
      estimated_cost: parseFloat(costEstimate),
      cost_estimate_str: '$' + costEstimate,
      message: 'Token count estimated for Anthropic Claude API.',
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