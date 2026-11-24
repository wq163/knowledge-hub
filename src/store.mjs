import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {hash,parse} from './adapters.mjs';
export class Store {
  constructor(root) {
    this.root=root;
    mkdirSync(join(root,'raw'),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(join(root,'hub.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY,source TEXT NOT NULL,account TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,json TEXT NOT NULL,revision TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(session_key TEXT NOT NULL,revision TEXT NOT NULL,raw_hash TEXT NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(session_key,revision,raw_hash));
      CREATE TABLE IF NOT EXISTS imports(source TEXT NOT NULL,account TEXT NOT NULL,raw_hash TEXT NOT NULL,PRIMARY KEY(source,account,raw_hash));
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(key UNINDEXED,title,body,tokenize='trigram');`);
  }
  ingest(source,account,raw) {
    const digest=hash(raw);
    const sessions=parse(source,raw);
    const target=join(this.root,'raw',digest);
    try {writeFileSync(target,raw,{flag:'wx',mode:0o600});} catch(e){if(e.code!=='EEXIST')throw e;}
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.db.prepare('SELECT 1 FROM imports WHERE source=? AND account=? AND raw_hash=?').get(source,account,digest)) {this.db.exec('COMMIT');return 0;}
      let count=0;
      for(const s of sessions){
        const key=hash(JSON.stringify([source,account,s.id]));
        const json=JSON.stringify(s), revision=hash(json), now=new Date().toISOString();
        const prior=this.db.prepare('SELECT revision FROM sessions WHERE key=?').get(key);
        this.db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?)').run(key,revision,digest,now);
        if(prior?.revision===revision) continue;
        this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET title=excluded.title,json=excluded.json,revision=excluded.revision,updated_at=excluded.updated_at').run(key,source,account,s.id,s.title,json,revision,now);
        this.db.prepare('DELETE FROM search_index WHERE key=?').run(key);
        this.db.prepare('INSERT INTO search_index VALUES(?,?,?)').run(key,s.title,s.messages.map(m=>m.text).join('\n'));
        count++;
      }
      this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(source,account,digest);
      this.db.exec('COMMIT');return count;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  search(q){
    if(!q.trim())throw new Error('Empty query');
    if([...q].length<3) return this.db.prepare('SELECT key,source,title FROM sessions WHERE instr(title,?)>0 OR instr(json,?)>0 LIMIT 50').all(q,q);
    return this.db.prepare('SELECT s.key,s.source,s.title FROM search_index JOIN sessions s ON s.key=search_index.key WHERE search_index MATCH ? LIMIT 50').all('"'+q.replaceAll('"','""')+'"');
  }
  get(key){const row=this.db.prepare('SELECT json FROM sessions WHERE key=?').get(key);return row?JSON.parse(row.json):null;}
  close(){this.db.close();}
}
