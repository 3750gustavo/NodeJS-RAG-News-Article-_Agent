import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import AIModelManager from './modules/AIModelManager';
import RagProcessor from './modules/RagProcessor';
import dotenv from 'dotenv';
dotenv.config();

// Interfaces
interface Config {
  PORT: number;
  [key: string]: any;
}

interface GenerateRequestBody {
  model: string;
  prompt: string;
  parameters: string;
}

interface AgentRequestBody {
  query: string;
}

interface Source {
  title: string;
  [key: string]: any;
}

interface RagResult {
  context: string;
  sourcesUsed: Source[];
}

interface GenerateResult {
  text: string;
  sourcesUsed: string[];
}

const sourcesDir = path.join(__dirname, 'Rag-Sources');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Initialize RAG processor
const ragProcessor = new RagProcessor(sourcesDir);

// Read configuration
const configPath = path.join(process.cwd(), 'config.json');
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PORT = config.PORT || 3000;

// Initialize AI model manager
const aiModelManager = new AIModelManager();

// Middleware to handle CORS
app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Route to get available models
app.get('/models', (async (req: Request, res: Response) => {
    try {
        const models = await AIModelManager.getSortedModels();
        res.json(models);
    } catch (error) {
        console.error('Failed to fetch models:', (error as Error).message);
        res.status(500).json({ error: 'Failed to fetch models' });
    }
}) as RequestHandler);

// Route to generate text
app.post('/generate', (async (req: Request<ParamsDictionary, any, GenerateRequestBody, ParsedQs>, res: Response) => {
    const { model, prompt, parameters } = req.body;

    // Parse parameters from JSON string to object
    let paramsObj: Record<string, any> = {};
    try {
        paramsObj = JSON.parse(parameters);
    } catch (error) {
        console.error('Failed to parse parameters:', (error as Error).message);
        return res.status(400).json({ error: 'Invalid parameters format' });
    }

    // Retrieve context from RAG sources
    try {
        const { context, sourcesUsed }: RagResult = await ragProcessor.retrieveContext(prompt);

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
        const generatePromise = new Promise<GenerateResult>((resolve, reject) => {
            aiModelManager.once('complete', () => {
                resolve({
                    text: responseText,
                    sourcesUsed: sourcesUsed.map(source => source.title)
                });
            });

            aiModelManager.generateText(fullPrompt, (chunk: string) => {
                responseText += chunk;
            }).catch(reject);
        });

        // Wait for completion and send response
        const result = await generatePromise;
        res.json(result);

    } catch (error) {
        console.error('Failed to process request:', (error as Error).message);
        res.status(500).json({ error: 'Failed to process request' });
    }
}) as RequestHandler);

// New route for the /agent endpoint
app.post('/agent', (async (req: Request<ParamsDictionary, any, AgentRequestBody, ParsedQs>, res: Response) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    try {
        // Retrieve context from RAG sources
        const { context, sourcesUsed }: RagResult = await ragProcessor.retrieveContext(query);

        // Construct full prompt with context
        const fullPrompt = `Context:\n${context}\n\nQuestion: ${query}\nAnswer:`;

        // Set default model and parameters
        const model = 'TheDrummer-UnslopNemo-12B-v4.1';
        const paramsObj = {
            max_tokens: 222,
            temperature: 0.8,
            top_p: 0.98,
            top_k: -1,
            min_p: 0.08,
            repetition_penalty: 1.0,
            presence_penalty: 0.5,
            stop: 'Question:'
        };

        // Set model and parameters
        aiModelManager.setModel(model);
        aiModelManager.setParameters(paramsObj);

        // Generate text
        let responseText = '';

        // Remove any existing listeners to prevent memory leaks
        aiModelManager.removeAllListeners('complete');

        // Create a promise to handle the completion
        const generatePromise = new Promise<string>((resolve, reject) => {
            aiModelManager.once('complete', () => {
                resolve(responseText);
            });

            aiModelManager.generateText(fullPrompt, (chunk: string) => {
                responseText += chunk;
            }).catch(reject);
        });

        // Wait for completion and send response
        const answer = await generatePromise;
        res.json({
            answer: answer,
            sources: sourcesUsed
        });

    } catch (error) {
        console.error('Failed to process request:', (error as Error).message);
        res.status(500).json({ error: 'Failed to process request' });
    }
}) as RequestHandler);

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
