# NodeJS-RAG-News-Article-Agent
---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [How to Use](#how-to-use)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Usage](#usage)
- [System Architecture](#system-architecture)
- [API Endpoints](#api-endpoints)
- [Optimization Techniques](#optimization-techniques)
- [Future Improvements](#future-improvements)
- [Troubleshooting](#troubleshooting)

## Overview

NodeJS-RAG-News-Article-Agent is a Retrieval-Augmented Generation (RAG) system that allows users to query information from news articles. The system ingests news links from Kafka or CSV files, extracts and processes content, and uses a Large Language Model (LLM) to answer user queries with relevant contextual information from the articles.

## Features

- **Real-time News Ingestion**: Consumes news article links via Kafka or CSV files
- **Automatic Content Extraction**: Processes HTML articles and extracts clean content
- **RAG-Based Response Generation**: Combines retrieved context with LLM capabilities
- **Streaming Responses**: Provides a better user experience with streamed LLM outputs
- **Context-Aware Answers**: Bases responses on actual news sources rather than fabricated information
- **Custom Query Support**: Handles various query types including summarization and specific news events
- **Simple User Interface**: Includes a test UI for easy interaction with the system

## How to Use

### Prerequisites

- Node.js (v16.x or higher)
- TypeScript
- Kafka (optional, for real-time news ingestion)
- Local LLM server or API key for chosen LLM provider

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/NodeJS-RAG-News-Article-Agent.git
   cd NodeJS-RAG-News-Article-Agent
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Configure environment variables
   Create a `.env` file with the following variables:
   ```
   KAFKA_BROKER=pkc-ewzgj.europe-west4.gcp.confluent.cloud:9092
   KAFKA_USERNAME=your-kafka-username
   KAFKA_PASSWORD=your-kafka-password
   KAFKA_TOPIC_NAME=news
   KAFKA_GROUP_ID_PREFIX=test-task-
   ```

4. Inside `test_search_form.html`, update the `baseUrl` variable to point to your server address, it works between different PCs on the same network.
   ```javascript
    // Define the base URL
    const baseUrl = 'http://192.168.0.120:3000'; // Change this to your server address
   ```

5. Build the TypeScript code
   ```
   npm run build
   ```

### Usage

1. Start the server
   ```
   npm start
   ```

2. Access the test UI
   Open `test_search_form.html` in your browser to try out the agent

3. Use the API endpoints directly
   - `/agent` - Submit queries to the news agent
   - `/generate` - Generate text with specific parameters (also supports RAG as it adds any local files to the context)
   - `/models` - Get a list of available models (not currently implemented in the `test_search_form.html`)

## System Architecture

The system consists of the following components:

1. **Kafka Consumer**: Listens for news article URLs and processes them in real-time
2. **RagProcessor**: Extracts, cleans, and indexes article content
3. **AIModelManager**: Interfaces with LLM API for text generation
4. **Express API Server**: Exposes endpoints for client interaction

The RAG process flow:
1. News articles are ingested via Kafka or CSV files
2. Content is extracted and stored with metadata
3. When a query is received, relevant article content is retrieved
4. The LLM generates a response using the retrieved context
5. The response is streamed back to the client with source references

## API Endpoints

### POST `/agent`
Processes user queries using the RAG system.

**Request:**
```json
{
  "query": "What is the latest news about LA fires?"
}
```

**Response:**
```json
{
  "answer": "The latest news about LA fires indicates that...",
  "sources": [
    {
      "title": "Los Angeles Wildfires: Current Status and Impact",
      "url": "https://example.com/news/la-fires",
      "date": "2025-01-21T13:17:36Z"
    }
  ]
}
```

### POST `/generate`
Generates text using specified model and parameters.

**Request:**
```json
{
  "model": "TheDrummer-UnslopNemo-12B-v4.1",
  "prompt": "Question: What is the capital of France?\nAnswer:",
  "parameters": "{\"max_tokens\": 222, \"temperature\": 0.8}"
}
```

### GET `/models`
Returns a list of available LLM models.

## Optimization Techniques

Several techniques have been implemented to optimize the system:

1. **Efficient Content Retrieval**: Uses keyword-based relevance scoring to fetch only the most relevant articles
2. **Response Streaming**: Improves perceived response time by streaming tokens as they're generated
3. **Graceful Shutdown**: Ensures proper disconnection from Kafka to prevent data loss
4. **Error Handling**: Implements robust error handling throughout the pipeline
5. **Model Parameter Optimization**: Configurable parameters to balance quality and speed

## Future Improvements

Potential enhancements for the system:

1. **Vector Database Integration**: Replacing keyword-based retrieval with embedding-based vector search
2. **GraphQL API**: Implementing a GraphQL API with Yoga as specified in requirements
3. **Langfuse Monitoring**: Adding observability with Langfuse for better debugging
4. **Docker Containerization**: Creating a Docker setup for easier deployment
5. **Chunking Optimization**: Implementing smarter document chunking for better context retrieval
6. **Query Classification**: Pre-processing queries to determine intent for better response generation
7. **Auto-scaling**: Adding support for handling variable load conditions

## Troubleshooting

Common issues and solutions:

- **Kafka Connection Issues**: Verify network connectivity and credentials in the .env file
- **LLM API Errors**: Check API keys and model availability
- **Performance Problems**: Adjust chunk size and relevance thresholds in RagProcessor