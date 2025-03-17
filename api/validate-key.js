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
    
    // Try to import Anthropic
    try {
      const { Anthropic } = await import('anthropic');
      
      // Create a client with the provided API key
      const anthropic = new Anthropic({
        apiKey: api_key,
      });
      
      // Attempt a simple API call to validate the key (with minimal token usage)
      const response = await anthropic.messages.create({
        model: 'claude-3-7-sonnet-20240307',
        max_tokens: 1,
        messages: [
          {
            role: 'user',
            content: 'Hello. This is an API key validation test. Please respond with the word "valid" only.'
          }
        ],
        system: 'Respond with the word "valid" only, no other text.',
      });
      
      // If we got here, the API key is valid
      return res.status(200).json({
        success: true,
        message: 'API key is valid',
        model: 'Claude 3.7 Sonnet'
      });
      
    } catch (error) {
      console.error('Anthropic API error:', error);
      
      // Check for specific error messages that indicate invalid API key
      if (
        error.message.includes('invalid api key') || 
        error.message.includes('Invalid API key') ||
        error.message.includes('unauthorized') ||
        error.message.includes('Unauthorized')
      ) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key. Please check your Anthropic API key and try again.'
        });
      }
      
      // Other errors (rate limits, server issues, etc.)
      return res.status(500).json({
        success: false,
        error: `Error validating API key: ${error.message}`
      });
    }
    
  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({
      success: false,
      error: `Error validating API key: ${error.message}`
    });
  }
}; 