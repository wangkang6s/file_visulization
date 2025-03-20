/**
 * Special handler for Anthropic 529 "Overloaded" errors
 * This script patches all EventSource instances to properly handle 529 errors
 */

(function() {
    // Store the original EventSource constructor
    const OriginalEventSource = window.EventSource;
    
    // Replace with our custom constructor that adds 529 error handling
    window.EventSource = function(url, options) {
        // Create the original EventSource instance
        const eventSource = new OriginalEventSource(url, options);
        
        // Add special handler for status events
        eventSource.addEventListener('status', function(e) {
            try {
                const data = JSON.parse(e.data);
                console.log('Status event received:', data);
                
                // If this is a retry for overloaded API, update UI
                if (data.message && data.message.includes('overloaded')) {
                    const processingStatus = document.getElementById('processing-status');
                    if (processingStatus) {
                        // Show retry message with specific retry count
                        const retryCount = data.retry || 0;
                        const maxRetries = data.max_retries || 8;
                        const progressPercent = Math.min(100, Math.round((retryCount / maxRetries) * 100));
                        
                        // Remove any previous retry messages to avoid duplication
                        const retryMessages = processingStatus.querySelectorAll('.retry-message');
                        retryMessages.forEach(msg => msg.remove());
                        
                        // Add new status message
                        processingStatus.innerHTML += `
                            <div class="mt-2 bg-blue-50 text-blue-800 p-3 rounded-md flex items-center retry-message">
                                <div class="mr-3">
                                    <i class="fas fa-sync-alt fa-spin"></i>
                                </div>
                                <div class="flex-1">
                                    <div class="font-medium">${data.message}</div>
                                    <div class="mt-1 w-full bg-blue-200 rounded-full h-2">
                                        <div class="bg-blue-600 h-2 rounded-full" style="width: ${progressPercent}%"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        // Update last activity time to prevent client reconnection attempts
                        window.lastStreamTime = Date.now();
                    }
                }
            } catch (err) {
                console.error('Error processing status event:', err);
            }
        });
        
        // Add special handler for error events
        eventSource.addEventListener('error', function(e) {
            console.error('EventSource error:', e);
            
            // Try to detect 529 errors from the server
            if (e.data) {
                try {
                    const data = JSON.parse(e.data);
                    
                    // Handle 529 overloaded errors
                    if (data.code === 529) {
                        const processingStatus = document.getElementById('processing-status');
                        if (processingStatus) {
                            // Remove any previous retry messages
                            const retryMessages = processingStatus.querySelectorAll('.retry-message');
                            retryMessages.forEach(msg => msg.remove());
                            
                            // Add error message with retry button
                            processingStatus.innerHTML += `
                                <div class="bg-blue-100 text-blue-800 p-4 rounded-md mt-4">
                                    <strong>AI Service Overloaded</strong>
                                    <p class="mt-2">The AI service is currently experiencing high demand. Please try again later.</p>
                                    <button id="retry-button" class="mt-3 bg-blue-600 text-white px-4 py-2 rounded-md">
                                        Try Again
                                    </button>
                                </div>
                            `;
                            
                            // Add retry button event handler
                            document.getElementById('retry-button')?.addEventListener('click', function() {
                                // For overload errors, we should wait a bit longer before retrying
                                setTimeout(() => {
                                    window.reconnectAttempts = 0;
                                    window.currentSessionId = null;
                                    window.lastChunkId = null;
                                    
                                    // Clear status area and regenerate
                                    processingStatus.innerHTML = '';
                                    document.getElementById('generate-btn').click();
                                }, 3000);
                            });
                        }
                    }
                } catch (err) {
                    console.error('Error parsing error data:', err);
                }
            }
        });
        
        return eventSource;
    };
    
    // Copy all properties from the original EventSource constructor
    for (const prop in OriginalEventSource) {
        if (OriginalEventSource.hasOwnProperty(prop)) {
            window.EventSource[prop] = OriginalEventSource[prop];
        }
    }
    
    // Copy the prototype
    window.EventSource.prototype = OriginalEventSource.prototype;
    
    console.log('529 Error Handler enabled - All EventSource instances now handle Anthropic overload errors');
})(); 