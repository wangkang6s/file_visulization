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
    
    // Estimate token count based on a simple heuristic
    // This is a very rough approximation - Claude's actual tokenization is more complex
    const tokenCount = estimateTokenCount(content);
    
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
      message: 'Token count estimated (Vercel serverless)',
      max_safe_output_tokens: Math.min(128000, 200000 - tokenCount - 5000) // Similar to server.py logic
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

// Simple token count estimator
function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Count words (split by whitespace)
  const words = text.trim().split(/\s+/).length;
  
  // Estimate tokens (Claude uses about 1.3 tokens per word on average)
  const estimatedTokens = Math.ceil(words * 1.3);
  
  // Add a small buffer for safety
  return estimatedTokens + 10;
}

// Helper function to format numbers with commas
function formatNumberWithCommas(number) {
  if (number === undefined || number === null) {
    return "0";
  }
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
} 