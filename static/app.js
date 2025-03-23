console.log("APP.JS LOADED", new Date().toISOString());

// DOM Elements
const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

// API configuration - Make sure this is set correctly
const API_URL = window.location.origin;
console.log("API_URL set to:", API_URL);
const API_KEY_STORAGE_KEY = 'claude_visualizer_api_key';

// Constants for stream handling
const MAX_RECONNECT_ATTEMPTS = 10; // Increased from default
const RECONNECT_DELAY = 1000; // 1 second
const MAX_SEGMENT_SIZE = 16384; // 16KB to match server setting
const MAX_HTML_BUFFER_SIZE = 2 * 1024 * 1024; // 2MB before using incremental rendering

// Global variables
let generatedHtml = ''; // Store the generated HTML
let reconnectAttempts = 0;
let currentSessionId = null;
let lastChunkId = null;
let chunkCount = 0;

// Elements
const elements = {
    // Theme
    themeToggle: $('#theme-toggle'),
    
    // API Key
    apiKeyInput: $('#api-key'),
    validateKeyBtn: $('#validate-key'),
    keyStatus: $('#key-status'),
    
    // Input Tabs
    fileTab: $('#file-tab'),
    textTab: $('#text-tab'),
    fileInput: $('#file-input'),
    textInput: $('#text-input'),
    
    // File Upload
    dropArea: $('#drop-area'),
    fileUpload: $('#file-upload'),
    fileInfo: $('#file-info'),
    inputText: $('#input-text'),
    
    // Additional Prompt
    additionalPrompt: $('#additional-prompt'),
    
    // Model Parameters
    temperature: $('#temperature'),
    temperatureValue: $('#temperature-value'),
    temperatureReset: $('#reset-temp'),
    maxTokens: $('#max-tokens'),
    maxTokensValue: $('#max-tokens-value'),
    maxTokensReset: $('#reset-max-tokens'),
    thinkingBudget: $('#thinking-budget'),
    thinkingBudgetValue: $('#thinking-budget-value'),
    thinkingBudgetReset: $('#reset-thinking-budget'),
    
    // Test Mode
    testModeToggle: $('#test-mode'),
    testModeIndicator: $('#test-mode-indicator'),
    
    // Generate
    generateBtn: $('#generate-btn'),
    generateError: $('#generate-error'),
    
    // Processing
    processingStatus: $('#processing-status'),
    processingText: $('#processing-text'),
    processingIcon: $('#processing-icon'),
    elapsedTime: $('#elapsed-time'),
    progressBar: $('#progress-bar'),
    
    // Results
    resultSection: $('#result-section'),
    inputTokens: $('#input-tokens'),
    outputTokens: $('#output-tokens'),
    totalCost: $('#total-cost'),
    
    // Output
    previewIframe: $('#preview-iframe'),
    htmlOutput: $('#html-output'),
    copyHtml: $('#copy-html'),
    downloadHtml: $('#download-html'),
    openPreview: $('#open-preview'),
    
    // Token Info
    tokenInfo: $('#tokenInfo'),
    thinkingOutput: $('#thinking-output'),
    statusMessage: $('#status-message'),
};

// State
let state = {
    activeTab: 'file',
    apiKey: localStorage.getItem(API_KEY_STORAGE_KEY) || '',
    apiKeyValidated: false,
    file: null,
    fileContent: '',
    textContent: '',
    temperature: 1.0,
    maxTokens: 128000,
    thinkingBudget: 32000,
    processing: false,
    generatedHtml: '',
    fileName: '',
    startTime: null,
    elapsedTimeInterval: null,
    testMode: false
};

// Function to update processing text
function setProcessingText(text) {
    // Only update the in-page processing text
    if (elements.processingText) {
        elements.processingText.textContent = text;
    }
}

// Initialize the app
function init() {
    console.log("Initializing app...");
    
    // Always use light theme
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
    
    // Reset usage statistics to clear any previously stored values
    resetUsageStatistics();
    
    // Reset token stats display
    resetTokenStats();
    
    // Load saved API key if available
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey && elements.apiKeyInput) {
        elements.apiKeyInput.value = savedApiKey;
        state.apiKey = savedApiKey; // Make sure we update the state
        validateApiKey(); // Automatically validate the saved key
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup drag and drop
    setupDragAndDrop();
    
    // Initialize state
    if (elements.fileTab) elements.fileTab.click(); // Default to file tab
    
    // Load and display usage statistics
    loadUsageStatistics();
    
    // Ensure the generate button state is correct
    setTimeout(updateGenerateButtonState, 200);
    
    // Force enable the generate button for testing
    setTimeout(() => {
        console.log('Forcefully ensuring generate button is enabled');
        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
            // Force visual style regardless of conditions
            generateBtn.disabled = false;
            generateBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            generateBtn.classList.add('bg-primary-500', 'hover:bg-primary-600', 'text-white', 'cursor-pointer');
            generateBtn.style.pointerEvents = 'auto';
            
            // Make sure event handler is attached
            if (!generateBtn._hasDirectHandler) {
                generateBtn.onclick = function(e) {
                    console.log('Generate button clicked via direct handler!');
                    e.preventDefault();
                    
                    if (typeof generateWebsite === 'function') {
                        generateWebsite();
                    } else {
                        console.error('generateWebsite function not found!');
                        alert('Error: Generation function not found. Please check the console.');
                    }
                    return false;
                };
                generateBtn._hasDirectHandler = true;
            }
        } else {
            console.error('Generate button not found in setTimeout!');
        }
    }, 500);
    
    // Force enable all buttons as a fallback
    setTimeout(() => {
        document.querySelectorAll('button').forEach(button => {
            button.style.pointerEvents = 'auto';
            button.disabled = false;
        });
        console.log("All buttons forcefully enabled as fallback");
    }, 1000);
    
    console.log("App initialized");
}

// Format cost to display either a dollar amount or dash if zero
function formatCostDisplay(cost) {
    if (!cost || cost === 0 || isNaN(cost)) {
        return '-';
    }
    return `$${cost.toFixed(4)}`;
}

// Update all cost display logic to use this helper
function loadUsageStatistics() {
    try {
        // Get stats from localStorage
        const stats = JSON.parse(localStorage.getItem('fileVisualizerStats') || '{"totalRuns":0,"totalTokens":0,"totalCost":0}');
        
        // Update the stats display
        if (document.getElementById('total-runs')) {
            document.getElementById('total-runs').textContent = stats.totalRuns.toLocaleString();
        }
        
        if (document.getElementById('total-tokens')) {
            document.getElementById('total-tokens').textContent = stats.totalTokens.toLocaleString();
        }
        
        if (document.getElementById('total-cost')) {
            document.getElementById('total-cost').textContent = formatCostDisplay(stats.totalCost);
        }
        
        return stats;
    } catch (e) {
        console.error('Error loading usage statistics:', e);
        return { totalRuns: 0, totalTokens: 0, totalCost: 0 };
    }
}

// Add a function to reset statistics (can be called for testing)
function resetUsageStatistics() {
    try {
        localStorage.setItem('fileVisualizerStats', JSON.stringify({
            totalRuns: 0,
            totalTokens: 0,
            totalCost: 0
        }));
        loadUsageStatistics(); // Reload the stats display
        console.log('Usage statistics have been reset');
    } catch (e) {
        console.error('Error resetting usage statistics:', e);
    }
}

