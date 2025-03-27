const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Read configuration
const configPath = path.join(__dirname, '../config.json');
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
    static async fetchModels() {
        try {
            const response = await apiClient.get('/v1/models');

            // Handle different response formats
            const data = response.data;
            if (Array.isArray(data)) {
                return data.map(model => model.id || model.name || '');
            }
            if (data?.data && Array.isArray(data.data)) {
                return data.data.map(model => model.id || model.name || '');
            }

            console.error('Unexpected response structure:', data);
            return [];

        } catch (error) {
            console.error('Failed to fetch models:', error.message);
            return [];
        }
    }

    static async generateText(data) {
        try {
            const response = await apiClient.post('/v1/completions', data, {
                responseType: 'stream'
            });

            return response;

        } catch (error) {
            console.error('Text generation failed:', error.message);
            throw error;
        }
    }
}

module.exports = APIHandler;