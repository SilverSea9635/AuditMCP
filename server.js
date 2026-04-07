import { clearConversation, streamChatMessage } from './ocr.js';
import express from 'express';
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import cors from 'cors';

const HOST = process.env.MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_PORT || 3000);
const BODY_LIMIT = process.env.MCP_BODY_LIMIT || '20mb';
const app = express();
const transports = new Map();

app.use(express.json({ limit: BODY_LIMIT }));

if (['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  app.use(localhostHostValidation());
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(cors());

app.get('/', (_req, res) => {
  res.json({
    name: 'minimal-http-sse-mcp',
    transport: 'http+sse',
    sseEndpoint: '/sse',
    messageEndpoint: '/messages?sessionId=<sessionId>',
    chatEndpoint: '/api/chat',
  });
});

app.post('/api/chat', async (req, res) => {
  const {
    conversationId,
    message,
    content,
    system,
    model,
    maxTokens = process.env.DEFAULT_MAX_TOKENS,
  } = req.body ?? {};

  const hasStructuredMessage = Array.isArray(message);
  const hasStructuredContent = Array.isArray(content);
  const textInput = typeof content === 'string' ? content : message;

  if (!hasStructuredMessage && !hasStructuredContent && (typeof textInput !== 'string' || !textInput.trim())) {
    res.status(400).json({
      error: 'message/content is required and must be a non-empty string or non-empty array when image is not provided',
    });
    return;
  }

  if (message !== undefined && typeof message !== 'string' && !Array.isArray(message)) {
    res.status(400).json({ error: 'message must be a string or an array of content blocks' });
    return;
  }

  if (content !== undefined && typeof content !== 'string' && !Array.isArray(content)) {
    res.status(400).json({ error: 'content must be a string or an array of content blocks' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { resolvedConversationId, stream } = streamChatMessage({
      conversationId,
      message,
      system,
      model,
      maxTokens,
    });

    sendEvent('start', { conversationId: resolvedConversationId });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        sendEvent('delta', { text: event.delta.text });
      }
    }

    const finalMessage = await stream.finalMessage();
    sendEvent('done', {
      conversationId: resolvedConversationId,
      usage: finalMessage.usage,
      stopReason: finalMessage.stop_reason,
      model: finalMessage.model,
    });
  } catch (error) {
    console.error('Chat request failed:', error);
    sendEvent('error', {
      error: error?.message || 'Chat request failed',
      type: error?.type || 'internal_error',
    });
  } finally {
    res.end();
  }
});

app.delete('/api/chat/:conversationId', (req, res) => {
  const cleared = clearConversation(req.params.conversationId);

  res.json({
    conversationId: req.params.conversationId,
    cleared,
  });
});

app.post('/messages', async (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  if (!sessionId) {
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).send('Session not found');
    return;
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error(`Failed to handle message for session ${sessionId}:`, error);
    if (!res.headersSent) {
      res.status(500).send('Failed to handle message');
    }
  }
});

app.use((error, _req, res, next) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({
      error: `request entity too large, current limit is ${BODY_LIMIT}`,
      type: 'payload_too_large',
    });
    return;
  }

  next(error);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`MCP HTTP/SSE server listening on http://${HOST}:${PORT}`);
  console.log(`SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.log(`Message endpoint: http://${HOST}:${PORT}/messages?sessionId=<sessionId>`);
  console.log(`JSON body limit: ${BODY_LIMIT}`);
});

httpServer.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);

  for (const [sessionId, transport] of transports.entries()) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`Failed to close transport for session ${sessionId}:`, error);
    } finally {
      transports.delete(sessionId);
    }
  }

  httpServer.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