// Event listeners
function setupEventListeners() {
    // Theme toggle - enforce light theme
    if (elements.themeToggle) {
        elements.themeToggle.addEventListener('click', function() {
            // Always use light theme
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            
            toggleTheme();
        });
    }
    
    // API Key validation
    if (elements.validateKeyBtn) {
        elements.validateKeyBtn.addEventListener('click', validateApiKey);
    }
    
    // Load saved API key
    if (elements.apiKeyInput) {
        // Try to load from localStorage
        const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (savedKey) {
            elements.apiKeyInput.value = savedKey;
            // Validate the key on page load
            setTimeout(validateApiKey, 1000); // Delay to allow the page to load
        }
        
        elements.apiKeyInput.addEventListener('input', handleApiKeyInput);
    }
    
    // Tab switching
    if (elements.fileTab) {
        elements.fileTab.addEventListener('click', function() {
            switchTab('file');
        });
    }
    
    if (elements.textTab) {
        elements.textTab.addEventListener('click', function() {
            switchTab('text');
        });
    }
    
    // File upload
    if (elements.fileUpload) {
        elements.fileUpload.addEventListener('change', handleFileUpload);
    }
    
    // Text input
    if (elements.inputText) {
        elements.inputText.addEventListener('input', handleTextInput);
    }
    
    // Range inputs
    if (elements.temperature) {
        elements.temperature.addEventListener('input', updateTemperature);
    }
    
    if (document.getElementById('reset-temp')) {
        document.getElementById('reset-temp').addEventListener('click', resetTemperature);
    }
    
    if (elements.maxTokens) {
        elements.maxTokens.addEventListener('input', updateMaxTokens);
    }
    
    if (document.getElementById('reset-max-tokens')) {
        document.getElementById('reset-max-tokens').addEventListener('click', resetMaxTokens);
    }
    
    if (elements.thinkingBudget) {
        elements.thinkingBudget.addEventListener('input', updateThinkingBudget);
    }
    
    if (document.getElementById('reset-thinking-budget')) {
        document.getElementById('reset-thinking-budget').addEventListener('click', resetThinkingBudget);
    }
    
    // Generate
    if (elements.generateBtn) {
        elements.generateBtn.addEventListener('click', startGeneration);
    }
    
    // Output actions
    if (elements.copyHtml) {
        elements.copyHtml.addEventListener('click', copyHtmlToClipboard);
    }
    if (elements.downloadHtml) {
        elements.downloadHtml.addEventListener('click', downloadHtmlFile);
    }
    if (elements.openPreview) {
        elements.openPreview.addEventListener('click', openPreviewInNewTab);
    }
    
    // Check for iOS Safari for special mobile handling
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
        document.body.classList.add('ios-device');
    }
    
    // Test mode toggle
    if (elements.testModeToggle) {
        elements.testModeToggle.addEventListener('change', toggleTestMode);
        
        // Initialize from localStorage
        const savedTestMode = localStorage.getItem('test_mode') === 'true';
        if (savedTestMode) {
            elements.testModeToggle.checked = true;
            state.testMode = true;
            showTestModeIndicator();
        }
    }
}

// Toggle theme between light and dark
function toggleTheme() {
    console.log('Toggling theme');
    const html = document.documentElement;
    const sunIcon = document.querySelector('.fa-sun');
    const moonIcon = document.querySelector('.fa-moon');
    
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
        localStorage.setItem('theme', 'dark');
    }
}

// API Key Handling
async function validateApiKey() {
    console.log('Validating API key...');
    const apiKey = elements.apiKeyInput.value.trim();
    
    if (!apiKey) {
        showNotification('Please enter an API key', 'error');
        return null;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/validate-key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ api_key: apiKey })
        });
        
        // Get response text once
        let responseData;
        try {
            responseData = await response.text();
            
            // Try to parse as JSON
            let data;
            try {
                data = JSON.parse(responseData);
            } catch (parseError) {
                console.error('Failed to parse response as JSON:', parseError);
                console.error('Raw response:', responseData);
                
                // Create a minimal response object for consistent handling
                data = { 
                    valid: false, 
                    message: `Server returned invalid JSON. Status: ${response.status}. Please try again or contact support.` 
                };
            }
            
            if (response.ok && data.valid) {
                console.log('API key is valid');
                // Save the API key
                localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
                state.apiKey = apiKey;
                showNotification(data.message || 'API key is valid', 'success');
                updateKeyStatus('valid');
                return apiKey;
            } else {
                console.error('API key validation failed:', data.message || 'Unknown error');
                showNotification(data.message || 'Invalid API key', 'error');
                updateKeyStatus('invalid');
                return null;
            }
        } catch (readError) {
            throw new Error(`Failed to read response: ${readError.message}`);
        }
    } catch (error) {
        console.error('Error validating API key:', error);
        showNotification('Error validating API key: ' + error.message, 'error');
        updateKeyStatus('invalid');
        return null;
    }
}

function updateKeyStatus(status) {
    if (!elements.keyStatus) return;
    
    elements.keyStatus.classList.remove('hidden');
    elements.keyStatus.innerHTML = status === 'valid' 
        ? '<span class="text-green-500">✓ Valid API Key</span>'
        : '<span class="text-red-500">✗ Invalid API Key</span>';
}

function handleApiKeyInput(e) {
    const apiKey = e.target.value.trim();
    state.apiKey = apiKey;
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    updateGenerateButtonState();
}

