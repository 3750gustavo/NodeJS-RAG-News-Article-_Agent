const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { Kafka, logLevel } = require('kafkajs');

class RagProcessor {
    constructor(sourcesDir) {
        this.sourcesDir = sourcesDir;
        this.documents = [];
        this.isShuttingDown = false;

        // Create Kafka client with enhanced configuration
        this.kafka = new Kafka({
            clientId: 'news-rag-agent',
            brokers: [process.env.KAFKA_BROKER],
            ssl: {
                rejectUnauthorized: true,
                // CA certificate might be required based on your Kafka setup
                // ca: fs.readFileSync('/path/to/ca-cert.pem', 'utf-8'),
            },
            sasl: {
                mechanism: 'plain',
                username: process.env.KAFKA_USERNAME,
                password: process.env.KAFKA_PASSWORD
            },
            connectionTimeout: 10000, // 10 seconds
            retry: {
                initialRetryTime: 300,
                retries: 5
            },
            logLevel: logLevel.ERROR
        });

        this.consumer = null;
        this.initKafkaConsumer();
        this.loadDocuments();
        this.setupShutdownHandlers();
    }

    setupShutdownHandlers() {
        const shutdownGracefully = async () => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            console.log('Shutting down gracefully...');
            if (this.consumer) {
                try {
                    await this.consumer.disconnect();
                    console.log('Kafka consumer disconnected');
                } catch (err) {
                    console.error('Error disconnecting Kafka consumer:', err);
                }
            }
            process.exit(0);
        };

        process.on('SIGTERM', shutdownGracefully);
        process.on('SIGINT', shutdownGracefully);
        process.on('uncaughtException', (err) => {
            console.error('Uncaught exception:', err);
            shutdownGracefully();
        });
    }

    async initKafkaConsumer() {
        try {
            this.consumer = this.kafka.consumer({
                groupId: `${process.env.KAFKA_GROUP_ID_PREFIX}${Date.now()}`,
                sessionTimeout: 30000, // 30 seconds
                heartbeatInterval: 3000 // 3 seconds
            });

            await this.consumer.connect();
            console.log('Kafka consumer connected');

            await this.consumer.subscribe({
                topic: process.env.KAFKA_TOPIC_NAME,
                fromBeginning: false
            });

            await this.consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    try {
                        const url = message.value.toString();
                        console.log(`Received URL from Kafka: ${url}`);
                        await this.processNewsArticle(url);
                    } catch (error) {
                        console.error('Error processing Kafka message:', error);
                    }
                },
                autoCommit: true,
                autoCommitInterval: 5000, // 5 seconds
            });

            console.log('Kafka consumer running');
        } catch (error) {
            console.error('Failed to setup Kafka consumer:', error);
            // Retry connection after a delay
            console.log('Retrying Kafka connection in 5 seconds...');
            setTimeout(() => this.initKafkaConsumer(), 5000);
        }
    }

    loadDocuments() {
        if (!fs.existsSync(this.sourcesDir)) {
            fs.mkdirSync(this.sourcesDir, { recursive: true });
            return;
        }

        const files = fs.readdirSync(this.sourcesDir)
            .filter(file => file.endsWith('.json'));

        for (const file of files) {
            const content = fs.readFileSync(path.join(this.sourcesDir, file), 'utf8');
            const doc = JSON.parse(content);
            this.documents.push({ ...doc, filename: file });
        }
    }

    async processNewsArticle(url) {
        try {
            console.log(`Processing article from URL: ${url}`);
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);

            // Extract title and content
            const title = $('h1').first().text() || $('title').text();
            let content = '';

            // Extract text from paragraphs
            $('p').each((_, element) => {
                content += $(element).text() + ' ';
            });

            // Clean up whitespace
            content = content.replace(/\s+/g, ' ').trim();

            // Create article data
            const articleData = {
                title: title || url.split('/').pop(),
                content: content,
                url: url,
                date: new Date().toISOString()
            };

            // Save to file
            const filename = `article_${Date.now()}.json`;
            const filePath = path.join(this.sourcesDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(articleData, null, 2));

            // Add to in-memory documents
            this.documents.push({
                ...articleData,
                filename
            });

            console.log(`Successfully processed article: ${articleData.title}`);
            return articleData;
        } catch (error) {
            console.error('Error processing article:', error);
            return null;
        }
    }

    async retrieveContext(query, maxChars = 30000) {
        const keywords = query.toLowerCase().split(' ');
        const chunks = [];
        const sourcesUsed = new Set();

        // Local documents
        for (const doc of this.documents) {
            const relevance = this.calculateRelevance(doc.content, keywords);
            if (relevance > 0) {
                chunks.push({
                    content: doc.content,
                    title: doc.title,
                    url: doc.url,
                    date: doc.date,
                    relevance
                });
                sourcesUsed.add(doc.url);
            }
        }

        // Web search
        const webResults = await this.searchWeb(query);
        for (const result of webResults) {
            const relevance = this.calculateRelevance(result.content, keywords);
            if (relevance > 0) {
                chunks.push({
                    content: result.content,
                    title: result.title,
                    url: result.url,
                    date: result.date,
                    relevance
                });
                sourcesUsed.add(result.url);
            }
        }

        // Sort chunks by relevance
        chunks.sort((a, b) => b.relevance - a.relevance);

        // Build context string
        let context = '';
        const usedSources = [];
        for (const chunk of chunks) {
            if (context.length >= maxChars) break;

            const remaining = maxChars - context.length;
            context += chunk.content.slice(0, remaining) + "\n\n";
            usedSources.push({
                title: chunk.title,
                url: chunk.url,
                date: chunk.date
            });
        }

        return { context, sourcesUsed: usedSources };
    }

    calculateRelevance(content, keywords) {
        const text = content.toLowerCase();
        let score = 0;
        for (const keyword of keywords) {
            const count = (text.match(new RegExp(keyword, 'g')) || []).length;
            score += count;
        }
        return score;
    }

    async searchWeb(query) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        try {
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
                }
            });
            const $ = cheerio.load(response.data);

            const results = [];
            $('a').each((_, element) => {
                const href = $(element).attr('href');
                if (href && href.startsWith('http') && !href.includes('google')) {
                    results.push(href);
                }
            });

            const articles = [];
            for (const url of results.slice(0, 5)) { // Limit to top 5 results
                const article = await this.processNewsArticle(url);
                if (article) {
                    articles.push(article);
                }
            }

            return articles;
        } catch (error) {
            console.error('Error performing web search:', error);
            return [];
        }
    }
}

module.exports = RagProcessor;