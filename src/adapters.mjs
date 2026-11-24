import {createHash} from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
function content(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(v => typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : '').filter(Boolean).join('\n');
}
function message(id, role, value, timestamp) {
  return {id: String(id), role, text: content(value), timestamp: timestamp ?? null};
}
function normalize(source, id, title, messages) {
  if (!id) throw new Error('Missing session id');
  return {source, id: String(id), title: title || messages.find(m => m.role === 'user')?.text.slice(0,100) || String(id), messages: messages.filter(m => m.text)};
}
export function parse(source, raw) {
  if (source === 'chatgpt') {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Expected conversations.json array');
    return data.map(c => {
      const messages = [], seen = new Set();
      let id = c.current_node;
      while (id) {
        if (seen.has(id)) throw new Error('Cycle in ChatGPT mapping');
        seen.add(id);
        const n = c.mapping?.[id];
        if (!n) throw new Error('Missing ChatGPT mapping node');
        const m = n.message;
        if (m && ['user','assistant'].includes(m.author?.role)) messages.push(message(m.id ?? id,m.author.role,m.content?.parts,m.create_time));
        id = n.parent;
      }
      return normalize(source,c.id ?? c.conversation_id,c.title,messages.reverse());
    });
  }
  const rows = raw.split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
  let id, messages = [];
  for (const [i,r] of rows.entries()) {
    if (source === 'codex') {
      if (r.type === 'session_meta') id = r.payload?.id;
      if (r.type === 'response_item' && r.payload?.type === 'message' && ['user','assistant'].includes(r.payload.role)) messages.push(message(r.payload.id ?? i,r.payload.role,r.payload.content,r.timestamp));
    } else if (source === 'claude') {
      if (r.sessionId) id ??= r.sessionId;
      if (['user','assistant'].includes(r.type)) messages.push(message(r.uuid ?? i,r.type,r.message?.content,r.timestamp));
    } else if (source === 'pi') {
      if (r.type === 'session') id = r.id;
      if (r.type === 'message' && ['user','assistant'].includes(r.message?.role)) messages.push(message(r.id ?? i,r.message.role,r.message.content,r.message.timestamp));
    } else throw new Error('Unsupported source: '+source);
  }
  return [normalize(source,id,null,messages)];
}
