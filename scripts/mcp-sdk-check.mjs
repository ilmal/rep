// Connect with the official MCP SDK (streamable HTTP) like a real agent would.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const BASE = process.env.BASE ?? 'http://localhost:8793';
const anon = await (await fetch(`${BASE}/api/auth/anon`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const tok = (await (await fetch(`${BASE}/api/tokens`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${anon.token}` }, body: JSON.stringify({ name: 'sdk', scope: 'write' }) })).json()).token;
const client = new Client({ name: 'sdk-check', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tok}` } } }));
const tools = await client.listTools();
console.log('tools:', tools.tools.length, 'instructions:', !!client.getInstructions());
const r = await client.callTool({ name: 'set_exercise_pref', arguments: { exerciseId: 'back_squat', favorite: true, relevance: 80 } });
console.log('set_exercise_pref ->', r.isError ? 'ERROR' : 'ok', r.content[0].text.slice(0, 90));
const e = await client.callTool({ name: 'get_exercise', arguments: { exerciseId: 'back_squat' } });
const j = JSON.parse(e.content[0].text); console.log('get_exercise score', j.score, 'favorite', j.favorite, 'relevance', j.relevance);
const bad = await client.callTool({ name: 'set_exercise_pref', arguments: { exerciseId: 'nope' } });
console.log('bad id ->', bad.isError ? 'isError ✓' : 'NOT an error');
await client.close();
