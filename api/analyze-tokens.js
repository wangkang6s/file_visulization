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
    
    // Format the cost estimate with locale string to match frontend expectations
    const costEstimate = (tokenCount / 1000000 * 3.0).toFixed(6);
    
    // Format token count as string to avoid frontend errors
    const tokenCountStr = tokenCount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    
    // Format cost estimate as string with proper formatting
    const costEstimateStr = '$' + costEstimate.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    
    // Return the estimated token count in the format expected by the frontend
    return res.status(200).json({
      success: true,
      token_count: tokenCount,
      token_count_str: tokenCountStr,
      cost_estimate: costEstimate,
      cost_estimate_str: costEstimateStr,
      message: 'Token count estimated (Vercel serverless)'
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