// Tab Switching
function switchTab(tab) {
    console.log('Switching to tab:', tab);
    
    // If switching tabs and there's content, confirm with the user
    if (tab === 'file' && state.textContent && state.activeTab === 'text') {
        if (!confirm('Switching tabs will clear your text input. Continue?')) {
            return;  // User cancelled the tab switch
        }
    } else if (tab === 'text' && state.fileContent && state.activeTab === 'file') {
        if (!confirm('Switching tabs will clear your file upload. Continue?')) {
            return;  // User cancelled the tab switch
        }
    }
    
    state.activeTab = tab;
    
    // Check for required tab elements using the correct element references
    if (!elements.fileTab || !elements.textTab || !elements.fileInput || !elements.textInput) {
        console.error('Tab elements not found');
        return;
    }
    
    if (tab === 'file') {
        elements.fileTab.classList.remove('bg-gray-100', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
        elements.fileTab.classList.add('bg-primary-100', 'dark:bg-primary-900', 'text-primary-700', 'dark:text-primary-300');
        
        elements.textTab.classList.remove('bg-primary-100', 'dark:bg-primary-900', 'text-primary-700', 'dark:text-primary-300');
        elements.textTab.classList.add('bg-gray-100', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
        
        elements.fileInput.classList.remove('hidden');
        elements.textInput.classList.add('hidden');
        
        // Clear text input content when switching to file tab
        if (elements.inputText) {
            // Don't actually clear the UI element - just don't use it when generating
            state.textContent = '';
        }
    } else {
        elements.textTab.classList.remove('bg-gray-100', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
        elements.textTab.classList.add('bg-primary-100', 'dark:bg-primary-900', 'text-primary-700', 'dark:text-primary-300');
        
        elements.fileTab.classList.remove('bg-primary-100', 'dark:bg-primary-900', 'text-primary-700', 'dark:text-primary-300');
        elements.fileTab.classList.add('bg-gray-100', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
        
        elements.textInput.classList.remove('hidden');
        elements.fileInput.classList.add('hidden');
        
        // Clear file data when switching to text tab
        state.file = null;
        state.fileContent = '';
        state.fileName = '';
        
        // Also clear the file upload UI
        if (elements.fileInfo) {
            elements.fileInfo.classList.add('hidden');
        }
        
        if (elements.fileUpload) {
            elements.fileUpload.value = '';
        }
        
        // Trigger token analysis when switching to text tab if there's text
        if (elements.inputText && elements.inputText.value.trim()) {
            state.textContent = elements.inputText.value.trim();
            analyzeTokens(state.textContent);
        } else if (elements.tokenInfo) {
            // Clear token info if there's no text
            elements.tokenInfo.innerHTML = '';
        }
    }
    
    updateGenerateButtonState();
}

// File Upload
function setupDragAndDrop() {
    const dropArea = elements.dropArea;
    if (!dropArea) {
        console.error('Drop area element not found');
        return;
    }
    
    // Add click event to dropArea to trigger file upload dialog
    dropArea.addEventListener('click', function() {
        if (elements.fileUpload) {
            elements.fileUpload.click();
        }
    });
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener('drop', handleDrop, false);
    });
    
    function highlight() {
        dropArea.classList.add('border-primary-500', 'dark:border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/20');
    }
    
    function unhighlight() {
        dropArea.classList.remove('border-primary-500', 'dark:border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/20');
    }
    
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const file = dt.files[0];
        
        if (file) {
            handleFile(file);
        }
    }
}

function handleFileUpload(e) {
    console.log('Handling file upload...');
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

function handleFile(file) {
    console.log('Processing file:', file.name);
    state.file = file;
    state.fileName = file.name;
    
    if (!elements.fileInfo) {
        console.error('File info element not found');
        return;
    }
    
    // Show file info
    elements.fileInfo.innerHTML = `
        <div class="flex items-center p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
            <i class="fas fa-file-alt text-primary-500 mr-3 text-xl"></i>
            <div class="flex-1">
                <p class="font-medium">${file.name}</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">${formatFileSize(file.size)}</p>
            </div>
            <button class="text-red-500 hover:text-red-600 p-1" id="remove-file">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    elements.fileInfo.classList.remove('hidden');
    
    // Add event listener to remove button
    const removeButton = $('#remove-file');
    if (removeButton) {
        removeButton.addEventListener('click', removeFile);
    }
    
    // Get file extension
    const fileExt = file.name.split('.').pop().toLowerCase();
    
    // Handle different file types appropriately
    if (fileExt === 'pdf') {
        // For PDF files, we need special handling
        // Show a loading indicator while processing
        if (elements.tokenInfo) {
            elements.tokenInfo.innerHTML = `
                <div class="token-analysis loading">
                    <h3>Processing PDF</h3>
                    <p>Extracting text from PDF file...</p>
                </div>
            `;
        }
        
        // Read as array buffer for binary files
        const reader = new FileReader();
        reader.onload = function(e) {
            console.log('PDF file content loaded as array buffer');
            
            try {
                // Convert the array buffer to base64
                const uint8Array = new Uint8Array(e.target.result);
                let binary = '';
                for (let i = 0; i < uint8Array.length; i++) {
                    binary += String.fromCharCode(uint8Array[i]);
                }
                const base64String = btoa(binary);
                
                // Store the base64 string
                state.fileContent = base64String;
                
                // Send to server for analysis, including file type
                fetch('/api/analyze-tokens', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        content: base64String,
                        file_type: 'pdf'
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (elements.tokenInfo) {
                        if (data.error) {
                            elements.tokenInfo.innerHTML = `
                                <div class="token-analysis error">
                                    <h3>Error Processing PDF</h3>
                                    <p>${data.error}</p>
                                </div>
                            `;
                        } else {
                            elements.tokenInfo.innerHTML = `
                                <div class="token-analysis">
                                    <h3>Token Analysis</h3>
                                    <p>Estimated Input Tokens: ${data.estimated_tokens.toLocaleString()}</p>
                                    <p>Estimated Input Cost: $${data.estimated_cost.toFixed(4)}</p>
                                    <p>Maximum Safe Input Tokens: 200,000</p>
                                </div>
                            `;
                        }
                    }
                    updateGenerateButtonState();
                })
                .catch(err => {
                    console.error('Error analyzing PDF tokens:', err);
                    if (elements.tokenInfo) {
                        elements.tokenInfo.innerHTML = `
                            <div class="token-analysis error">
                                <h3>Error Processing PDF</h3>
                                <p>${err.message}</p>
                            </div>
                        `;
                    }
                    updateGenerateButtonState();
                });
            } catch (err) {
                console.error('Error encoding PDF as base64:', err);
                if (elements.tokenInfo) {
                    elements.tokenInfo.innerHTML = `
                        <div class="token-analysis error">
                            <h3>Error Processing PDF</h3>
                            <p>Could not encode PDF file: ${err.message}</p>
                        </div>
                    `;
                }
                updateGenerateButtonState();
            }
        };
        reader.onerror = function(err) {
            console.error('Error reading PDF file:', err);
            if (elements.tokenInfo) {
                elements.tokenInfo.innerHTML = `
                    <div class="token-analysis error">
                        <h3>Error Reading PDF</h3>
                        <p>Could not read PDF file: ${err.message || 'Unknown error'}</p>
                    </div>
                `;
            }
            updateGenerateButtonState();
        };
        reader.readAsArrayBuffer(file);
    } else if (fileExt === 'docx' || fileExt === 'doc') {
        // For Word documents, we also need to use base64 and special handling
        const reader = new FileReader();
        reader.onload = function(e) {
            console.log('Word document content loaded as array buffer');
            
            try {
                // Convert the array buffer to base64
                const uint8Array = new Uint8Array(e.target.result);
                let binary = '';
                for (let i = 0; i < uint8Array.length; i++) {
                    binary += String.fromCharCode(uint8Array[i]);
                }
                const base64String = btoa(binary);
                
                // Store the base64 string
                state.fileContent = base64String;
                
                // Request token analysis from server
                fetch('/api/analyze-tokens', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        content: base64String,
                        file_type: fileExt
                    })
                })
                .then(response => response.json())
                .then(data => {
                    updateTokenInfoUI(data);
                    updateGenerateButtonState();
                })
                .catch(err => {
                    console.error('Error analyzing Word document tokens:', err);
                    showTokenAnalysisError(err.message);
                    updateGenerateButtonState();
                });
            } catch (err) {
                console.error('Error encoding Word document as base64:', err);
                showTokenAnalysisError('Could not encode Word document: ' + err.message);
                updateGenerateButtonState();
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        // For text-based files (txt, json, etc.), read as text
        const reader = new FileReader();
        reader.onload = function(e) {
            console.log('Text file content loaded');
            state.fileContent = e.target.result;
            updateGenerateButtonState();
            analyzeTokens(state.fileContent);
        };
        reader.readAsText(file);
    }
}

function removeFile() {
    state.file = null;
    state.fileContent = '';
    state.fileName = '';
    
    if (elements.fileInfo) {
        elements.fileInfo.classList.add('hidden');
    }
    
    if (elements.fileUpload) {
        elements.fileUpload.value = '';
    }
    
    // Clear token analysis display
    if (elements.tokenInfo) {
        elements.tokenInfo.innerHTML = '';
    }
    
    updateGenerateButtonState();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Text Input
function handleTextInput(e) {
    console.log('Handling text input...');
    const newText = e.target.value.trim();
    state.textContent = newText;
    updateGenerateButtonState();
    
    // Always analyze tokens for text input when the content changes
    if (newText) {
        analyzeTokens(newText);
    } else if (elements.tokenInfo) {
        // Clear token info if text is empty
        elements.tokenInfo.innerHTML = '';
    }
}

// Parameter Controls
function updateTemperature() {
    state.temperature = parseFloat(elements.temperature.value);
    if (elements.temperatureValue) {
        elements.temperatureValue.textContent = state.temperature.toFixed(1);
    }
}

function resetTemperature() {
    state.temperature = 1.0;
    if (elements.temperature) {
        elements.temperature.value = 1.0;
    }
    if (elements.temperatureValue) {
        elements.temperatureValue.textContent = '1.0';
    }
}

function updateMaxTokens() {
    state.maxTokens = parseInt(elements.maxTokens.value);
    if (elements.maxTokensValue) {
        elements.maxTokensValue.textContent = state.maxTokens.toLocaleString();
    }
}

function resetMaxTokens() {
    state.maxTokens = 128000;
    if (elements.maxTokens) {
        elements.maxTokens.value = 128000;
    }
    if (elements.maxTokensValue) {
        elements.maxTokensValue.textContent = '128,000';
    }
}

function updateThinkingBudget() {
    state.thinkingBudget = parseInt(elements.thinkingBudget.value);
    if (elements.thinkingBudgetValue) {
        elements.thinkingBudgetValue.textContent = state.thinkingBudget.toLocaleString();
    }
}

function resetThinkingBudget() {
    state.thinkingBudget = 32000;
    if (elements.thinkingBudget) {
        elements.thinkingBudget.value = 32000;
    }
    if (elements.thinkingBudgetValue) {
        elements.thinkingBudgetValue.textContent = '32,000';
    }
}

// Generate Button State
function updateGenerateButtonState() {
    console.log('updateGenerateButtonState called');
    console.log('API Key:', state.apiKey ? 'Exists (length: ' + state.apiKey.length + ')' : 'Missing');
    console.log('File content:', state.fileContent ? 'Exists (length: ' + state.fileContent.length + ')' : 'Missing');
    console.log('Text content:', state.textContent ? 'Exists (length: ' + state.textContent.length + ')' : 'Missing');
    console.log('Active tab:', state.activeTab);
    
    // Make sure we have API key and content
    const hasApiKey = !!state.apiKey;
    const hasContent = (state.activeTab === 'file' && !!state.fileContent) || 
                       (state.activeTab === 'text' && !!state.textContent);
    
    console.log('Has API key:', hasApiKey, 'Has content:', hasContent);
    
    if (elements.generateBtn) {
        if (hasApiKey && hasContent) {
            console.log('Enabling generate button');
            elements.generateBtn.disabled = false;
            elements.generateBtn.classList.remove('bg-gray-300', 'dark:bg-gray-700', 'text-gray-500', 'dark:text-gray-400', 'cursor-not-allowed');
            elements.generateBtn.classList.add('bg-primary-500', 'hover:bg-primary-600', 'text-white', 'cursor-pointer');
            elements.generateBtn.style.pointerEvents = 'auto';
            if (elements.generateError) {
                elements.generateError.classList.add('hidden');
            }
            
            // Make sure the button has a click handler
            if (!elements.generateBtn._hasClickHandler) {
                console.log('Adding click handler to generate button');
                elements.generateBtn.addEventListener('click', function(e) {
                    console.log('Generate button clicked!');
                    e.preventDefault();
                    if (typeof generateWebsite === 'function') {
                        generateWebsite();
                    } else {
                        console.error('generateWebsite function not found!');
                    }
                });
                elements.generateBtn._hasClickHandler = true;
            }
        } else {
            console.log('Disabling generate button');
            elements.generateBtn.disabled = true;
            elements.generateBtn.classList.add('bg-gray-300', 'dark:bg-gray-700', 'text-gray-500', 'dark:text-gray-400', 'cursor-not-allowed');
        }
    } else {
        console.error('Generate button element not found!');
    }
}

// Generate Website
async function generateWebsite() {
    if (state.processing) {
        return;
    }
    
    // Debug info for file uploads
    if (state.activeTab === 'file' && state.file) {
        console.log('Generating with file:', state.fileName);
        console.log('File content stored (first 100 chars):', 
                    state.fileContent ? state.fileContent.substring(0, 100) + '...' : 'No content stored');
        console.log('File size:', state.file ? formatFileSize(state.file.size) : 'Unknown');
    }
    
    try {
        state.processing = true;
        
        // Clear any previous generation
        state.generatedHtml = '';
        updateHtmlDisplay();
        updatePreview();
        
        // Show the processing animation
        startProcessingAnimation();
        
        // Start timing the generation
        startElapsedTimeCounter();
        
        // Get the source content (text or file content)
        let content = '';
        if (state.activeTab === 'text') {
            // Use the correct element reference (inputText instead of textInput)
            // and also check state.textContent as a fallback
            content = elements.inputText ? elements.inputText.value.trim() : (state.textContent || '');
        } else if (state.activeTab === 'file' && state.fileContent) {
            content = state.fileContent;
        }
        
        if (!content) {
            throw new Error('Please enter some text or upload a file first');
        }
        
        // Get other parameters
        const formatPrompt = elements.additionalPrompt ? elements.additionalPrompt.value.trim() : '';
        const maxTokens = parseInt(elements.maxTokens ? elements.maxTokens.value : 128000, 10);
        const temperature = parseFloat(elements.temperature ? elements.temperature.value : 1.0);
        const apiKey = elements.apiKeyInput ? elements.apiKeyInput.value.trim() : state.apiKey;
        const thinkingBudget = parseInt(elements.thinkingBudget ? elements.thinkingBudget.value : 32000, 10);
        
        if (!apiKey) {
            throw new Error('Please enter your API key');
        }
        
        // Update UI for generation start
        disableInputsDuringGeneration(true);
        state.isGenerating = true;
        showResultSection();
        
        // Clear previous content and start animation
        updateHtmlDisplay();
        elements.previewIframe.srcdoc = '';
        
        // Reset output stats
        resetTokenStats();
        
        // Start elapsed time counter
        startElapsedTimeCounter();
        
        // Show processing animation
        startProcessingAnimation();
        
        // Check if test mode is enabled
        if (state.testMode) {
            // Use test mode API endpoint
            const endpointUrl = window.location.hostname === 'localhost' ? 
                '/api/test-generate' : '/api/test-generate';
                
            // Call test endpoint
            try {
                const response = await fetch(endpointUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: apiKey,
                        content: content,
                        format_prompt: formatPrompt,
                        temperature: temperature,
                        max_tokens: maxTokens,
                        thinking_budget: thinkingBudget
                    })
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
                }
                
                const result = await response.json();
                
                // Check if the result indicates an error but includes HTML
                if (!result.success && result.html) {
                    console.log('Test generate returned an error with HTML:', result.error);
                    // Still use the HTML even though it's an error response
                    state.generatedHtml = result.html;
                    generatedHtml = result.html; // Update global variable too
                    
                    // Show the error message
                    if (result.code === 529) {
                        showToast('Anthropic API is currently overloaded. Please try again later.', 'error');
                    } else {
                        showToast(`Error: ${result.error}`, 'error');
                    }
                } else {
                    // Process the successful test result
                    state.generatedHtml = result.html;
                    generatedHtml = result.html; // Update global variable too
                }
                
                // Update UI with the results
                updateHtmlDisplay();
                updatePreview();
                
                // Update usage statistics
                if (result.usage) {
                    updateTokenStats(result.usage);
                    
                    // Update storage with new usage stats
                    try {
                        // Get existing stats
                        const existingStats = JSON.parse(localStorage.getItem('fileVisualizerStats') || '{"totalRuns":0,"totalTokens":0,"totalCost":0}');
                        
                        // Update stats
                        existingStats.totalRuns = (existingStats.totalRuns || 0) + 1;
                        existingStats.totalTokens = (existingStats.totalTokens || 0) + 
                            (result.usage.input_tokens + result.usage.output_tokens);
                        existingStats.totalCost = (existingStats.totalCost || 0) + result.usage.total_cost;
                        
                        // Save updated stats
                        localStorage.setItem('fileVisualizerStats', JSON.stringify(existingStats));
                        
                        // Update UI if stats container exists
                        if (document.getElementById('total-runs')) {
                            document.getElementById('total-runs').textContent = existingStats.totalRuns.toLocaleString();
                        }
                        if (document.getElementById('total-tokens')) {
                            document.getElementById('total-tokens').textContent = existingStats.totalTokens.toLocaleString();
                        }
                        if (document.getElementById('total-cost')) {
                            document.getElementById('total-cost').textContent = formatCostDisplay(existingStats.totalCost);
                        }
                    } catch (e) {
                        console.error('Error updating usage statistics:', e);
                    }
                }
                
                // Update UI for generation completion
                stopProcessingAnimation();
                resetGenerationUI(true);
                
                // Show elapsed time
                if (result.usage && result.usage.time_elapsed) {
                    displayElapsedTime(Math.floor(result.usage.time_elapsed));
                }
                
                showToast('Test visualization complete! (Test Mode)', 'success');
                
            } catch (error) {
                console.error('Test generation error:', error);
                showToast(`Error: ${error.message}`, 'error');
                resetGenerationUI();
            }
        } else {
            // Use regular generation with streaming
            await generateHTMLStreamWithReconnection(
                apiKey, content, formatPrompt, 
                'claude-3-7-sonnet-20240307', maxTokens, 
                temperature, thinkingBudget
            );
        }
    } catch (error) {
        console.error('Generation error:', error);
        showToast(`Error: ${error.message}`, 'error');
        resetGenerationUI();
    }
}

async function generateHTMLStreamWithReconnection(apiKey, source, formatPrompt, model, maxTokens, temperature, thinkingBudget) {
    console.log("Starting HTML generation with streaming and reconnection support...");
    
    // Prepare state variables for streaming
    let generatedContent = '';
    let sessionId = '';
    let reconnectAttempts = 0;
    
    try {
        // Show streaming status
        setProcessingText('Connecting to Claude...');
        
        // Create a function to handle the streaming call
        const processStreamChunk = async (isReconnect = false, lastChunkId = null) => {
            console.log(`${isReconnect ? 'Reconnecting' : 'Starting'} stream${sessionId ? ' with session ID: ' + sessionId : ''}...`);
            
            // Display reconnection status if applicable
            if (isReconnect) {
                setProcessingText(`Reconnecting to continue generation... (attempt ${reconnectAttempts})`);
            }
            
            // Create the request body
            const requestBody = {
                api_key: apiKey,
                source: source,
                format_prompt: formatPrompt,
                model: model,
                max_tokens: maxTokens,
                temperature: temperature,
                thinking_budget: thinkingBudget
            };
            
            // Add file information for file uploads
            if (state.activeTab === 'file' && state.file) {
                console.log(`Adding file upload info: ${state.fileName} (${formatFileSize(state.file.size)})`);
                requestBody.file_name = state.fileName;
                requestBody.file_content = state.fileContent; // Use stored file content directly
                
                // Ensure file content is included in the source parameter too for compatibility
                if (!requestBody.source || requestBody.source.trim() === '') {
                    console.log('Setting source parameter to file content for compatibility');
                    requestBody.source = state.fileContent;
                }
            }
            
            // Add session information for reconnections
            if (sessionId) {
                requestBody.session_id = sessionId;
                requestBody.is_reconnect = true;
                
                if (lastChunkId) {
                    requestBody.last_chunk_id = lastChunkId;
                }
            }
            
            try {
                // Start the streaming request
                const response = await fetch(`${API_URL}/api/process-stream`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    
                    // Special handling for timeout errors that might contain session information
                    if (response.status === 504 && errorText.includes('FUNCTION_INVOCATION_TIMEOUT')) {
                        console.log('Vercel timeout detected, will attempt reconnection');
                        
                        // Extract session ID if present in the error message
                        const sessionMatch = errorText.match(/cle\d+::[a-z0-9]+-\d+-[a-z0-9]+/);
                        if (sessionMatch && !sessionId) {
                            sessionId = sessionMatch[0];
                            console.log('Extracted session ID:', sessionId);
                        }
                        
                        // Increment reconnect attempts and try again
                        reconnectAttempts++;
                        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                            await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
                            return await processStreamChunk(true);
                        } else {
                            throw new Error('Maximum reconnection attempts reached. Please try again later.');
                        }
                    }
                    
                    throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
                }
                
                // Reset reconnect attempts on successful connection
                reconnectAttempts = 0;
                
                // Get a reader for the stream
                const reader = response.body.getReader();
                let decoder = new TextDecoder();
                
                // Process the stream
                while (true) {
                    const { value, done } = await reader.read();
                    
                    if (done) {
                        console.log('Stream complete');
                        break;
                    }
                    
                    // Decode the chunk
                    const chunk = decoder.decode(value, { stream: true });
                    console.log('Received chunk:', chunk.substring(0, 50) + '...');
                    
                    // Process the chunk - look for data: lines
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        // Skip empty lines
                        if (!line.trim()) continue;
                        
                        // Handle SSE format (data: {...})
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.substring(6));
                                
                                // Handle thinking updates
                                if (data.type === 'thinking_update') {
                                    if (data.thinking && data.thinking.content) {
                                        setProcessingText(`Claude is thinking: ${data.thinking.content.substring(0, 100)}...`);
                                    }
                                    continue;
                                }
                                
                                // Handle new local streaming format (type: delta)
                                if (data.type === 'delta' && data.content) {
                                    generatedContent += data.content;
                                    updateHtmlPreview(generatedContent);
                                    continue;
                                }
                                
                                // Handle content block deltas (the actual generated text) - Vercel format
                                if (data.type === 'content_block_delta' && data.delta && data.delta.text) {
                                    generatedContent += data.delta.text;
                                    updateHtmlPreview(generatedContent);
                                }
                                
                                // Save chunk ID for potential reconnection
                                if (data.chunk_id) {
                                    lastChunkId = data.chunk_id;
                                }
                                
                                // Check for the local message_complete
                                if (data.type === 'end') {
                                    console.log('End message received from local server');
                                    // Store the generated HTML for later use
                                    state.generatedHtml = generatedContent;
                                    generatedHtml = generatedContent; // Update global variable too
                                    
                                    // Final UI update
                                    updateHtmlDisplay();
                                }
                                
                                // Handle message complete from Vercel
                                if (data.type === 'message_complete') {
                                    console.log('Message complete received');
                                    
                                    // Ensure we store the generated HTML
                                    state.generatedHtml = generatedContent;
                                    generatedHtml = generatedContent; // Update global variable too
                                    
                                    // Final UI update
                                    updateHtmlDisplay();
                                    
                                    // Update usage statistics
                                    if (data.usage) {
                                        updateTokenStats(data.usage);
                                        
                                        // Calculate cost if available
                                        const totalCost = data.usage.total_cost || 
                                            ((data.usage.input_tokens / 1000000) * 3.0 + 
                                             (data.usage.output_tokens / 1000000) * 15.0);
                                        elements.totalCost.textContent = formatCostDisplay(totalCost);
                                        
                                        // Update storage with new usage stats
                                        try {
                                            // Get existing stats
                                            const existingStats = JSON.parse(localStorage.getItem('fileVisualizerStats') || '{"totalRuns":0,"totalTokens":0,"totalCost":0}');
                                            
                                            // Update stats
                                            existingStats.totalRuns = (existingStats.totalRuns || 0) + 1;
                                            existingStats.totalTokens = (existingStats.totalTokens || 0) + 
                                                (data.usage.input_tokens + data.usage.output_tokens);
                                            existingStats.totalCost = (existingStats.totalCost || 0) + totalCost;
                                            
                                            // Save updated stats
                                            localStorage.setItem('fileVisualizerStats', JSON.stringify(existingStats));
                                            
                                            // Update UI if stats container exists
                                            if (document.getElementById('total-runs')) {
                                                document.getElementById('total-runs').textContent = existingStats.totalRuns.toLocaleString();
                                            }
                                            if (document.getElementById('total-tokens')) {
                                                document.getElementById('total-tokens').textContent = existingStats.totalTokens.toLocaleString();
                                            }
                                            if (document.getElementById('total-cost')) {
                                                document.getElementById('total-cost').textContent = formatCostDisplay(existingStats.totalCost);
                                            }
                                        } catch (e) {
                                            console.error('Error updating usage statistics:', e);
                                        }
                                    }
                                }
                                
                                // Handle html field if present
                                if (data.html) {
                                    generatedContent = data.html;
                                    state.generatedHtml = data.html;
                                    updateHtmlPreview(generatedContent);
                                }
                            } catch (e) {
                                console.warn('Error parsing data line:', e, line);
                            }
                        }
                    }
                }
                
                // If we got here, the stream completed successfully
                // Make sure to update the state's generatedHtml property
                state.generatedHtml = generatedContent;
                
                // Update the HTML display and preview with the final content
                updateHtmlDisplay();
                updatePreview();
                
                // Show the results section
                showResultSection();
                
                // Complete the generation process
                stopProcessingAnimation();
                resetGenerationUI(true);
                showToast('Website generation complete!', 'success');
                
            } catch (error) {
                // Check if this is a timeout error that we can recover from
                if (error.message.includes('FUNCTION_INVOCATION_TIMEOUT') && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    console.log('Reconnecting due to timeout...');
                    reconnectAttempts++;
                    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
                    return await processStreamChunk(true, lastChunkId);
                }
                
                // Otherwise, propagate the error
                throw error;
            }
        };
        
        // Start the streaming process
        await processStreamChunk();
        
    } catch (error) {
        console.error('Error in generateHTMLStreamWithReconnection:', error);
        showToast(`Error: ${error.message}`, 'error');
        stopProcessingAnimation();
        resetGenerationUI(false);
        throw error; // Propagate the error
    }
}

function updateHtmlPreview(html) {
    if (!html) return;
    
    try {
        // For large content, use incremental iframe updates
        const htmlLength = html.length;
        
        if (htmlLength > MAX_HTML_BUFFER_SIZE) {
            // Only update the preview iframe in incremental mode for large content
            console.log(`Large HTML detected (${formatFileSize(htmlLength)}), using incremental iframe update`);
            
            // Check if iframe exists
            const iframe = document.getElementById('preview-iframe');
            if (!iframe) {
                console.error('Preview iframe not found');
                return;
            }
            
            // For very large content, we'll inject incrementally using document.write
            if (!iframe.hasAttribute('data-initialized')) {
                // Initialize the iframe with base HTML structure
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                iframeDoc.open();
                iframeDoc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body></body></html>');
                iframeDoc.close();
                iframe.setAttribute('data-initialized', 'true');
                iframe.setAttribute('data-content-length', '0');
            }
            
            // Get the previous content length
            const prevLength = parseInt(iframe.getAttribute('data-content-length') || '0');
            
            // Only inject the new content
            if (htmlLength > prevLength) {
                const newContent = html.substring(prevLength);
                
                try {
                    // Append to body instead of rewriting everything
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    
                    // Create temporary div to parse HTML
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = newContent;
                    
                    // Extract new nodes and append them to iframe body
                    Array.from(tempDiv.childNodes).forEach(node => {
                        iframeDoc.body.appendChild(iframeDoc.importNode(node, true));
                    });
                    
                    // Update the stored content length
                    iframe.setAttribute('data-content-length', htmlLength.toString());
                } catch (innerError) {
                    console.error('Error appending to iframe:', innerError);
                }
            }
        } else {
            // For smaller content, use normal update method
            elements.htmlOutput.value = html;
            
            // Update the preview iframe
            const iframe = document.getElementById('preview-iframe');
            if (iframe) {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                iframeDoc.open();
                iframeDoc.write(html);
                iframeDoc.close();
            }
        }
    } catch (error) {
        console.error('Error updating HTML preview:', error);
        showToast('Error updating preview', 'error');
    }
}

function showResultSection() {
    // Show the result section if it exists
    if (elements.resultSection) {
        elements.resultSection.classList.remove('hidden');
        
        // Scroll to the results section
        setTimeout(() => {
            elements.resultSection.scrollIntoView({ behavior: 'smooth' });
        }, 500);
    }
}

function startElapsedTimeCounter() {
    clearInterval(state.elapsedTimeInterval);
    
    // Initialize the start time properly
    state.startTime = new Date();
    
    // Update the counter immediately once
    const elapsed = Math.floor((new Date() - state.startTime) / 1000);
    elements.elapsedTime.textContent = `Elapsed: ${formatTime(elapsed)}`;
    
    // Then set up the interval for subsequent updates
    state.elapsedTimeInterval = setInterval(() => {
        const elapsed = Math.floor((new Date() - state.startTime) / 1000);
        elements.elapsedTime.textContent = `Elapsed: ${formatTime(elapsed)}`;
    }, 1000);
}

function stopElapsedTimeCounter() {
    clearInterval(state.elapsedTimeInterval);
}

function displayElapsedTime(seconds) {
    if (seconds && elements.elapsedTime) {
        elements.elapsedTime.textContent = `Completed in: ${formatTime(seconds)}`;
    }
}

function formatTime(seconds) {
    if (seconds < 0 || isNaN(seconds)) {
        seconds = 0;
    }

    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

async function processWithStreaming(data) {
    try {
        // Variables for streaming
        let chunks = 0;
        let lastChunkTime = Date.now();
        let receivedHtml = '';
        
        // Get the response
        const response = await fetch(`${API_URL}/api/process-stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        // Check for errors
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${await response.text()}`);
        }
        
        // Get a reader from the response body stream
        const reader = response.body.getReader();
        let decoder = new TextDecoder();
        
        // Flag for large content handling
        let isLargeContent = false;
        
        // Process the stream
        while (true) {
            const { value, done } = await reader.read();
            
            // If the stream is done, break the loop
            if (done) {
                console.log('Stream complete');
                break;
            }
            
            // Update last chunk time
            lastChunkTime = Date.now();
            chunks++;
            
            // Output every 10 chunks for debugging
            if (chunks % 10 === 0) {
                console.log(`Processed ${chunks} chunks so far`);
            }
            
            // Decode the chunk
            const chunkText = decoder.decode(value, { stream: true });
            
            // Split the chunk into lines
            const lines = chunkText.split('\n');
            
            // Process each line
            for (const line of lines) {
                // Skip empty lines
                if (!line.trim()) continue;
                
                // Process data lines
                if (line.startsWith('data: ')) {
                    try {
                        // Parse the JSON data
                        const jsonData = JSON.parse(line.substring(6));
                        
                        // Handle different event types
                        if (jsonData.type === 'content_block_delta' && jsonData.delta && jsonData.delta.text) {
                            // Handle content increments
                            receivedHtml += jsonData.delta.text;
                            
                            // If content is becoming large, switch to incremental mode
                            if (receivedHtml.length > MAX_HTML_BUFFER_SIZE && !isLargeContent) {
                                console.log('Switching to large content mode');
                                isLargeContent = true;
                            }
                            
                            // Update the preview (will use incremental mode if needed)
                            updateHtmlPreview(receivedHtml);
                            
                            // Show progress indicator
                            if (jsonData.segment) {
                                setProcessingText(`Processing segment ${jsonData.segment}... (${formatFileSize(receivedHtml.length)} generated)`);
                            }
                        } else if (jsonData.type === 'status') {
                            // Handle status updates
                            setProcessingText(jsonData.message || 'Processing...');
                        } else if (jsonData.type === 'message_complete') {
                            // Update UI
                            if (jsonData.usage) {
                                updateTokenStats(jsonData.usage);
                                
                                // Show time if available
                                if (jsonData.usage.time_elapsed) {
                                    elements.elapsedTime.textContent = formatTime(jsonData.usage.time_elapsed);
                                }
                            }
                            
                            // Update with final content if provided
                            if (jsonData.html) {
                                receivedHtml = jsonData.html;
                                updateHtmlPreview(receivedHtml);
                            }
                            
                            console.log('Generation complete');
                            setTimeout(() => {
                                stopProcessingAnimation();
                                showToast('Generation complete!', 'success');
                            }, 500);
                        }
                    } catch (error) {
                        console.error('Error parsing SSE data:', error, line);
                    }
                }
            }
        }
        
        // Ensure the HTML is displayed
        elements.htmlOutput.value = receivedHtml;
        
        // Return the generated HTML
        return receivedHtml;
    } catch (error) {
        console.error('Error in processWithStreaming:', error);
        stopProcessingAnimation();
        showToast(`Error: ${error.message}`, 'error');
        return null;
    }
}

function updateHtmlDisplay() {
    const htmlContent = state.generatedHtml || '';
    
    // Set the raw HTML content for display
    const rawHtmlElement = document.getElementById('raw-html');
    if (rawHtmlElement) {
        // Escape special characters for display
        rawHtmlElement.textContent = htmlContent;
        
        // Apply syntax highlighting
        if (window.Prism) {
            Prism.highlightElement(rawHtmlElement);
        }
    }
    
    // If preview is available, update it
    updatePreview();
    
    // Show the result section with both preview and code
    showResultSection();
}

function updatePreview() {
    const htmlContent = state.generatedHtml || '';
    if (!htmlContent) return;
    
    // Get the iframe
    const iframe = document.getElementById('preview-iframe');
    if (!iframe) return;
    
    try {
        // Write the HTML to the iframe
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(htmlContent);
        iframeDoc.close();
        
        console.log('Preview updated with HTML content of length:', htmlContent.length);
    } catch (error) {
        console.error('Error updating preview:', error);
    }
}

function resetGenerationUI(success = false) {
    if (elements.generateBtn) {
        elements.generateBtn.disabled = false;
        elements.generateBtn.innerHTML = '<i class="fas fa-magic mr-2"></i>Generate Visualization';
        updateGenerateButtonState();
    }
    
    if (elements.processingStatus) {
        if (success) {
            // Change the processing status to show completion but keep it visible
            if (elements.processingText) {
                elements.processingText.textContent = "Completed";
            }
            if (elements.processingIcon) {
                elements.processingIcon.classList.remove("fa-spinner", "fa-spin");
                elements.processingIcon.classList.add("fa-check-circle");
                elements.processingIcon.style.color = "#10B981"; // Green color
            }
            // Keep it visible permanently
            elements.processingStatus.classList.remove('hidden');
        } else {
            // On error, update status but keep visible
            if (elements.processingText) {
                elements.processingText.textContent = "Failed";
            }
            if (elements.processingIcon) {
                elements.processingIcon.classList.remove("fa-spinner", "fa-spin");
                elements.processingIcon.classList.add("fa-exclamation-circle");
                elements.processingIcon.style.color = "#EF4444"; // Red color
            }
            elements.processingStatus.classList.remove('hidden');
        }
    }
    
    stopElapsedTimeCounter();
    state.processing = false;
    disableInputsDuringGeneration(false);
}

// Output Actions
function copyHtmlToClipboard() {
    const htmlContent = state.generatedHtml || '';
    if (!htmlContent) {
        showToast('No HTML content to copy', 'error');
        return;
    }
    
    try {
        navigator.clipboard.writeText(htmlContent).then(() => {
            showToast('HTML copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            
            // Fallback copy method for browsers without clipboard API
            const textarea = document.createElement('textarea');
            textarea.value = htmlContent;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            
            showToast('HTML copied to clipboard!', 'success');
        });
    } catch (error) {
        console.error('Error copying to clipboard:', error);
        showToast('Failed to copy HTML. Please try again.', 'error');
    }
}

function downloadHtmlFile() {
    const htmlContent = state.generatedHtml || '';
    if (!htmlContent) {
        showToast('No HTML content to download', 'error');
        return;
    }
    
    try {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Create a descriptive filename
        let filename = 'visualization.html';
        if (state.activeTab === 'text' && elements.inputText && elements.inputText.value) {
            // Extract first few words from text input to create filename
            const firstFewWords = elements.inputText.value
                .trim()
                .split(/\s+/)
                .slice(0, 4)
                .join('_')
                .replace(/[^a-zA-Z0-9_-]/g, '')
                .substring(0, 30); // Limit length
                
            if (firstFewWords) {
                filename = `${firstFewWords}.html`;
            }
        } else if (state.fileName) {
            // If a file was uploaded, base the name on that
            const baseName = state.fileName.split('.')[0];
            filename = `${baseName}_visualization.html`;
        }
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Website file downloaded!', 'success');
    } catch (error) {
        console.error('Error downloading file:', error);
        showToast('Failed to download file. Please try again.', 'error');
    }
}

function openPreviewInNewTab() {
    const htmlContent = state.generatedHtml || '';
    if (!htmlContent) {
        showToast('No HTML content to preview', 'error');
        return;
    }
    
    try {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    } catch (error) {
        console.error('Error opening preview:', error);
        showToast('Failed to open preview. Please try again.', 'error');
    }
}

// Toast Notification
function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg ${
        type === 'success' ? 'bg-green-500' : 
        type === 'error' ? 'bg-red-500' : 
        'bg-blue-500'
    } text-white max-w-xs animate-fade-in`;
    
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${
                type === 'success' ? 'fa-check-circle' : 
                type === 'error' ? 'fa-exclamation-circle' : 
                'fa-info-circle'
            } mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    // Remove the toast after 5 seconds
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 5000);
}

// Add token analysis function
async function analyzeTokens(content) {
    if (!content) {
        if (elements.tokenInfo) {
            elements.tokenInfo.innerHTML = '';
        }
        return;
    }
    
    try {
        // Show loading indicator
        if (elements.tokenInfo) {
            elements.tokenInfo.innerHTML = `
                <div class="token-analysis loading">
                    <h3>Token Analysis</h3>
                    <p>Analyzing tokens...</p>
                </div>
            `;
        }
        
        const response = await fetch('/api/analyze-tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                content,
                file_type: state.activeTab === 'file' && state.file ? state.file.name.split('.').pop().toLowerCase() : 'txt'
            })
        });
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Update token info display
        if (elements.tokenInfo) {
            elements.tokenInfo.innerHTML = `
                <div class="token-analysis">
                    <h3>Token Analysis</h3>
                    <p>Estimated Input Tokens: ${data.estimated_tokens.toLocaleString()}</p>
                    <p>Estimated Input Cost: $${data.estimated_cost.toFixed(4)}</p>
                    <p>Maximum Safe Input Tokens: 200,000</p>
                </div>
            `;
        }
        
        return data;
    } catch (error) {
        console.error('Error analyzing tokens:', error);
        if (elements.tokenInfo) {
            elements.tokenInfo.innerHTML = `
                <div class="token-analysis error">
                    <p>Error analyzing tokens: ${error.message}</p>
                </div>
            `;
        }
        return null;
    }
}

