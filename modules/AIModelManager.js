const APIHandler = require('./APIHandler');
const { EventEmitter } = require('events');
const split = require('split2');

class AIModelManager extends EventEmitter {
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

    setModel(model) {
        this.modelVar = model;
    }

    setParameters(newParams) {
        Object.keys(newParams).forEach(key => {
            if (this.parameters.hasOwnProperty(key)) {
                this.parameters[key] = newParams[key];
            } else {
                console.warn(`Warning: Unknown parameter '${key}'`);
            }
        });
    }

    static async getSortedModels() {
        const models = await APIHandler.fetchModels();
        return this._sortModelsBySize(models);
    }

    static _sortModelsBySize(models) {
        const sizePattern = /(\d+)x(\d+)[bB]|(\d+)[bB]/i;

        const getSize = (modelName) => {
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

        return models.sort((a, b) => {
            const sizeA = getSize(a);
            const sizeB = getSize(b);
            return sizeA - sizeB || a.localeCompare(b);
        });
    }

    async generateText(prompt, insertChunkFunc) {
        if (!this.modelVar) {
            throw new Error("No model selected. Please set a model using setModel()");
        }

        const data = {
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
            stream.pipe(split()).on('data', (line) => {
                if (line.startsWith('data: ')) {
                    const jsonData = line.slice(6); // Remove 'data: ' prefix
                    if (jsonData.trim() === '[DONE]') {
                        this.emit('complete');
                        return;
                    }
                    try {
                        const payload = JSON.parse(jsonData);
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

            stream.on('error', (err) => {
                console.error('Stream error:', err);
            });

        } catch (error) {
            console.error('Generation failed:', error.message);
        }
    }
}

module.exports = AIModelManager;