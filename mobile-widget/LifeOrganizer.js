// Loads the Life Organizer summary through the authenticated HTTPS feed.
const endpoint = 'https://organizer.example.com/summary';
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

// Resolve native IDs on this iPhone. Calendar data stays on the device; no writes.
const nativeCalendarLinks=new Map();
function safeActionUrl(url) {
 if(typeof url!=='string'||/[\r\n]/.test(url))return false;
 if(/^calshow:\d{1,12}(?:\.\d+)?$/.test(url))return true;
 if(/^x-apple-calevent:\/\/[A-F0-9-]{36}\/[A-F0-9-]{36}$/i.test(url))return true;
 return /^(notion:\/\/|message:\/\/|ical:\/\/|https:\/\/(mail\.google\.com|outlook\.office\.com|outlook\.live\.com)\/)/i.test(url);
}
function nativeAction(action) {
 if(!action||!safeActionUrl(action.url))return null;
 return nativeCalendarLinks.get(JSON.stringify(action.calendar))||action.url;
}
async function resolveCalendarLinks(data) {
 const actions=(data.sections||[]).filter(s=>!Array.isArray(s.surfaces)||s.surfaces.includes('mobile')).flatMap(s=>s.items||[]).map(i=>i.action).filter(a=>a&&a.calendar&&/^calshow:/.test(a.url));
 if(!actions.length)return;
 let calendars;
 try {calendars=await Calendar.forEvents();}catch(_){return;}
 for(const action of actions) {
  const event=action.calendar,key=JSON.stringify(event);
  if(nativeCalendarLinks.has(key))continue;
  const start=new Date(event.start),end=new Date(event.end);
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>32*86400000)continue;
  const selected=calendars.filter(c=>c.title===event.calendar_title);
  if(!selected.length)continue;
  try {
   const events=await CalendarEvent.between(new Date(+start-1000),new Date(+end+1000),selected);
   const found=events.filter(e=>e.title===event.title&&+e.startDate===+start&&+e.endDate===+end);
   if(found.length!==1)continue;
   const e=found[0],uuid=/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i;
   if(uuid.test(e.calendar.identifier)&&uuid.test(e.identifier))nativeCalendarLinks.set(key,'x-apple-calevent://'+e.calendar.identifier+'/'+e.identifier);
  }catch(_){} // Missing permission, missing sync or ambiguity: open the verified date.
 }
}
await resolveCalendarLinks(d);