// Helper function to start processing animation
function startProcessingAnimation() {
    // Initialize progress bar animation
    if (elements.progressBar) {
        elements.progressBar.style.width = '0%';
        elements.progressBar.classList.add('animate-progress');
        
        // Animate the progress bar to 90% (reserve last 10% for completion)
        setTimeout(() => {
            elements.progressBar.style.width = '90%';
        }, 100);
    }
    
    // Show processing status
    if (elements.processingStatus) {
        elements.processingStatus.classList.remove('hidden');
        elements.processingStatus.classList.remove('processing-complete');
    }
    
    // Update processing text
    setProcessingText('Processing with Claude...');
    
    console.log('Processing animation started');
}

// Helper function to fully stop processing animation
function stopProcessingAnimation() {
    // Stop progress bar animation
    if (elements.progressBar) {
        // Ensure the progress bar is set to 100% to indicate completion
        elements.progressBar.style.width = '100%';
        elements.progressBar.classList.remove('animate-progress');
    }
    
    // Mark processing container as complete (for CSS targeting)
    if (elements.processingStatus) {
        elements.processingStatus.classList.add('processing-complete');
    }
    
    // Update the processing text to show completion instead of hiding it
    if (elements.processingText) {
        elements.processingText.textContent = 'Generation complete! ✓';
    }
    
    // Keep the processing status visible instead of hiding it
    // Comment out the code that hides it
    /*
    if (elements.processingStatus) {
        setTimeout(() => {
            elements.processingStatus.classList.add('hidden');
        }, 2000); // Hide after 2 seconds to allow user to see completion
    }
    */
    
    // Update elapsed time if it exists
    if (elements.elapsedTime) {
        // Get current elapsed time if not already set
        const currentTime = state.startTime ? 
            Math.floor((new Date() - state.startTime) / 1000) : 0;
        
        // Set to "Completed" if not already set
        if (elements.elapsedTime.textContent.startsWith('Elapsed:')) {
            elements.elapsedTime.textContent = `Completed in: ${formatTime(currentTime)}`;
        }
    }
    
    // Ensure timer stops
    stopElapsedTimeCounter();
    
    // Reset processing status if needed
    state.processing = false;
    
    console.log('Processing animation fully stopped');
}

