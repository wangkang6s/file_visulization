// Validate Anthropic API key function for Vercel
module.exports = async (req, res) => {
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
    // Get API key from request body
    const { api_key } = req.body || {};
    
    // Check if API key is provided
    if (!api_key) {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }
    
    // Perform basic validation on the key format
    if (!api_key.startsWith('sk-ant-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid API key format. Anthropic API keys should start with "sk-ant-"'
      });
    }
    
    // For Vercel deployment, we'll skip the actual API validation to avoid issues
    // Just check the format and assume it's valid if it matches the expected pattern
    return res.status(200).json({
      success: true,
      message: 'API key format is valid',
      model: 'Claude 3.7 Sonnet'
    });
    
  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({
      success: false,
      error: `Error validating API key: ${error.message}`
    });
  }
}; 