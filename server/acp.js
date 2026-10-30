// Minimal ACP (Agent Client Protocol) client. Spawns the Claude Agent ACP adapter and talks
// newline-delimited JSON-RPC over its stdio. Emits 'update' and 'permission' events.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

// Prepended to the first prompt of each session.
const PREAMBLE = `You are the research agent behind a Twitter/X explorer web UI.
Use the twitterapi-io skill to answer questions about tweets, users, trends and conversations.
The API key is in the environment variable TWITTERAPI_IO_KEY: read it from the environment, never print it.
Only use read endpoints; do not post, like, follow or message anyone. Estimate cost before large crawls (>2,000 tweets).
Answer in concise Markdown. When numbers suit a chart, include a fenced block tagged chart containing JSON, e.g.
\`\`\`chart
{"type":"bar","title":"Tweets per day","labels":["Mon","Tue"],"values":[12,30]}
\`\`\`
(type is bar, line or pie.) Link tweets with their x.com URLs.

User request:
`;

export class AcpAgent extends EventEmitter {
  constructor({ cwd, env }) {
    super();
    mkdirSync(cwd, { recursive: true });
    this.cwd = cwd; this.env = env;
    this.nextId = 1; this.pending = new Map(); this.permissions = new Map();
    this.sessions = new Set(); this.primed = new Set();
    this.ready = null;
  }

  start() {
    this.ready ??= this.#boot();
    return this.ready;
  }

  async #boot() {
    const entry = require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');
    this.proc = spawn(process.execPath, [entry], { cwd: this.cwd, env: { ...process.env, ...this.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    this.proc.on('exit', (code) => {
      this.ready = null;
      for (const { reject } of this.pending.values()) reject(new Error(`agent exited (${code})`));
      this.pending.clear(); this.sessions.clear(); this.primed.clear();
      this.emit('exit', code);
    });
    let buf = '';
    this.proc.stdout.setEncoding('utf8').on('data', (chunk) => {
      buf += chunk;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) try { this.#onMessage(JSON.parse(line)); } catch (e) { console.error('bad ACP line:', line.slice(0, 200)); }
      }
    });
    const init = await this.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'twitter-explorer', version: '1.0.0' } });
    this.authMethods = init.authMethods ?? [];
    return init;
  }

  #write(msg) { this.proc.stdin.write(JSON.stringify(msg) + '\n'); }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  #onMessage(m) {
    if (m.id !== undefined && (m.result !== undefined || m.error) && !m.method) { // response to us
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (p) m.error ? p.reject(new Error(m.error.message ?? JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === 'session/update') {
      this.emit('update', m.params.sessionId, m.params.update);
    } else if (m.method === 'session/request_permission') { // agent asks us; the browser user decides
      const requestId = String(m.id);
      this.permissions.set(requestId, m.id);
      this.emit('permission', { requestId, sessionId: m.params.sessionId, toolCall: m.params.toolCall, options: m.params.options });
    } else if (m.id !== undefined) { // any other request: we advertise no capabilities, so refuse
      this.#write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported' } });
    }
  }

  resolvePermission(requestId, optionId) {
    const id = this.permissions.get(requestId);
    if (id === undefined) return false;
    this.permissions.delete(requestId);
    this.#write({ jsonrpc: '2.0', id, result: { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } } });
    return true;
  }

  async newSession() {
    await this.start();
    const { sessionId } = await this.request('session/new', { cwd: this.cwd, mcpServers: [] });
    this.sessions.add(sessionId);
    return sessionId;
  }

  async prompt(sessionId, text) {
    const first = !this.primed.has(sessionId); this.primed.add(sessionId);
    const r = await this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: (first ? PREAMBLE : '') + text }] });
    return r.stopReason;
  }

  cancel(sessionId) {
    this.#write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    // Pending permission prompts for this session count as cancelled.
    for (const requestId of [...this.permissions.keys()]) this.resolvePermission(requestId, null);
  }
}