const w = new ListWidget();
const lockFamily = config.widgetFamily || '';
const accessory = lockFamily.startsWith('accessory');
if (accessory) {
  w.setPadding(4, 4, 4, 4);
  w.backgroundColor = new Color('000000', 0);
  w.addAccessoryWidgetBackground = lockFamily !== 'accessoryInline';
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  const notes = (d.sections || []).filter(section => !Array.isArray(section.surfaces) || section.surfaces.includes('mobile')).flatMap(section => section.items || []);
  const item = notes[0];
  const isDecision = item && item.severity === 'critical';
  const iconName = offline ? 'arrow.clockwise' : isDecision ? 'exclamationmark.circle.fill' : notes.length ? 'sparkle' : 'checkmark.circle';
  const symbol = SFSymbol.named(iconName);
  const ink = Color.white();
  const stamp = d.snapshot_at ? new Date(d.snapshot_at) : null;
  const stale = offline || !stamp || Date.now() - stamp.getTime() > 12 * 3600000;
  const label = stale ? 'Letzter Stand' : isDecision ? 'Entscheidung offen' : notes.length ? 'Jetzt wichtig' : 'Dein Tag';
  const message = d.error ? 'Organizer einmal öffnen' : item ? (item.mobile_text || item.text || item.title) : 'Keine offenen Hinweise';
  function lockText(parent, value, size, bold, lines) {
    const t = parent.addText(value); t.textColor = ink;
    t.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
    t.lineLimit = lines; return t;
  }
  if (lockFamily === 'accessoryInline') {
    w.addImage(symbol.image);
    lockText(w, notes.length ? notes.length + ' Hinweise · ' + (isDecision ? 'Entscheidung offen' : 'Organizer') : 'Organizer · ' + (stale ? 'Stand prüfen' : 'Alles im Blick'), 12, false, 1);
  } else if (lockFamily === 'accessoryCircular') {
    w.addSpacer();
    const number = lockText(w, d.error ? '–' : String(notes.length), 26, true, 1); number.centerAlignText();
    const caption = lockText(w, stale ? 'Stand prüfen' : 'Hinweise', 9, true, 1); caption.centerAlignText();
    w.addSpacer();
  } else {
    const row = w.addStack(); row.layoutHorizontally(); row.topAlignContent();
    const image = row.addImage(symbol.image); image.imageSize = new Size(18, 18); image.tintColor = ink;
    row.addSpacer(6);
    const copy = row.addStack(); copy.layoutVertically();
    lockText(copy, label, 11, true, 1); copy.addSpacer(2);
    lockText(copy, message, 12, false, 2);
    if (stamp && stale) {
      const df = new DateFormatter(); df.locale='de_DE'; df.dateFormat='dd.MM. HH:mm';
      copy.addSpacer(2); lockText(copy, df.string(stamp), 9, false, 1);
    }
  }
  if (item && typeof item.id === 'string' && /^[a-f0-9-]{32,36}$/i.test(item.id)) w.url = 'notion://www.notion.so/' + item.id.replace(/-/g, '');
  const target = nativeAction(item && item.action);
  if (safeActionUrl(target)) w.url = target;
} else {
w.backgroundColor = Color.dynamic(new Color('F6F6F8'), new Color('27272B'));
w.setPadding(20,20,20,20);
w.refreshAfterDate = new Date(Date.now()+15*60000);
const primary = Color.dynamic(new Color('1D1D1F'),new Color('F5F5F7'));
const secondary = Color.dynamic(new Color('57575E'),new Color('C2C2C8'));
const accent = Color.dynamic(new Color('0065D1'),new Color('69B5FF'));
const family=config.widgetFamily || 'large';
const big=family==='large'||family==='extraLarge';
const small=family==='small';
function text(parent,value,size,color,bold,lines) {
 const t=parent.addText(value);t.font=bold?Font.semiboldSystemFont(size):Font.systemFont(size);
 t.textColor=color;t.lineLimit=lines;t.leftAlignText();return t;
}
function richHint(parent, label, body, severity, lines, prepared) {
 const screen=Device.screenSize();
 const short=Math.round(Math.min(screen.width,screen.height));
 const widths={375:329,390:338,393:338,402:346,414:360,428:364,430:364,440:376};
 const widgetWidth=widths[short] || short-56;
 const width=small?Math.max(100,(widgetWidth-16)/2-40):Math.max(240,widgetWidth-40);
 const height=lines*16;
 const drawing=new DrawContext();drawing.size=new Size(width,height);
 drawing.opaque=false;drawing.respectScreenScale=true;
 drawing.setFont(Font.systemFont(13));drawing.setTextAlignedLeft();
 const rect=new Rect(0,0,width,height);
 drawing.setTextColor(primary);
 const prefix=label?label+': ':'';
 drawing.drawTextInRect(prepared || prefix+body,rect);
 const warning=severity==='warning';
 const tone=severity==='neutral'?secondary:severity==='critical'?Color.dynamic(new Color('B42318'),new Color('FF8A80')):warning?Color.dynamic(new Color('9A4D00'),new Color('FFC078')):accent;
 drawing.setTextColor(tone);
 if(prefix)drawing.drawTextInRect(prefix,rect);
 const image=parent.addImage(drawing.getImage());image.imageSize=new Size(width,height);
 image.resizable=false;image.leftAlignImage();image.applyFittingContentMode();
}
function notion(id) {return typeof id==='string'&&/^[a-f0-9-]{32,36}$/i.test(id)?'notion://www.notion.so/'+id.replace(/-/g,''):null;}
const head=w.addStack();head.layoutHorizontally();head.centerAlignContent();
text(head,'Dein Überblick',small?15:20,primary,true,1);
if(!small){
 head.addSpacer();const status=head.addStack();status.layoutHorizontally();status.centerAlignContent();
 const icon=status.addImage(SFSymbol.named('clock.arrow.circlepath').image);icon.imageSize=new Size(12,12);icon.tintColor=secondary;
 status.addSpacer(4);
 const df=new DateFormatter();df.locale='de_DE';df.dateFormat='dd.MM. – HH:mm';
 const source=d.board_at||d.snapshot_at;
 let stampLabel='Kein Stand';
 if(source){const stamp=new Date(source);const now=new Date();const day=x=>Date.UTC(x.getFullYear(),x.getMonth(),x.getDate());const age=Math.round((day(now)-day(stamp))/86400000);
 if(age===0||age===1){df.dateFormat='HH:mm';stampLabel=(age===0?'':'Gestern – ')+df.string(stamp);}else stampLabel=df.string(stamp);}
 text(status,stampLabel,11,secondary,false,1);
}
w.addSpacer(14);
if (Array.isArray(d.sections) && d.sections.length) {
 const screen=Device.screenSize();const short=Math.round(Math.min(screen.width,screen.height));
 const widths={375:329,390:338,393:338,402:346,414:360,428:364,430:364,440:376};
 const outerWidth=widths[short]||short-56;
 const innerWidth=small?Math.max(100,(outerWidth-16)/2-40):Math.max(240,outerWidth-40);
 const compactHeights={375:155,390:158,393:158,402:162,414:169,428:170,430:170,440:174};
 const compactHeight=compactHeights[short]||158;
 const widgetHeight=big?compactHeight*2+38:compactHeight;
 // Header 24pt, header gap 14pt, outer padding 40pt. The remainder belongs to content.
 const capacity=widgetHeight-78;
 const candidates=[];
 for(const [sectionIndex,section] of d.sections.entries()) {
  if(Array.isArray(section.surfaces)&&!section.surfaces.includes('mobile'))continue;
  for(const [itemIndex,item] of (section.items||[]).entries()) {
   const label=item.mobile_label||item.label||'';
   const prefix=itemIndex===0&&section.title?(label&&label!==section.title?section.title+' · '+label:section.title):label;
   candidates.push({item,sectionIndex,prefix,short:item.mobile_text||item.text,full:item.text});
  }
 }
 const measurer=new WebView();await measurer.loadHTML('<html><body></body></html>');
 const metrics=await measurer.evaluateJavaScript('('+function(input){
  const ctx=document.createElement('canvas').getContext('2d');ctx.font='13px -apple-system';
  function wrap(value){
   const words=value.split(/\s+/);const lines=[];let line='';
   for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>input.width){lines.push(line);line=word;}else line=next;}
   if(line)lines.push(line);return lines.length?lines:[''];
  }
  return input.rows.map(row=>({short:wrap((row.prefix?row.prefix+': ':'')+row.short),full:wrap((row.prefix?row.prefix+': ':'')+row.full)}));
 }.toString()+')('+JSON.stringify({width:innerWidth,rows:candidates})+')');
 const selected=[];let used=0,lastSection=null;
 for(let i=0;i<candidates.length;i++) {
  const c=candidates[i];const gap=selected.length?(c.sectionIndex===lastSection?8:14.5):0;
  const available=Math.floor((capacity-used-gap)/16);if(available<1)break;
  const count=Math.min(metrics[i].short.length,available);
  selected.push({...c,index:i,lines:metrics[i].short.slice(0,count),gap,truncated:count<metrics[i].short.length});
  used+=gap+count*16;lastSection=c.sectionIndex;
 }
 // Expand short versions with original source text whenever there is unused room.
 for(const entry of selected) {
  const full=metrics[entry.index].full;
  const extra=Math.floor((capacity-used)/16);
  const count=Math.min(full.length,entry.lines.length+extra);
  if(count>=entry.lines.length && (count===full.length || count>entry.lines.length)) {
   used+=(count-entry.lines.length)*16;entry.lines=full.slice(0,count);entry.truncated=count<full.length;
  }
 }
 for(const entry of selected) {
  if(entry.gap===14.5){w.addSpacer(6);const line=w.addStack();line.backgroundColor=Color.dynamic(new Color('D1D1D6'),new Color('48484A'));line.size=new Size(0,.5);line.addSpacer();w.addSpacer(8);}
  else if(entry.gap)w.addSpacer(entry.gap);
  const row=w.addStack();row.layoutVertically();
  const url=nativeAction(entry.item.action);
  if(safeActionUrl(url))row.url=url;
  if(entry.truncated){const last=entry.lines.length-1;entry.lines[last]=entry.lines[last].replace(/[.,;:]?\s*$/,'')+'…';}
  richHint(row,entry.prefix,entry.item.text,entry.item.severity,entry.lines.length,entry.lines.join('\n'));
 }

} else {
 text(w,d.error||'Keine Einträge in der letzten Übersicht.',13,secondary,false,3);
}
}
if (!accessory) {const first=(d.sections||[]).filter(section=>!Array.isArray(section.surfaces)||section.surfaces.includes('mobile')).flatMap(section=>section.items||[]).find(item=>nativeAction(item.action));if(first)w.url=nativeAction(first.action);}
Script.setWidget(w);
if(!config.runsInWidget)await w.presentLarge();
Script.complete();
