// Simple test function for Vercel
module.exports = async (req, res) => {
  // Set headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  // Return detailed information about the environment
  return res.status(200).json({
    status: 'success',
    message: 'Vercel serverless function is working correctly',
    timestamp: new Date().toISOString(),
    vercel_env: process.env.VERCEL_ENV || 'unknown',
    node_version: process.version,
    node_env: process.env.NODE_ENV || 'unknown',
    region: process.env.VERCEL_REGION || 'unknown',
    headers: req.headers,
    method: req.method,
    url: req.url,
    query: req.query || {}
  });
}; 