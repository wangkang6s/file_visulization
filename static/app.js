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
    temperatureReset: $('#temperature-reset'),
    maxTokens: $('#max-tokens'),
    maxTokensValue: $('#max-tokens-value'),
    maxTokensReset: $('#max-tokens-reset'),
    thinkingBudget: $('#thinking-budget'),
    thinkingBudgetValue: $('#thinking-budget-value'),
    thinkingBudgetReset: $('#thinking-budget-reset'),
    
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
    thinkingTokens: $('#thinking-tokens'),
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
    statusMessage: $('#status-message')
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
    elapsedTimeInterval: null
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
    
    // Load saved API key if available
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey && elements.apiKeyInput) {
        elements.apiKeyInput.value = savedApiKey;
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
    
    console.log("App initialized");
}

function loadUsageStatistics() {
    try {
        // Get stored statistics or initialize with zeros
        const stats = JSON.parse(localStorage.getItem('fileVisualizerStats') || '{"totalRuns":0,"totalTokens":0,"totalCost":0}');
        
        // Update UI elements if they exist
        if (document.getElementById('total-runs')) {
            document.getElementById('total-runs').textContent = stats.totalRuns.toLocaleString();
        }
        if (document.getElementById('total-tokens')) {
            document.getElementById('total-tokens').textContent = stats.totalTokens.toLocaleString();
        }
        if (document.getElementById('total-cost')) {
            document.getElementById('total-cost').textContent = `$${stats.totalCost.toFixed(4)}`;
        }
    } catch (e) {
        console.error('Error loading usage statistics:', e);
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
            // Update theme toggle icon
            if (elements.themeToggle.innerHTML.includes('fa-moon')) {
                elements.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            }
        });
    }
    
    // API Key
    if (elements.apiKeyInput) {
        elements.apiKeyInput.addEventListener('input', handleApiKeyInput);
    }
    if (elements.validateKeyBtn) {
        elements.validateKeyBtn.addEventListener('click', validateApiKey);
    }
    
    // Tabs
    if (elements.fileTab) {
        elements.fileTab.addEventListener('click', () => switchTab('file'));
    }
    if (elements.textTab) {
        elements.textTab.addEventListener('click', () => switchTab('text'));
    }
    
    // File Upload
    if (elements.fileUpload) {
        elements.fileUpload.addEventListener('change', handleFileUpload);
    }
    if (elements.dropArea) {
        elements.dropArea.addEventListener('click', () => elements.fileUpload.click());
    }
    
    // Text Input
    if (elements.inputText) {
        elements.inputText.addEventListener('input', handleTextInput);
    }
    
    // Temperature
    if (elements.temperature) {
        elements.temperature.addEventListener('input', updateTemperature);
    }
    if (elements.temperatureReset) {
        elements.temperatureReset.addEventListener('click', resetTemperature);
    }
    
    // Max Tokens
    if (elements.maxTokens) {
        elements.maxTokens.addEventListener('input', updateMaxTokens);
    }
    if (elements.maxTokensReset) {
        elements.maxTokensReset.addEventListener('click', resetMaxTokens);
    }
    
    // Thinking Budget
    if (elements.thinkingBudget) {
        elements.thinkingBudget.addEventListener('input', updateThinkingBudget);
    }
    if (elements.thinkingBudgetReset) {
        elements.thinkingBudgetReset.addEventListener('click', resetThinkingBudget);
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
                const base64String = btoa(
                    Array.from(uint8Array)
                        .map(byte => String.fromCharCode(byte))
                        .join('')
                );
                
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
                                    <p>Maximum Safe Output Tokens: ${data.max_safe_output_tokens.toLocaleString()}</p>
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
                const base64String = btoa(
                    Array.from(uint8Array)
                        .map(byte => String.fromCharCode(byte))
                        .join('')
                );
                
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
    // Make sure we have API key and content
    const hasApiKey = !!state.apiKey;
    const hasContent = (state.activeTab === 'file' && !!state.fileContent) || 
                       (state.activeTab === 'text' && !!state.textContent);
    
    if (hasApiKey && hasContent) {
        elements.generateBtn.disabled = false;
        elements.generateBtn.classList.remove('bg-gray-300', 'dark:bg-gray-700', 'text-gray-500', 'dark:text-gray-400', 'cursor-not-allowed');
        elements.generateBtn.classList.add('bg-primary-500', 'hover:bg-primary-600', 'text-white', 'cursor-pointer');
        if (elements.generateError) {
            elements.generateError.classList.add('hidden');
        }
    } else {
        elements.generateBtn.disabled = true;
        elements.generateBtn.classList.add('bg-gray-300', 'dark:bg-gray-700', 'text-gray-500', 'dark:text-gray-400', 'cursor-not-allowed');
        elements.generateBtn.classList.remove('bg-primary-500', 'hover:bg-primary-600', 'text-white', 'cursor-pointer');
    }
}

