// Process stream function for Vercel using Anthropic API
module.exports = async (req, res) => {
  // Set headers
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
      error: 'Method not allowed'
    });
  }
  
  try {
    // Get content from request body
    const body = req.body || {};
    const content = body.content || body.source || '';
    const apiKey = body.api_key || '';
    const maxTokens = body.max_tokens || 128000;
    const thinkingBudget = body.thinking_budget || 32000;
    
    if (!content) {
      return res.status(400).json({
        error: 'Content is required'
      });
    }
    
    if (!apiKey || !apiKey.startsWith('sk-ant')) {
      res.write('event: message\n');
      res.write('data: {"type":"error","error":"Valid API key required"}\n\n');
      res.end();
      return;
    }
    
    // Generate messageId
    const messageId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    // Send start event - EXACTLY as expected by app.js
    res.write('event: message\n');
    res.write('data: {"type":"start","message":"Starting HTML generation with Claude API..."}\n\n');
    
    // System prompt
    const systemPrompt = "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).";
    
    // Format user content
    const userContent = `Generate HTML for this content: ${content.substring(0, Math.min(content.length, 3000))}`;
    
    // Always send an initial chunk to keep connection alive
    res.write('event: message\n');
    res.write('data: {"type":"chunk","content":"Processing with Claude..."}\n\n');
    
    // Import and use Anthropic
    const Anthropic = await import('anthropic');
    const anthropic = new Anthropic.Anthropic({
      apiKey: apiKey
    });
    
    // Create message with streaming
    const message = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20240307',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      stream: true
    });
    
    let htmlOutput = '';
    
    // Process chunks
    for await (const chunk of message) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
        const textChunk = chunk.delta.text;
        htmlOutput += textChunk;
        
        // Send chunk - EXACTLY as expected by app.js
        res.write('event: message\n');
        res.write(`data: {"type":"chunk","content":"${escape(textChunk)}"}\n\n`);
      }
    }
    
    // Calculate token usage
    const systemPromptTokens = Math.floor(systemPrompt.length / 3);
    const contentTokens = Math.floor(content.length / 4);
    const inputTokens = systemPromptTokens + contentTokens;
    const outputTokens = Math.floor(htmlOutput.length / 4);
    
    // Send completion message - EXACTLY as expected by app.js
    res.write('event: message\n');
    res.write(`data: {"type":"message_complete","message_id":"${messageId}","usage":{"input_tokens":${inputTokens},"output_tokens":${outputTokens},"thinking_tokens":${thinkingBudget}},"html":"${escape(htmlOutput)}"}\n\n`);
    
    // Send end event - EXACTLY as expected by app.js
    res.write('event: message\n');
    res.write('data: {"type":"end","message":"HTML generation complete"}\n\n');
    
    res.end();
  } catch (error) {
    console.error('Error:', error);
    
    // Send error message
    res.write('event: message\n');
    res.write(`data: {"type":"error","error":"${escape(error.message)}"}\n\n`);
    res.end();
  }
};

// Escape special characters
function escape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
} 