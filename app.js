const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const AIModelManager = require('./modules/AIModelManager');
const RagProcessor = require('./modules/RagProcessor');
require('dotenv').config();
const sourcesDir = path.join(__dirname, 'Rag-Sources');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Initialize RAG processor
const ragProcessor = new RagProcessor(sourcesDir);

// Read configuration
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PORT = config.PORT || 3000;

// Initialize AI model manager
const aiModelManager = new AIModelManager();

// Middleware to handle CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Route to get available models
app.get('/models', async (req, res) => {
    try {
        const models = await AIModelManager.getSortedModels();
        res.json(models);
    } catch (error) {
        console.error('Failed to fetch models:', error.message);
        res.status(500).json({ error: 'Failed to fetch models' });
    }
});

// Route to generate text
app.post('/generate', async (req, res) => {
    const { model, prompt, parameters } = req.body;

    // Parse parameters from JSON string to object
    let paramsObj = {};
    try {
        paramsObj = JSON.parse(parameters);
    } catch (error) {
        console.error('Failed to parse parameters:', error.message);
        return res.status(400).json({ error: 'Invalid parameters format' });
    }

    // Retrieve context from RAG sources
    try {
        const { context, sourcesUsed } = await ragProcessor.retrieveContext(prompt);

        // Log sources used
        if (sourcesUsed.length > 0) {
            console.log('Sources used:', sourcesUsed.map(source => source.title).join(', '));
        } else {
            console.log('No sources used for this query.');
        }

        // Construct full prompt with context
        const fullPrompt = `Context:\n${context}\n\n${prompt}`;

        console.log('Full Prompt:', fullPrompt);
        console.log('Using model:', model);

        // Set model and parameters
        aiModelManager.setModel(model);
        aiModelManager.setParameters(paramsObj);

        // Generate text
        let responseText = '';

        // Remove any existing listeners to prevent memory leaks
        aiModelManager.removeAllListeners('complete');

        // Create a promise to handle the completion
        const generatePromise = new Promise((resolve, reject) => {
            aiModelManager.once('complete', () => {
                resolve({
                    text: responseText,
                    sourcesUsed: sourcesUsed.map(source => source.title)
                });
            });

            aiModelManager.generateText(fullPrompt, (chunk) => {
                responseText += chunk;
            }).catch(reject);
        });

        // Wait for completion and send response
        const result = await generatePromise;
        res.json(result);

    } catch (error) {
        console.error('Failed to process request:', error.message);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});