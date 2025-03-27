import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosResponse } from 'axios';

interface ModelResponse {
    id?: string;
    name?: string;
}

interface ApiDataResponse {
    data?: ModelResponse[];
}

// Read configuration
const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const API_KEY = config.INFERMATIC_API_KEY;
const BASE_URL = 'https://api.totalgpt.ai';

// Create API client instance
const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
    },
    timeout: 300000 // 5 minutes
});

class APIHandler {
    static async fetchModels(): Promise<string[]> {
        try {
            const response = await apiClient.get<ApiDataResponse | ModelResponse[]>('/v1/models');
            const data = response.data;

            if (Array.isArray(data)) {
                return data.map((model: ModelResponse) => model.id || model.name || '');
            }
            if (data && 'data' in data && Array.isArray(data.data)) {
                return data.data.map((model: ModelResponse) => model.id || model.name || '');
            }

            console.error('Unexpected response structure:', data);
            return [];

        } catch (error) {
            if (error instanceof Error) {
                console.error('Failed to fetch models:', error.message);
            } else {
                console.error('Failed to fetch models:', error);
            }
            return [];
        }
    }

    static async generateText(data: unknown): Promise<AxiosResponse> {
        try {
            return await apiClient.post('/v1/completions', data, {
                responseType: 'stream'
            });
        } catch (error) {
            if (error instanceof Error) {
                console.error('Text generation failed:', error.message);
            } else {
                console.error('Text generation failed:', error);
            }
            throw error;
        }
    }
}

export default APIHandler;
