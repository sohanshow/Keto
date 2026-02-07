import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { config } from './config.js';
import { logger } from './logger.js';
import { WebSocketHandler } from './websocket-handler.js';

const app = express();

// Middleware
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const wsHandler = new WebSocketHandler();

wss.on('connection', (ws: WebSocket) => {
  wsHandler.handleConnection(ws);
});

// Start server
server.listen(config.port, () => {
  logger.info(`🚀 Voice Agent Server running on port ${config.port}`);
  logger.info(`📡 WebSocket endpoint: ws://localhost:${config.port}/ws`);
  logger.info(`🏥 Health check: http://localhost:${config.port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
