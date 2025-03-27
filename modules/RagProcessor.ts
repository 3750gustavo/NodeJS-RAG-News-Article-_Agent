import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Kafka, logLevel } from 'kafkajs';

class RagProcessor {
    private sourcesDir: string = '';
    private documents: any[] = [];
    private isShuttingDown: boolean = false;
    private kafka: Kafka;
    private consumer: any = null;

    constructor(sourcesDir: string) {
        this.sourcesDir = sourcesDir;
        this.documents = [];
        this.isShuttingDown = false;

        // Create Kafka client with enhanced configuration
        this.kafka = new Kafka({
            clientId: 'news-rag-agent',
            brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
            ssl: {
                rejectUnauthorized: true,
                // CA certificate might be required based on your Kafka setup
                // ca: fs.readFileSync('/path/to/ca-cert.pem', 'utf-8'),
            },
            sasl: process.env.KAFKA_USERNAME && process.env.KAFKA_PASSWORD ? {
                mechanism: 'plain',
                username: process.env.KAFKA_USERNAME,
                password: process.env.KAFKA_PASSWORD
            } : undefined,
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
                eachMessage: async ({ _topic, partition, message }: {
                    _topic: string;
                    partition: number;
                    message: { value: Buffer | null };
                }) => {
                    try {
                        const url = message.value ? message.value.toString() : '';
                        if (!url) {
                            console.warn('Received empty message from Kafka');
                            return;
                        }
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

        // Check for CSV files and process them
        const csvFiles = fs.readdirSync(this.sourcesDir)
            .filter(file => file.endsWith('.csv'));

        for (const csvFile of csvFiles) {
            const csvPath = path.join(this.sourcesDir, csvFile);
            this.processCsvFile(csvPath);
        }
    }

    processCsvFile(csvPath: string) {
        const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
        for (const line of lines) {
            const [source, url] = line.trim().split(',').map(part => part.trim());
            if (url) {
                console.log(`Processing URL from CSV: ${url}`);
                this.processNewsArticle(url);
            }
        }
    }

    async processNewsArticle(url: string): Promise<any> {
        try {
            console.log(`Processing article from URL: ${url}`);
            const response = await axios.get(url);
            const $ = cheerio.load(response.data); // Initialize cheerio here

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

    async retrieveContext(query: string, maxChars = 30000): Promise<{ context: string; sourcesUsed: any[] }> {
        // Extract the actual question from the prompt format
        let searchQuery = query;
        const match = query.match(/Question:\s*(.*?)\s*Answer:/);
        if (match) {
            searchQuery = match[1].trim();
        }

        const keywords = searchQuery.toLowerCase()
            .split(/\s+/)
            .filter(word =>
                word.length > 2 &&
                !['who', 'what', 'when', 'where', 'why', 'how', 'is', 'are', 'the'].includes(word)
            );

        const chunks: any[] = [];
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

        // Sort chunks by relevance
        chunks.sort((a, b) => b.relevance - a.relevance);

        // Build context string
        let context = '';
        const usedSources: Array<{title: string; url: string; date: string}> = [];
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

    calculateRelevance(content: string, keywords: string[]): number {
        const text = content.toLowerCase();
        let score = 0;
        for (const keyword of keywords) {
            const count = (text.match(new RegExp(keyword, 'g')) || []).length;
            score += count;
        }
        return score;
    }

    async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default RagProcessor;