// Generation Process
async function startGeneration() {
    console.log("START GENERATION FUNCTION CALLED", new Date().toISOString());
    
    if (state.processing) {
        console.log("Already processing, returning");
        return;
    }

    // Validate API key
    const apiKey = elements.apiKeyInput.value.trim();
    if (!apiKey) {
        showNotification("Please enter an API key", "error");
        return;
    }

    // Validate API key with server
    try {
        const validationResponse = await fetch(`${API_URL}/api/validate-key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ api_key: apiKey })
        });
        
        const validationData = await validationResponse.json();
        if (!validationResponse.ok || !validationData.valid) {
            showNotification(validationData.message || "Invalid API key", "error");
            return;
        }
    } catch (error) {
        console.error("Error validating API key:", error);
        showNotification("Error validating API key: " + error.message, "error");
        return;
    }

    // Get input content
    const inputContent = getInputContent();
    if (!inputContent) {
        showNotification("Please provide input content", "error");
        return;
    }

    console.log("All validations passed, proceeding with generation");

    // Update UI to show processing state
    state.processing = true;
    state.startTime = new Date();  // Initialize start time
    
    // Show processing status
    if (elements.processingStatus) {
        elements.processingStatus.classList.remove('hidden');
    }
    
    // Use the in-page processing status instead of the full screen overlay
    // const processingContainer = document.getElementById('processingContainer');
    // if (processingContainer) {
    //     processingContainer.style.display = 'flex';
    // }
    
    // Set initial processing text
    if (elements.processingText) {
        elements.processingText.textContent = "Preparing to generate...";
    }
    
    if (elements.processingIcon) {
        elements.processingIcon.classList.remove("fa-check-circle");
        elements.processingIcon.classList.add("fa-spinner", "fa-spin");
        elements.processingIcon.style.color = ""; // Reset color
    }
    if (elements.elapsedTime) {
        elements.elapsedTime.textContent = 'Elapsed: 0:00';
    }
    startElapsedTimeCounter();  // Start the time counter
    
    // Disable inputs during generation
    disableInputsDuringGeneration(true);
    
    // Get parameters for generating HTML
    const params = {
        api_key: apiKey,
        source: inputContent,
        format_prompt: elements.additionalPrompt ? elements.additionalPrompt.value : '',
        model: elements.model ? elements.model.value : 'claude-3-7-sonnet-20250219',
        max_tokens: elements.maxTokens ? parseInt(elements.maxTokens.value) : 128000,
        temperature: elements.temperature ? parseFloat(elements.temperature.value) : 1.0,
        thinking_budget: elements.thinkingBudget ? parseInt(elements.thinkingBudget.value) : 32000
    };

    try {
        // Start the streaming process
        await generateHTMLStreamWithReconnection(
            params.api_key,
            params.source,
            params.format_prompt,
            params.model,
            params.max_tokens,
            params.temperature,
            params.thinking_budget
        );
    } catch (error) {
        console.error('Error in generation:', error);
        showNotification(`Generation error: ${error.message}`, 'error');
        
        // Reset UI
        if (elements.processingStatus) {
            elements.processingStatus.classList.add('hidden');
        }
        stopElapsedTimeCounter();  // Stop the time counter
        state.processing = false;
        disableInputsDuringGeneration(false);  // Re-enable inputs
        updateGenerateButtonState();
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
                let lastChunkId = null;
                
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
                                    // This is handled at the end of the stream
                                }
                                
                                // Handle message complete from Vercel
                                if (data.type === 'message_complete') {
                                    console.log('Message complete received');
                                    
                                    // Update usage statistics
                                    if (data.usage) {
                                        elements.inputTokens.textContent = data.usage.input_tokens.toLocaleString();
                                        elements.outputTokens.textContent = data.usage.output_tokens.toLocaleString();
                                        elements.thinkingTokens.textContent = data.usage.thinking_tokens.toLocaleString();
                                        
                                        // Make sure total_cost is available or calculate it
                                        const totalCost = data.usage.total_cost || 
                                            ((data.usage.input_tokens + data.usage.output_tokens) / 1000000 * 3.0);
                                        elements.totalCost.textContent = `$${totalCost.toFixed(4)}`;
                                        
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
                                                document.getElementById('total-cost').textContent = `$${existingStats.totalCost.toFixed(4)}`;
                                            }
                                        } catch (e) {
                                            console.error('Error updating usage statistics:', e);
                                        }
                                    }
                                }
                                
                                // Handle html field if present
                                if (data.html) {
                                    generatedContent = data.html;
                                    updateHtmlPreview(generatedContent);
                                }
                            } catch (e) {
                                console.warn('Error parsing data line:', e, line);
                            }
                        }
                    }
                }
                
                // If we got here, the stream completed successfully
                state.generatedHtml = generatedContent;
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
    
    state.elapsedTimeInterval = setInterval(() => {
        const elapsed = Math.floor((new Date() - state.startTime) / 1000);
        elements.elapsedTime.textContent = `Elapsed: ${formatTime(elapsed)}`;
    }, 1000);
}

function stopElapsedTimeCounter() {
    clearInterval(state.elapsedTimeInterval);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
                                elements.inputTokens.textContent = jsonData.usage.input_tokens.toLocaleString();
                                elements.outputTokens.textContent = jsonData.usage.output_tokens.toLocaleString();
                                if (jsonData.usage.thinking_tokens) {
                                    elements.thinkingTokens.textContent = jsonData.usage.thinking_tokens.toLocaleString();
                                }
                                
                                // Calculate cost if available
                                const totalCost = jsonData.usage.total_cost || 
                                    ((jsonData.usage.input_tokens + jsonData.usage.output_tokens) / 1000000 * 3.0);
                                elements.totalCost.textContent = `$${totalCost.toFixed(4)}`;
                                
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
    if (!state.generatedHtml || !elements.htmlOutput) return;
    
    // Escape HTML entities to prevent code execution in the pre tag
    const escapedHtml = escapeHtml(state.generatedHtml);
    elements.htmlOutput.value = state.generatedHtml;
    
    // If Prism.js is available, highlight the code
    if (window.Prism) {
        Prism.highlightElement(elements.htmlOutput);
    }
    
    // Enable the copy and download buttons
    if (elements.copyHtml) {
        elements.copyHtml.disabled = false;
        elements.copyHtml.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (elements.downloadHtml) {
        elements.downloadHtml.disabled = false;
        elements.downloadHtml.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

function updatePreview() {
    if (!state.generatedHtml) return;
    
    try {
        const iframe = elements.previewIframe;
        if (!iframe) return;
        
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(state.generatedHtml);
        doc.close();
        
        // Enable the "Open in New Tab" button
        if (elements.openPreview) {
            elements.openPreview.disabled = false;
            elements.openPreview.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    } catch (e) {
        console.error('Error updating preview:', e);
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
            // Change the processing status to show completion
            if (elements.processingText) {
                elements.processingText.textContent = "Finished!";
            }
            if (elements.processingIcon) {
                elements.processingIcon.classList.remove("fa-spinner", "fa-spin");
                elements.processingIcon.classList.add("fa-check-circle");
                elements.processingIcon.style.color = "#10B981"; // Green color
            }
            // Keep it visible for a moment, then hide
            setTimeout(() => {
                elements.processingStatus.classList.add('hidden');
            }, 3000);
        } else {
            // Just hide on error
            elements.processingStatus.classList.add('hidden');
        }
    }
    
    stopElapsedTimeCounter();
    state.processing = false;
    disableInputsDuringGeneration(false);
}

// Output Actions
function copyHtmlToClipboard() {
    if (!state.generatedHtml) return;
    
    try {
        navigator.clipboard.writeText(state.generatedHtml).then(() => {
            showToast('Website code copied to clipboard!', 'success');
        });
    } catch (e) {
        console.error('Error copying to clipboard:', e);
        showToast('Failed to copy to clipboard. Please try again.', 'error');
    }
}

function downloadHtmlFile() {
    if (!state.generatedHtml) return;
    
    try {
        const blob = new Blob([state.generatedHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'visualization.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Website file downloaded!', 'success');
    } catch (e) {
        console.error('Error downloading file:', e);
        showToast('Failed to download file. Please try again.', 'error');
    }
}

function openPreviewInNewTab() {
    const blob = new Blob([state.generatedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
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
                    <p>Maximum Safe Output Tokens: ${data.max_safe_output_tokens.toLocaleString()}</p>
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
                <p>Maximum Safe Output Tokens: ${data.max_safe_output_tokens.toLocaleString()}</p>
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

// Initialize the app
document.addEventListener('DOMContentLoaded', init); 