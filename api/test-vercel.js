// Simple test endpoint to verify Vercel deployment
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Return a simple response with timestamp to verify deployment
  res.status(200).json({
    success: true,
    message: "Vercel deployment is working!",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    deployment_id: "c0d585152" // Last git commit hash
  });
}; 