// Helper function to update token info UI
function updateTokenInfoUI(data) {
    if (!elements.tokenInfo) return;
    
    if (data.error) {
        elements.tokenInfo.innerHTML = `
            <div class="token-analysis error">
                <h3>Error Processing File</h3>
                <p>${data.error}</p>
            </div>
        `;
    } else {
        elements.tokenInfo.innerHTML = `
            <div class="token-analysis">
                <h3>Token Analysis</h3>
                <p>Estimated Input Tokens: ${data.estimated_tokens.toLocaleString()}</p>
                <p>Estimated Input Cost: $${data.estimated_cost.toFixed(4)}</p>
                <p>Maximum Safe Input Tokens: 200,000</p>
            </div>
        `;
    }
}

// Helper function to show token analysis errors
function showTokenAnalysisError(message) {
    if (!elements.tokenInfo) return;
    
    elements.tokenInfo.innerHTML = `
        <div class="token-analysis error">
            <h3>Error Processing File</h3>
            <p>${message}</p>
        </div>
    `;
}

// Helper function to disable inputs during generation
function disableInputsDuringGeneration(disable) {
    // Disable/enable input elements during generation
    const inputElements = [
        elements.apiKeyInput,
        elements.fileInput,
        elements.inputText,
        elements.additionalPrompt,
        elements.temperature,
        elements.maxTokens,
        elements.thinkingBudget,
        elements.model
    ];
    
    for (const element of inputElements) {
        if (element) {
            element.disabled = disable;
            
            // Add visual indication of disabled state
            if (disable) {
                element.classList.add('opacity-50');
            } else {
                element.classList.remove('opacity-50');
            }
        }
    }
    
    // Disable droparea functionality during generation
    if (elements.dropArea) {
        if (disable) {
            elements.dropArea.classList.add('pointer-events-none', 'opacity-50');
        } else {
            elements.dropArea.classList.remove('pointer-events-none', 'opacity-50');
        }
    }
}

