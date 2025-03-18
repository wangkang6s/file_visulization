// Test generate function for Vercel that doesn't use Anthropic API
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
    
    console.log(`Got request with content length: ${content.length}`);
    
    // Add a small delay to simulate processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create a simple mock HTML
    const mockHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test HTML Generator (Vercel)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
    <div class="container mx-auto px-4 py-8">
        <header class="mb-8">
            <h1 class="text-3xl font-bold mb-2">Test HTML Generation (Vercel)</h1>
            <p class="text-gray-600 dark:text-gray-400">This is a test HTML template that doesn't use Anthropic API tokens.</p>
            
            <!-- Dark/Light Mode Toggle -->
            <button id="theme-toggle" class="mt-4 p-2 bg-primary-600 text-white rounded">
                <i class="fas fa-moon dark:hidden"></i>
                <i class="fas fa-sun hidden dark:inline"></i>
                <span class="ml-2">Toggle Theme</span>
            </button>
        </header>
        
        <main>
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 animate-fade-in">
                <h2 class="text-2xl font-bold mb-4">Your Content</h2>
                <div class="prose dark:prose-invert max-w-none">
                    <pre class="bg-gray-100 dark:bg-gray-700 p-4 rounded overflow-auto">${content.substring(0, 1000)}... (truncated)</pre>
                </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 animate-fade-in">
                    <h3 class="text-xl font-bold mb-3"><i class="fas fa-info-circle text-primary-500 mr-2"></i>Test Info</h3>
                    <p>This is a test template to save Anthropic API tokens during development on Vercel.</p>
                </div>
                
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 animate-fade-in">
                    <h3 class="text-xl font-bold mb-3"><i class="fas fa-chart-line text-primary-500 mr-2"></i>Mock Statistics</h3>
                    <ul class="space-y-2">
                        <li>Content Length: ${content.length} characters</li>
                        <li>Estimated Tokens: ${Math.floor(content.length / 4)}</li>
                    </ul>
                </div>
            </div>
        </main>
        
        <footer class="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 text-center text-gray-600 dark:text-gray-400">
            <p>File Visualizer Test Mode (Vercel)</p>
        </footer>
    </div>
    
    <script>
        // Simple theme toggle
        document.getElementById('theme-toggle').addEventListener('click', function() {
            document.documentElement.classList.toggle('dark');
        });
        
        // Check for system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
    </script>
</body>
</html>`;
    
    // Calculate mock token usage statistics
    const systemPromptTokens = 1000; // Mock value
    const contentTokens = Math.floor(content.length / 4);
    const outputTokens = Math.floor(mockHtml.length / 4);
    const thinkingTokens = 1000; // Mock value
    
    // Return JSON response with HTML and usage stats
    return res.status(200).json({
      success: true,
      html: mockHtml,
      usage: {
        input_tokens: systemPromptTokens + contentTokens,
        output_tokens: outputTokens,
        thinking_tokens: thinkingTokens,
        time_elapsed: 1.5, // Mock elapsed time
        total_cost: ((systemPromptTokens + contentTokens + outputTokens) / 1000000 * 3.0)
      },
      test_mode: true
    });
    
  } catch (error) {
    console.error('Error in test generation:', error);
    return res.status(500).json({
      success: false,
      error: `Error in test generation: ${error.message}`
    });
  }
}; 