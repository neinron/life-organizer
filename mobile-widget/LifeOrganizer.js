// Loads the Life Organizer summary through the authenticated HTTPS feed.
const endpoint = 'https://organizer.jaronschurer.com/summary';
const keyName = 'life-organizer-reader';
const local = FileManager.local();
const cached = local.joinPath(local.documentsDirectory(), 'life-organizer-cache.json');
if (!Keychain.contains(keyName) && !config.runsInWidget) {
  const prompt = new Alert();
  prompt.title = 'Life Organizer verbinden';
  prompt.message = 'Füge deinen persönlichen Leseschlüssel ein. Er wird im Schlüsselbund gespeichert.';
  prompt.addSecureTextField('Leseschlüssel');
  prompt.addAction('Verbinden'); prompt.addCancelAction('Abbrechen');
  if (await prompt.presentAlert() === 0) {
    const value = prompt.textFieldValue(0).trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) Keychain.set(keyName, value);
  }
}
let d;
let offline = false;
try {
  if (!Keychain.contains(keyName)) throw new Error('not configured');
  const req = new Request(endpoint);
  req.method = 'GET'; req.timeoutInterval = 15;
  req.onRedirect = () => null;
  req.headers = {'User-Agent': 'LifeOrganizer/1.0', 'Authorization': 'Bearer ' + Keychain.get(keyName)};
  const result = await req.loadJSON();
  if (req.response.statusCode !== 200 || result.error || !result.snapshot_at) throw new Error('unavailable');
  d = result;
  local.writeString(cached, JSON.stringify(d));
} catch (_) {
  offline = true;
  try { d = JSON.parse(local.readString(cached)); }
  catch (_) { d = {error: Keychain.contains(keyName) ? 'Zusammenfassung gerade nicht erreichbar.' : 'Öffne das Script einmal in Scriptable und füge den Leseschlüssel ein.'}; }
}
const w = new ListWidget();
w.backgroundColor = Color.dynamic(new Color('F6F6F8'), new Color('27272B'));
w.setPadding(16,16,16,16);
w.refreshAfterDate = new Date(Date.now()+15*60000);
const primary = Color.dynamic(new Color('1D1D1F'),new Color('F5F5F7'));
const secondary = Color.dynamic(new Color('57575E'),new Color('C2C2C8'));
const accent = Color.dynamic(new Color('0065D1'),new Color('69B5FF'));
const family=config.widgetFamily || 'large';
const big=family==='large'||family==='extraLarge';
const small=family==='small';
function text(parent,value,size,color,bold,lines) {
 const t=parent.addText(value);t.font=bold?Font.semiboldSystemFont(size):Font.systemFont(size);
 t.textColor=color;t.lineLimit=lines;return t;
}
function notion(id) {return typeof id==='string'&&/^[a-f0-9-]{32,36}$/i.test(id)?'notion://www.notion.so/'+id.replace(/-/g,''):null;}
const head=w.addStack();head.layoutHorizontally();
text(head,'Dein Überblick',small?15:18,primary,true,1);
if(!small){head.addSpacer();const df=new DateFormatter();df.locale='de_DE';df.dateFormat='dd.MM.';text(head,df.string(new Date()),18,secondary,false,1);}
w.addSpacer(12);
const notes=(d.attention||[]).slice(0,big?2:1);
for(const n of notes){
 const box=w.addStack();box.layoutVertically();const url=notion(n.id);if(url)box.url=url;
 text(box,n.label||'Wichtig',11,accent,true,1);box.addSpacer(4);
 text(box,n.text,12,primary,false,small?3:big?3:2);w.addSpacer(10);
}
if(!notes.length)text(w,d.error||'Im letzten Stand gibt es keine zusätzlichen Hinweise.',12,secondary,false,3);
if(big&&(d.updates||[]).length){text(w,'Gut zu wissen',11,secondary,true,1);w.addSpacer(4);text(w,d.updates[0],12,primary,false,2);w.addSpacer(10);}
if(big&&(d.today||[]).length){
 text(w,'Im Tagesplan',11,secondary,true,1);w.addSpacer(4);
 const task=d.today[0];const row=w.addStack();const url=notion(task.id);if(url)row.url=url;
 text(row,task.title,12,primary,false,1);
}
w.addSpacer();
const stamp=d.snapshot_at?new Date(d.snapshot_at):null;
const df=new DateFormatter();df.locale='de_DE';df.dateFormat='dd.MM. HH:mm';
text(w,stamp?'Stand: '+df.string(stamp):'Noch kein Datenstand',10,secondary,false,1);
if(offline || (stamp&&Date.now()-stamp.getTime()>12*3600000))text(w,offline ? 'Offline · letzter gespeicherter Stand' : 'Neuer Abgleich ausstehend',10,secondary,false,1);
const first=notes.find(n=>notion(n.id))||(d.today||[]).find(n=>notion(n.id));if(first)w.url=notion(first.id);
Script.setWidget(w);
if(!config.runsInWidget)await w.presentLarge();
Script.complete();