// Helper function to connect to the streaming API
async function connectToStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
            break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep the last incomplete chunk in the buffer
        
        for (const event of events) {
            if (event.trim() && event.startsWith('data: ')) {
                try {
                    const jsonStr = event.substring(6); // Remove 'data: ' prefix
                    const data = JSON.parse(jsonStr);
                    handleStreamEvent(data);
                } catch (e) {
                    console.error('Failed to parse event:', e);
                    // If we can't parse an event, make sure the UI is still updated
                    stopProcessingAnimation();
                }
            }
        }
    }
}

// Helper function to safely escape HTML 
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Function to get input content based on active tab
function getInputContent() {
    console.log("Getting input content for active tab:", state.activeTab);
    
    if (state.activeTab === 'file') {
        console.log("File content:", state.fileContent ? `${state.fileContent.substring(0, 50)}...` : "none");
        return state.fileContent;
    } else if (state.activeTab === 'text') {
        console.log("Text content:", state.textContent ? `${state.textContent.substring(0, 50)}...` : "none");
        return state.textContent;
    }
    
    return '';
}

// Helper function to show notifications
function showNotification(message, type = 'info') {
    // Implementation is similar to showToast function
    console.log(`NOTIFICATION (${type}): ${message}`);
    showToast(message, type);
}

