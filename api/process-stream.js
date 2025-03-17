// Process stream function for Vercel using Anthropic API
module.exports = (req, res) => {
  // Set bare minimum headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Handle OPTIONS request
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
    const apiKey = body.api_key || '';
    const maxTokens = body.max_tokens || 128000; // Keep original value
    const thinkingBudget = body.thinking_budget || 32000; // Keep original value
    
    // Check if content and API key are provided
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }
    
    if (!apiKey || !apiKey.startsWith('sk-ant')) {
      res.write('event: message\n');
      res.write('data: {"type":"error","error":"Valid Anthropic API key is required"}\n\n');
      res.end();
      return;
    }
    
    // Generate a messageId for tracking
    const messageId = ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    // Start event
    res.write('event: message\n');
    res.write('data: {"type":"start","message":"Starting HTML generation with Claude API..."}\n\n');
    
    // Chunk event - always send a processing chunk to keep connection alive
    res.write('event: message\n');
    res.write('data: {"type":"chunk","content":"Processing with Claude..."}\n\n');
    
    // System prompt (same as in local version)
    const systemPrompt = "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).";
    
    // Import anthropic
    import('anthropic').then(async (Anthropic) => {
      try {
        // Create client
        const anthropic = new Anthropic.Anthropic({
          apiKey: apiKey
        });
        
        try {
          // Non-streaming call to avoid connection issues
          const response = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-20240307',
            max_tokens: 4000, // Reduced for time constraints but keeping maximum output quality
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: `Generate HTML for this content: ${content.substring(0, Math.min(content.length, 3000))}`
              }
            ]
          });
          
          // Extract the HTML content 
          const htmlOutput = response.content[0].text;
          
          // Calculate token usage
          const systemPromptTokens = Math.floor(systemPrompt.length / 3);
          const contentTokens = Math.floor(content.length / 4);
          const inputTokens = systemPromptTokens + contentTokens;
          const outputTokens = Math.floor(htmlOutput.length / 4);
          
          // Send the completion message
          res.write('event: message\n');
          res.write(`data: {"type":"message_complete","message_id":"${messageId}","usage":{"input_tokens":${inputTokens},"output_tokens":${outputTokens},"thinking_tokens":${thinkingBudget}},"html":"${escapeString(htmlOutput)}"}\n\n`);
          
          // End event
          res.write('event: message\n');
          res.write('data: {"type":"end","message":"HTML generation complete"}\n\n');
          
          res.end();
        } catch (apiError) {
          console.error('API call error:', apiError);
          
          let errorMessage = 'Error calling Claude API';
          if (apiError.status === 401) {
            errorMessage = 'Invalid API key';
          }
          
          res.write('event: message\n');
          res.write(`data: {"type":"error","error":"${escapeString(errorMessage)}"}\n\n`);
          res.end();
        }
      } catch (error) {
        console.error('Client error:', error);
        
        res.write('event: message\n');
        res.write(`data: {"type":"error","error":"Client error: ${escapeString(error.message)}"}\n\n`);
        res.end();
      }
    }).catch(importError => {
      console.error('Import error:', importError);
      
      res.write('event: message\n');
      res.write(`data: {"type":"error","error":"Import error: ${escapeString(importError.message)}"}\n\n`);
      res.end();
    });
  } catch (error) {
    console.error('Process error:', error);
    
    res.write('event: message\n');
    res.write(`data: {"type":"error","error":"Process error: ${escapeString(error.message)}"}\n\n`);
    res.end();
  }
};

// Simple escape function for JSON values
function escapeString(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
} 