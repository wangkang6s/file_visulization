// Simple test endpoint to verify Vercel deployment
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Return a simple response with timestamp to verify deployment
  res.status(200).json({
    success: true,
    message: "Vercel deployment is working! Updated version.",
    version: "1.0.1",
    timestamp: new Date().toISOString(),
    deployment_id: "6513b61fa", // Last git commit hash
    update_time: "2025-03-17T03:30:00Z" // Fixed timestamp for verification
  });
}; 