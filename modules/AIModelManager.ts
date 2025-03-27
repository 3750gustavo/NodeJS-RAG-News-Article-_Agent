import APIHandler from './APIHandler';
import { EventEmitter } from 'events';
import split from 'split2';

// Define interfaces for parameters and responses
interface ModelParameters {
    max_tokens: number;
    temperature: number;
    top_p: number;
    top_k: number;
    min_p: number;
    repetition_penalty: number;
    presence_penalty: number;
    stop: string | string[];
    [key: string]: any; // Allow additional parameters
}

interface GenerationRequest {
    model: string;
    prompt: string;
    stream: boolean;
    seed: number;
    [key: string]: any;
}

interface GenerationChoice {
    text?: string;
    finish_reason?: string;
}

interface GenerationResponse {
    choices?: GenerationChoice[];
    [key: string]: any;
}

class AIModelManager extends EventEmitter {
    private modelVar: string | null;
    private parameters: ModelParameters;

    constructor() {
        super();
        this.modelVar = null;
        this.parameters = {
            max_tokens: 222,
            temperature: 0.8,
            top_p: 0.98,
            top_k: -1,
            min_p: 0.08,
            repetition_penalty: 1.0,
            presence_penalty: 0.5,
            stop: "Question:",
        };
    }

    setModel(model: string): void {
        this.modelVar = model;
    }

    setParameters(newParams: Partial<ModelParameters>): void {
        Object.keys(newParams).forEach(key => {
            if (this.parameters.hasOwnProperty(key)) {
                this.parameters[key as keyof ModelParameters] = newParams[key as keyof ModelParameters];
            } else {
                console.warn(`Warning: Unknown parameter '${key}'`);
            }
        });
    }

    static async getSortedModels(): Promise<string[]> {
        const models = await APIHandler.fetchModels();
        return this._sortModelsBySize(models);
    }

    static _sortModelsBySize(models: string[]): string[] {
        const sizePattern = /(\d+)x(\d+)[bB]|(\d+)[bB]/i;

        const getSize = (modelName: string): number => {
            const match = modelName.match(sizePattern);
            if (match) {
                if (match[1] && match[2]) {
                    return parseInt(match[1]) * parseInt(match[2]);
                }
                if (match[3]) {
                    return parseInt(match[3]);
                }
            }
            return Infinity;
        };

        return models.sort((a: string, b: string) => {
            const sizeA = getSize(a);
            const sizeB = getSize(b);
            return sizeA - sizeB || a.localeCompare(b);
        });
    }

    async generateText(prompt: string, insertChunkFunc: (text: string) => void): Promise<void> {
        if (!this.modelVar) {
            throw new Error("No model selected. Please set a model using setModel()");
        }

        const data: GenerationRequest = {
            model: this.modelVar,
            prompt,
            stream: true,
            seed: -1,
            ...this.parameters
        };

        try {
            const response = await APIHandler.generateText(data);
            const stream = response.data;

            // Split stream into lines and process
            stream.pipe(split()).on('data', (line: string) => {
                if (line.startsWith('data: ')) {
                    const jsonData = line.slice(6); // Remove 'data: ' prefix
                    if (jsonData.trim() === '[DONE]') {
                        this.emit('complete');
                        return;
                    }
                    try {
                        const payload = JSON.parse(jsonData) as GenerationResponse;
                        const choice = payload.choices?.[0];

                        if (choice?.text) {
                            insertChunkFunc(choice.text);
                        }
                        if (choice?.finish_reason) {
                            console.log(`Generation finished: ${choice.finish_reason}`);
                        }
                    } catch (err) {
                        console.error('Error parsing chunk:', err);
                    }
                }
            });

            stream.on('error', (err: Error) => {
                console.error('Stream error:', err);
            });

        } catch (error: any) { // Explicitly typed as any
            console.error('Generation failed:', error.message);
        }
    }
}

export default AIModelManager;