import dotenv from 'dotenv';
import { Anthropic } from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

dotenv.config({
  path: fileURLToPath(new URL('./.env.development', import.meta.url)),
});

if ( !process.env.MIMO_KEY ) {
  throw new Error('Missing MIMO_KEY in .env.development');
}

if ( !process.env.MIMO_PREFIX ) {
  throw new Error('Missing MIMO_PREFIX in .env.development');
}

const DEFAULT_MODEL = process.env.MIMO_MODEL || 'mimo-v2-omni';
const DEFAULT_SYSTEM =
  process.env.MIMO_SYSTEM ||
  'You are MiMo, an AI assistant developed by Xiaomi. Keep answers concise and useful.';
const DEFAULT_MAX_TOKENS = parseInt(process.env.DEFAULT_MAX_TOKENS) ||4096;
const baseURL = process.env.MIMO_PREFIX.replace(/\/v1\/messages\/?$/, '');
const conversations = new Map();

const anthropic = new Anthropic({
  apiKey: process.env.MIMO_KEY,
  baseURL,
});

function resolveConversationId(conversationId) {
  if ( typeof conversationId === 'string' && conversationId.trim() ) {
    return conversationId.trim();
  }

  return randomUUID();
}

export function streamChatMessage({
  conversationId,
  message,
  system = DEFAULT_SYSTEM,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
}) {
  const resolvedConversationId = resolveConversationId(conversationId);
  const history = conversations.get(resolvedConversationId) || [];
  const nextHistory = [ ...history, { role: 'user', content: message } ];

  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: nextHistory,
  });

  stream.finalMessage().then((response) => {
    const assistantMessage = { role: 'assistant', content: response.content };
    conversations.set(resolvedConversationId, [ ...nextHistory, assistantMessage ]);
  }).catch(() => {});

  return { resolvedConversationId, stream };
}

export function clearConversation(conversationId) {
  if ( typeof conversationId !== 'string' || !conversationId.trim() ) {
    return false;
  }

  return conversations.delete(conversationId.trim());
}
