import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {Store} from './store.mjs';
const [cmd,...args]=process.argv.slice(2);
const usage='hub import <chatgpt|codex|claude|pi> <file> [account]\nhub scan <codex|claude|pi> [directory] [account]\nhub search <text>\nhub show <key>';
function* walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())yield* walk(p);else if(entry.isFile()&&p.endsWith('.jsonl'))yield p;}}
if(!cmd||cmd==='help'||cmd==='--help'){console.log(usage);process.exit(0);}
const store=new Store(resolve(process.env.HUB_DATA_DIR??join(homedir(),'.local/share/knowledge-hub')));
try{
  if(cmd==='import') {const [source,file,account='default']=args;console.log({changed:store.ingest(source,account,readFileSync(file,'utf8'))});}
  else if(cmd==='scan'){
    const [source,dir,account='default']=args;
    const defaults={codex:'.codex/sessions',claude:'.claude/projects',pi:'.pi/agent/sessions'};
    if(!Object.hasOwn(defaults,source))throw new Error('Unsupported scan source');
    let changed=0,errors=0;
    for(const p of walk(dir??join(homedir(),defaults[source])))try{changed+=store.ingest(source,account,readFileSync(p,'utf8'));}catch(e){errors++;console.error(p+': '+e.message);}
    console.log({changed,errors});if(errors)process.exitCode=1;
  }else if(cmd==='search')console.log(JSON.stringify(store.search(args.join(' ')),null,2));
  else if(cmd==='show'){const s=store.get(args[0]);if(!s)throw new Error('Session not found');console.log(JSON.stringify(s,null,2));}
  else throw new Error(usage);
}catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
