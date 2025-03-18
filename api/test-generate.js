// Test generate function for Vercel that uses minimal Anthropic API tokens
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }
  
  try {
    // Get content from request body
    const body = req.body || {};
    const content = body.content || body.source || '';
    const apiKey = body.api_key || '';
    
    if (!content) {
      return res.status(400).json({ 
        success: false, 
        error: 'Content is required' 
      });
    }
    
    if (!apiKey || !apiKey.startsWith('sk-ant')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid API key is required' 
      });
    }
    
    console.log(`Got request with content length: ${content.length}`);
    
    // Truncate content to just 500 characters to minimize token usage
    const truncatedContent = content.length > 500 ? content.substring(0, 500) + '...' : content;
    
    // Start time for measuring elapsed time
    const startTime = Date.now();
    
    try {
      // Import Anthropic SDK
      const { Anthropic } = await import('@anthropic-ai/sdk');
      const anthropic = new Anthropic({
        apiKey: apiKey
      });
      
      // Brief system prompt to minimize token usage
      const systemPrompt = "Generate minimal HTML to confirm the API integration works.";
      
      // Minimal user prompt
      const userPrompt = `Generate a very simple HTML page that confirms the API works. The content is: ${truncatedContent}`;
      
      // Call Anthropic API with minimal settings
      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307", // Use smaller model to save tokens
        max_tokens: 100, // Minimal output
        temperature: 0.5,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      });
      
      // Get the response content
      const htmlOutput = response.content[0].text;
      
      // Calculate elapsed time
      const elapsedTime = (Date.now() - startTime) / 1000; // Convert to seconds
      
      // Calculate token usage (estimates)
      const systemPromptTokens = Math.floor(systemPrompt.length / 3);
      const contentTokens = Math.floor(truncatedContent.length / 4);
      const outputTokens = Math.floor(htmlOutput.length / 4);
      
      // Return JSON response with HTML and usage stats
      return res.status(200).json({
        success: true,
        html: htmlOutput,
        usage: {
          input_tokens: systemPromptTokens + contentTokens,
          output_tokens: outputTokens,
          thinking_tokens: 0, // No thinking tokens used in this simplified test
          time_elapsed: elapsedTime,
          total_cost: ((systemPromptTokens + contentTokens + outputTokens) / 1000000 * 3.0)
        },
        test_mode: true,
        message: "Test completed with minimal token usage"
      });
      
    } catch (apiError) {
      console.error('Error calling Anthropic API:', apiError);
      return res.status(500).json({
        success: false,
        error: `Error calling Anthropic API: ${apiError.message}`
      });
    }
    
  } catch (error) {
    console.error('Error in test generation:', error);
    return res.status(500).json({
      success: false,
      error: `Error in test generation: ${error.message}`
    });
  }
}; 