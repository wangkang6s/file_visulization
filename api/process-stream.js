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
    // Log the start of the request
    console.log('Process-stream request received');
    
    // Get content from request body
    const body = req.body || {};
    const content = body.content || body.source || '';
    const apiKey = body.api_key || '';
    const maxTokens = body.max_tokens || 128000;
    const thinkingBudget = body.thinking_budget || 32000;
    const temperature = body.temperature || 0.5;
    const formatPrompt = body.format_prompt || '';
    
    console.log(`Request params: content length: ${content.length}, maxTokens: ${maxTokens}, temperature: ${temperature}`);
    
    if (!content) {
      console.error('Content is required but was empty');
      return res.status(400).json({
        error: 'Content is required'
      });
    }
    
    if (!apiKey || !apiKey.startsWith('sk-ant')) {
      console.error('Invalid API key format');
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
    
    console.log(`Generated message ID: ${messageId}`);
    
    // Send start event - EXACTLY as expected by app.js
    res.write('event: message\n');
    res.write('data: {"type":"start","message":"Starting HTML generation with Claude API..."}\n\n');
    
    try {
      if (res.flush) {
        res.flush();
        console.log('Flushed initial start event');
      }
    } catch (flushErr) {
      console.error('Error flushing start event:', flushErr);
    }
    
    // System prompt
    const systemPrompt = "I will provide you with a file or a content, analyze its content, and transform it into a visually appealing and well-structured webpage.### Content Requirements* Maintain the core information from the original file while presenting it in a clearer and more visually engaging format.⠀Design Style* Follow a modern and minimalistic design inspired by Linear App.* Use a clear visual hierarchy to emphasize important content.* Adopt a professional and harmonious color scheme that is easy on the eyes for extended reading.⠀Technical Specifications* Use HTML5, TailwindCSS 3.0+ (via CDN), and necessary JavaScript.* Implement a fully functional dark/light mode toggle, defaulting to the system setting.* Ensure clean, well-structured code with appropriate comments for easy understanding and maintenance.⠀Responsive Design* The page must be fully responsive, adapting seamlessly to mobile, tablet, and desktop screens.* Optimize layout and typography for different screen sizes.* Ensure a smooth and intuitive touch experience on mobile devices.⠀Icons & Visual Elements* Use professional icon libraries like Font Awesome or Material Icons (via CDN).* Integrate illustrations or charts that best represent the content.* Avoid using emojis as primary icons.* Check if any icons cannot be loaded.⠀User Interaction & ExperienceEnhance the user experience with subtle micro-interactions:* Buttons should have slight enlargement and color transitions on hover.* Cards should feature soft shadows and border effects on hover.* Implement smooth scrolling effects throughout the page.* Content blocks should have an elegant fade-in animation on load.⠀Performance Optimization* Ensure fast page loading by avoiding large, unnecessary resources.* Use modern image formats (WebP) with proper compression.* Implement lazy loading for content-heavy pages.⠀Output Requirements* Deliver a fully functional standalone HTML file, including all necessary CSS and JavaScript.* Ensure the code meets W3C standards with no errors or warnings.* Maintain consistent design and functionality across different browsers.⠀Create the most effective and visually appealing webpage based on the uploaded file's content type (document, data, images, etc.).";
    
    // Format user content - limit to shorter content for Vercel to avoid timeouts
    const userContent = formatPrompt ? 
      `${formatPrompt}\n\nGenerate HTML for this content: ${content.substring(0, Math.min(content.length, 50000))}` :
      `Generate HTML for this content: ${content.substring(0, Math.min(content.length, 50000))}`;
    
    console.log(`User content prepared, length: ${userContent.length}`);
    
    // Send a chunk to keep connection alive 
    res.write('event: message\n');
    res.write('data: {"type":"delta","content":"Processing with Claude..."}\n\n');
    try {
      if (res.flush) {
        res.flush();
        console.log('Flushed initial processing message');
      }
    } catch (flushErr) {
      console.error('Error flushing processing message:', flushErr);
    }
    
    console.log('Importing Anthropic...');
    // Import and use Anthropic
    const Anthropic = await import('anthropic');
    console.log('Creating Anthropic client...');
    const anthropic = new Anthropic.Anthropic({
      apiKey: apiKey
    });
    
    console.log('Creating message with streaming...');
    // Create message with streaming
    const message = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20240307',
      max_tokens: maxTokens,
      temperature: temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      stream: true
    });
    
    console.log('Stream created, processing chunks...');
    let htmlOutput = '';
    let chunkCount = 0;
    
    // Process chunks
    for await (const chunk of message) {
      chunkCount++;
      
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
        const textChunk = chunk.delta.text;
        htmlOutput += textChunk;
        
        // Send chunk in the format expected by app.js
        res.write('event: message\n');
        res.write(`data: {"type":"delta","content":"${escape(textChunk)}"}\n\n`);
        
        // Log every 10th chunk to avoid excessive logging
        if (chunkCount % 10 === 0) {
          console.log(`Processed ${chunkCount} chunks so far, current chunk length: ${textChunk.length}`);
        }
        
        // Send flush to ensure data is sent immediately
        try {
          if (res.flush) {
            res.flush();
          }
        } catch (flushErr) {
          console.error(`Error flushing chunk #${chunkCount}:`, flushErr);
        }
      }
      // Also handle thinking type responses if they exist
      else if (chunk.type === 'thinking') {
        console.log('Received thinking update');
        res.write('event: message\n');
        res.write(`data: {"type":"thinking_update","thinking":{"content":"${escape(chunk.thinking ? chunk.thinking.content : '')}"}}}\n\n`);
        
        try {
          if (res.flush) {
            res.flush();
          }
        } catch (flushErr) {
          console.error('Error flushing thinking update:', flushErr);
        }
      }
    }
    
    console.log(`Stream completed with ${chunkCount} total chunks`);
    
    // Calculate token usage
    const systemPromptTokens = Math.floor(systemPrompt.length / 3);
    const contentTokens = Math.floor(content.length / 4);
    const inputTokens = systemPromptTokens + contentTokens;
    const outputTokens = Math.floor(htmlOutput.length / 4);
    
    console.log(`Calculated usage - inputTokens: ${inputTokens}, outputTokens: ${outputTokens}`);
    
    // Send completion message - EXACTLY as expected by app.js
    res.write('event: message\n');
    res.write(`data: {"type":"message_complete","message_id":"${messageId}","usage":{"input_tokens":${inputTokens},"output_tokens":${outputTokens},"thinking_tokens":${thinkingBudget}},"html":"${escape(htmlOutput)}"}\n\n`);
    
    try {
      if (res.flush) {
        res.flush();
        console.log('Flushed completion message');
      }
    } catch (flushErr) {
      console.error('Error flushing completion message:', flushErr);
    }
    
    // Send end event - EXACTLY as expected by app.js
    res.write('event: message\n');
    res.write('data: {"type":"end","message":"HTML generation complete"}\n\n');
    
    try {
      if (res.flush) {
        res.flush();
        console.log('Flushed end message');
      }
    } catch (flushErr) {
      console.error('Error flushing end message:', flushErr);
    }
    
    console.log('Stream response complete, ending response');
    res.end();
  } catch (error) {
    console.error('Error in process-stream:', error);
    console.error('Error stack:', error.stack);
    
    // Send error message
    try {
      res.write('event: message\n');
      res.write(`data: {"type":"error","error":"${escape(error.message)}"}\n\n`);
      res.end();
    } catch (responseError) {
      console.error('Error sending error response:', responseError);
      // Try to send a basic error response
      res.status(500).json({ error: 'Error processing stream' });
    }
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