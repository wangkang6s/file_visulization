// Process stream function for Vercel Edge Runtime using Anthropic API directly
export const config = {
  runtime: 'edge',
  regions: ['iad1'], // Force specific US region for more consistent performance
};

// Delayed content completion function to ensure we send usage statistics
const sendContentComplete = async (res, html, usage, stopTime) => {
  try {
    // Calculate time elapsed
    const timeElapsed = stopTime ? (stopTime - startTime) / 1000 : undefined;
    
    // Create usage object with all token information
    const usageData = {
      ...usage,
      time_elapsed: timeElapsed
    };
    
    console.log('Sending content_complete event with usage stats:', JSON.stringify(usageData));
    console.log(`Generated content length: ${html.length} characters`);
    
    // Send the content complete event with both content and usage stats
    res.write(`data: ${JSON.stringify({
      type: 'content_complete',
      content: html,
      usage: usageData
    })}\n\n`);
    
    // Small delay before sending message_complete to ensure the client processes the content_complete
    setTimeout(() => {
      // Send the final message
      res.write(`data: ${JSON.stringify({
        type: 'message_complete',
        message: 'Generation complete',
        usage: usageData
      })}\n\n`);
      
      // End the response stream
      res.end();
    }, 500); // 500ms delay
  } catch (error) {
    console.error('Error in sendContentComplete:', error);
    
    // Try to send error and end response
    try {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message,
        content: html // Still send the HTML as fallback
      })}\n\n`);
      res.end();
    } catch (e) {
      console.error('Failed to send error:', e);
    }
  }
};

// Process the file/text content and generate HTML using Claude
export default async function handler(req, res) {
  // Record start time for performance tracking
  startTime = Date.now();
  
  // Setup CORS headers for Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Only allow POST method
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed, please use POST' });
    return;
  }
  
  // Setup response for server-sent events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Start keepalive mechanism
  let keepaliveInterval;
  
  try {
    // Send initial keepalive
    res.write(`data: ${JSON.stringify({ type: 'keepalive' })}\n\n`);
    
    // Setup interval for keepalive messages
    keepaliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'keepalive' })}\n\n`);
      } else {
        clearInterval(keepaliveInterval);
      }
    }, 500);
    
    // Parse request body
    const body = req.body;
    
    // Log the request body structure for debugging
    console.log('Request body structure:', JSON.stringify(Object.keys(body)));
    
    // Validate required fields
    if (!body || !body.api_key) {
      throw new Error('Missing required fields: api_key');
    }
    
    // Check if this is test mode
    const testMode = body.test_mode === true;
    
    // Get the API key
    const apiKey = body.api_key;
    
    // Prepare user content
    let content = body.content || '';
    
    // Handle parameters
    const temperature = parseFloat(body.temperature || '1.0');
    const maxTokens = parseInt(body.max_tokens || '128000', 10);
    const thinkingBudget = parseInt(body.thinking_budget || '32000', 10);
    const formatPrompt = body.format_prompt || '';
    
    console.log(`Processing content with maxTokens=${maxTokens}, temperature=${temperature}, thinking_budget=${thinkingBudget}`);
    
    // Create a shorter sample of the content for logging
    const contentPreview = content.substring(0, Math.min(content.length, 100)) + '...';
    console.log(`Content sample: ${contentPreview}`);
    
    // If test mode enabled, just return a simple page immediately
    if (testMode) {
      console.log('Test mode enabled, generating simple test HTML');
      
      // Create a simple HTML page
      const testHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Visualization</title>
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
      pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
      .sample { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>Test Mode Visualization</h1>
    <p>This is a simplified test page generated without calling the Claude API.</p>
    
    <h2>Your Content Sample:</h2>
    <div class="sample">
      <pre>${escapeHtml(content.substring(0, 500))}${content.length > 500 ? '...\n(content truncated)' : ''}</pre>
    </div>
    
    <h2>Settings:</h2>
    <ul>
      <li>Temperature: ${temperature}</li>
      <li>Max Tokens: ${maxTokens}</li>
      <li>Thinking Budget: ${thinkingBudget}</li>
      ${formatPrompt ? `<li>Additional Instructions: ${escapeHtml(formatPrompt)}</li>` : ''}
    </ul>
    
    <p>Use the regular mode to generate a full visualization with Claude.</p>
</body>
</html>`;
      
      // Create sample usage info for the client
      const testUsage = {
        input_tokens: Math.ceil(content.length / 4),
        output_tokens: 350,
        thinking_tokens: 0,
        total_cost: ((Math.ceil(content.length / 4) / 1000000) * 3) + ((350 / 1000000) * 15),
        time_elapsed: 0.5
      };
      
      // Send HTML and usage information
      await sendContentComplete(res, testHtml, testUsage, Date.now());
      return;
    }
    
    // Prepare the system prompt
    const systemPrompt = `You are an expert web developer specializing in creating beautiful, functional HTML documents from content.

Your task is to create a visually appealing webpage based on the content provided. The HTML page should:

1. Present the core information in the most visually appealing way possible
2. Be a complete, self-contained HTML file with embedded CSS and any necessary JavaScript
3. Follow these requirements:

DESIGN STYLE:
- Use modern, clean design principles with appropriate typography
- Create a visually appealing layout that enhances readability and user experience
- Include appropriate visual hierarchy, spacing, and design elements
- Choose a color scheme that fits the content's purpose and tone
- Use elegant animations and transitions where appropriate

TECHNICAL SPECIFICATIONS:
- Create semantic HTML5 that is valid and well-structured
- Embed all CSS within a <style> tag in the document head
- Only use vanilla JavaScript (no external libraries or frameworks)
- Include all necessary meta tags for proper display and SEO
- Make the page highly accessible following WCAG guidelines

RESPONSIVE DESIGN:
- Ensure the page works perfectly across all device sizes
- Use responsive design principles with appropriate breakpoints
- Implement a mobile-first approach where appropriate
- Test layouts for desktop, tablet, and mobile views

USER INTERACTION:
- Add appropriate interactive elements to enhance content engagement
- Include a table of contents for longer documents with smooth scrolling
- Implement dark/light mode toggle if appropriate for the content
- Create navigation UI for structured content

PERFORMANCE OPTIMIZATION:
- Optimize all code for fast loading and performance
- Minify CSS if including substantial styling
- Ensure JavaScript is efficient and non-blocking
- Consider lazy-loading for any heavy content sections

OUTPUT REQUIREMENTS:
- Deliver a complete HTML document that renders beautifully in modern browsers
- Include <!DOCTYPE html> and all required HTML structure
- Embed all CSS and JavaScript directly in the document
- Do NOT include lengthy comments explaining your code choices
- Do NOT use external resources like CDNs, images, or libraries

Remember, your goal is to transform the content into the most beautiful, functional webpage possible while keeping everything self-contained in a single HTML file.`;

    // Get a smaller sample of content for the prompt
    const contentSample = content.substring(0, Math.min(content.length, 20000));
    
    // Determine the model to use based on test mode
    const model = testMode ? 'claude-3-haiku-20240307' : 'claude-3-7-sonnet-20250219';
    
    // Prepare the API request to Anthropic
    console.log(`Making request to Anthropic API with model: ${model}`);
    
    const apiRequestBody = {
      model: model,
      max_tokens: maxTokens,
      temperature: temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Please create a beautiful HTML page for the following content:
${formatPrompt ? "\nAdditional instructions: " + formatPrompt + "\n" : ""}
${content}`
        }
      ]
    };
    
    // Log the API request for debugging
    console.log('API Request:', JSON.stringify(apiRequestBody, null, 2));
    
    // Make the API request to Anthropic
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(apiRequestBody)
    });
    
    // Check if the API response is successful
    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`API error: ${apiResponse.status}`, errorText);
      
      // Generate a fallback HTML with the error
      const fallbackHtml = generateFallbackHtml(content, formatPrompt, `API Error: ${apiResponse.status}`, errorText);
      
      // Create minimal usage stats for the fallback
      const fallbackUsage = {
        input_tokens: Math.ceil(content.length / 4),
        output_tokens: 500,
        thinking_tokens: 0,
        total_cost: ((Math.ceil(content.length / 4) / 1000000) * 3) + ((500 / 1000000) * 15)
      };
      
      // Send the fallback HTML with error
      await sendContentComplete(res, fallbackHtml, fallbackUsage, Date.now());
      return;
    }
    
    // Process the successful API response
    const responseData = await apiResponse.json();
    
    // Extract the HTML content
    let generatedHtml = '';
    let htmlStarted = false;
    
    // Extract the text content from the response
    const responseText = responseData.content[0].text;
    
    // Look for content within HTML tags or code blocks
    const htmlBlockRegex = /```(?:html)?\s*([^`]+)```/g;
    const htmlMatches = Array.from(responseText.matchAll(htmlBlockRegex));
    
    if (htmlMatches && htmlMatches.length > 0) {
      // Use the first HTML code block found
      generatedHtml = htmlMatches[0][1].trim();
    } else {
      // Try to extract content between <html> and </html>
      const htmlTagRegex = /<html[^>]*>([\s\S]*)<\/html>/i;
      const htmlTagMatch = responseText.match(htmlTagRegex);
      
      if (htmlTagMatch && htmlTagMatch.length > 1) {
        generatedHtml = `<html${htmlTagMatch[0].substring(5, htmlTagMatch.index + 1)}${htmlTagMatch[1]}</html>`;
      } else {
        // If no HTML tags found, check if the response looks like HTML 
        if (responseText.trim().startsWith('<!DOCTYPE html>') || responseText.trim().startsWith('<html')) {
          generatedHtml = responseText.trim();
        } else {
          // Wrap plain text in basic HTML if no HTML content is found
          generatedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated Content</title>
    <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
        pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>Generated Content</h1>
    <pre>${escapeHtml(responseText)}</pre>
</body>
</html>`;
        }
      }
    }
    
    // Make sure the HTML includes doctype if not present
    if (!generatedHtml.includes('<!DOCTYPE')) {
      generatedHtml = `<!DOCTYPE html>\n${generatedHtml}`;
    }
    
    // Calculate token usage
    const inputTokens = Math.ceil(content.length / 4); // Rough estimation
    const outputTokens = responseData.usage?.output_tokens || Math.ceil(generatedHtml.length / 4);
    
    // No thinking tokens in the usage stats
    const usageStats = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_cost: ((inputTokens / 1000000) * 3) + ((outputTokens / 1000000) * 15)
    };
    
    // Send the completed HTML with usage stats
    await sendContentComplete(res, generatedHtml, usageStats, Date.now());
    
  } catch (error) {
    console.error('Error:', error);
    
    // Generate a fallback HTML with the error
    const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
        .error { background: #fff0f0; border-left: 4px solid #ff5252; padding: 15px; margin: 20px 0; }
        .content-preview { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; max-height: 300px; overflow-y: auto; }
        h1 { color: #ff5252; }
    </style>
</head>
<body>
    <h1>Error Generating Visualization</h1>
    <div class="error">
        <p><strong>Error message:</strong> ${escapeHtml(error.message || 'Unknown error occurred')}</p>
    </div>
    <h2>Content Preview</h2>
    <div class="content-preview">
        <pre>${escapeHtml(req.body?.content?.substring(0, 500) || 'No content provided')}${req.body?.content?.length > 500 ? '...\n(content truncated)' : ''}</pre>
    </div>
    <p>Please try again with different content or settings.</p>
</body>
</html>`;
    
    // Simple usage stats for error case
    const errorUsage = {
      input_tokens: Math.ceil((req.body?.content?.length || 0) / 4),
      output_tokens: 350,
      total_cost: 0
    };
    
    try {
      // Attempt to send error and fallback HTML
      await sendContentComplete(res, fallbackHtml, errorUsage, Date.now());
    } catch (e) {
      console.error('Error sending fallback HTML:', e);
      
      // Last resort - try to end the response
      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch (finalError) {
        console.error('Failed to end response:', finalError);
      }
    }
  } finally {
    // Clean up the keepalive interval
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
    }
  }
}

// Helper to escape HTML
function escape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
} 