// Toggle test mode state
function toggleTestMode() {
    state.testMode = elements.testModeToggle.checked;
    
    // Save test mode preference to localStorage
    localStorage.setItem('test_mode', state.testMode);
    
    // Update UI to reflect test mode state
    if (state.testMode) {
        showTestModeIndicator();
    } else {
        hideTestModeIndicator();
    }
    
    console.log(`Test mode ${state.testMode ? 'enabled' : 'disabled'}`);
}

function showTestModeIndicator() {
    // Create indicator if it doesn't exist
    if (!elements.testModeIndicator) {
        const indicator = document.createElement('span');
        indicator.id = 'test-mode-indicator';
        indicator.className = 'test-mode-active ml-2';
        indicator.textContent = 'Test Mode';
        
        // Add indicator next to the generate button
        elements.generateBtn.parentNode.insertBefore(indicator, elements.generateBtn.nextSibling);
        elements.testModeIndicator = indicator;
        
    } else if (elements.testModeIndicator) {
        elements.testModeIndicator.classList.remove('hidden');
    }
}

function hideTestModeIndicator() {
    if (elements.testModeIndicator) {
        elements.testModeIndicator.classList.add('hidden');
    }
}

// Modified function to more aggressively clear the local storage on page load
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Initialize the app
        init();
        
        // Check URL parameters for reset flag
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('reset')) {
            console.log('Reset flag detected in URL, clearing localStorage');
            resetUsageStatistics();
        }
        
        console.log('App loaded and ready!');
    } catch (e) {
        console.error('Error during initialization:', e);
    }
});

// Ensure the app initializes
if (document.readyState === 'loading') {
    console.log('Document still loading, waiting for DOMContentLoaded event');
} else {
    console.log('Document already loaded, initializing immediately');
    init();
}

// A wrapper function for compatibility in case someone calls startGeneration instead of generateWebsite
function startGeneration() {
    console.log('startGeneration called, forwarding to generateWebsite');
    if (typeof generateWebsite === 'function') {
        generateWebsite();
    } else {
        console.error('generateWebsite function not found in startGeneration!');
    }
}

// Reset output stats
function resetTokenStats() {
    elements.inputTokens.textContent = '0';
    elements.outputTokens.textContent = '0';
    // The thinking tokens element might exist in the DOM but should not be used
    elements.totalCost.textContent = '-';
}

// Update the UI with token usage data
function updateTokenStats(usage) {
    if (!usage) return;
    
    elements.inputTokens.textContent = usage.input_tokens.toLocaleString();
    elements.outputTokens.textContent = usage.output_tokens.toLocaleString();
    elements.totalCost.textContent = formatCostDisplay(usage.total_cost);
} 