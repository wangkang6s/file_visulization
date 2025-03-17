// Simple API key validation function for Vercel
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
      valid: false,
      message: 'Method not allowed. Use POST.'
    });
  }
  
  try {
    // Get API key from request body
    const apiKey = req.body && req.body.api_key;
    
    // Check if API key is provided
    if (!apiKey) {
      return res.status(400).json({
        valid: false,
        message: 'API key is required'
      });
    }
    
    // Simple format validation
    if (!apiKey.startsWith('sk-ant')) {
      return res.status(400).json({
        valid: false,
        message: 'API key format is invalid. It should start with \'sk-ant\''
      });
    }
    
    // If we get here, the key format is valid
    return res.status(200).json({
      valid: true,
      message: 'API key format is valid'
    });
    
  } catch (error) {
    // Handle any errors
    console.error('API key validation error:', error);
    return res.status(500).json({
      valid: false,
      message: `Error validating API key: ${error.message}`
    });
  }
}; 