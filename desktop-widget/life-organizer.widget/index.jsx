import { run } from 'uebersicht';

// Desktop presentation informed by Apple HIG: Widgets and Materials.
// CSS approximation of system materials; this is not a WidgetKit extension.
export const command = "/usr/bin/python3 \"$HOME/Library/Application Support/Übersicht/widgets/life-organizer.widget/lib/data.py\"";
export const refreshFrequency = 60000;
export const initialState = { output: '' };
let chat = '';
const openChat = () => {
  if (/^codex:\/\/threads\/[a-f0-9-]{36}$/i.test(chat)) return run("/usr/bin/open '" + chat + "'");
};

export const className = `
  top: 16px; left: 16px; width: 344px;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased; color-scheme: light dark;
  box-sizing: border-box; -webkit-user-select: none; user-select: none;
  --primary: #1d1d1f; --secondary: #57575e; --tertiary: #66666e;
  --accent: #0065d1; --separator: rgba(60,60,67,.15);
  --material: #f6f6f8; --edge: rgba(255,255,255,.72);
  --control: rgba(255,255,255,.66); --control-hover: rgba(255,255,255,.92);
  color: var(--primary);
  .surface { max-height: calc(100vh - 64px); overflow-y: auto; box-sizing: border-box; padding: 20px; border-radius: 24px;
    background: var(--material); border: 1px solid var(--edge);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: 0 3px 14px rgba(0,0,0,.12), inset 0 0 0 .5px rgba(0,0,0,.035); }
  header { display: flex; align-items: center; gap: 8px; color: var(--secondary); }
  .notice { display: block; color: inherit; text-decoration: none; padding: 12px; margin: 0 -12px; }
  .notice + .notice { border-top: 0; }
  a.notice { border-radius: 10px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  a.notice:hover { background: var(--control); }
  a.notice:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .notice-label { font-size: 12px; font-weight: 600; color: var(--accent); margin-bottom: 4px; }
  .notice p, .update { font-size: 13px; line-height: 19px; margin: 0; }
  .update { color: var(--secondary); margin: 8px 0 0; }
  .app-icon { width: 15px; height: 15px; color: var(--accent); flex-shrink: 0; }
  .app-name { font-size: 12px; line-height: 17px; font-weight: 600; }
  .heading { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0; }
  h1 { font-size: 22px; line-height: 27px; letter-spacing: -.4px; font-weight: 700; margin: 0; }
  .date { font-size: 22px; line-height: 27px; letter-spacing: -.4px; font-weight: 500; color: var(--secondary); white-space: nowrap; }
  section { margin-top: 4px; }
  h2 { font-size: 12px; line-height: 17px; font-weight: 600;
    color: var(--secondary); margin: 0 0 8px; }
  .row { display: flex; gap: 12px; padding: 8px 12px; margin: 0 -12px; align-items: flex-start; }
  a.row { color: inherit; text-decoration: none; border-radius: 10px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  a.row:hover { background: var(--control); }
  a.row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row + .row { border-top: 0; }
  .time { width: 42px; flex: 0 0 42px; color: var(--secondary);
    font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums;
    line-height: 17px; white-space: pre-line; }
  .title { font-size: 13px; line-height: 17px; font-weight: 500;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .empty { font-size: 13px; color: var(--secondary); line-height: 20px; padding: 8px 0; }
  .due-section { border-top: .5px solid var(--separator); margin-top: 12px; padding-top: 16px; }
  .freshness { margin-top: 16px; font-size: 11px; line-height: 16px; color: var(--tertiary); }
  .freshness strong { font-weight: 400; }
  .stale { color: var(--secondary); }
  button { width: 100%; min-height: 32px; display: flex; align-items: center;
    justify-content: center; gap: 8px; margin-top: 12px; border: .5px solid var(--separator);
    padding: 8px 12px; box-sizing: border-box; background: var(--control); color: var(--accent);
    border-radius: 999px; font-family: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: background .15s; }
  button:hover { background: var(--control-hover); }
  button:active { opacity: .72; }
  button:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  .arrow { font-size: 13px; font-weight: 500; }
  @media (prefers-color-scheme: dark) {
    --primary: #f5f5f7; --secondary: #c2c2c8; --tertiary: #b1b1b8;
    --accent: #69b5ff; --separator: rgba(235,235,245,.16);
    --material: #27272b; --edge: rgba(255,255,255,.16);
    --control: rgba(255,255,255,.09); --control-hover: rgba(255,255,255,.15);
  }
  @media (prefers-reduced-transparency: reduce) {
    --material: #f2f2f7;
    .surface { -webkit-backdrop-filter: none; backdrop-filter: none; }
  }
  @media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) {
    --material: #2c2c2e;
  }
  @media (prefers-contrast: more) {
    --secondary: var(--primary); --tertiary: var(--primary);
    --separator: currentColor;
    .surface { border-color: var(--primary); }
  }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

function label(value, deadline) {
  if (!value) return '–';
  const d = new Date(value);
  if (deadline) {
    const day = d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit' });
    return value.length === 10 ? day : day + '\n' + d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
  }
  if (value.length === 10) return 'Heute';
  return d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
}

export const render = ({ output, error }) => {
  let d;
  try { d = JSON.parse(output || '{}'); } catch (_) { d = { error: 'Daten werden aktualisiert.' }; }
  chat = d.chat || '';
  const placement = d.external_display ? {position: 'fixed', top: 16, left: 16, right: 'auto', width: 344, boxSizing: 'border-box'} : {};
  return <div className="surface" style={placement}>
    <div className="heading"><h1>Dein Überblick</h1><span className="date">{new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
    {(d.attention || []).length > 0 && <section aria-label="Braucht deine Aufmerksamkeit">
      {d.attention.map((item, i) => <a className="notice" key={item.id || i}
        href={item.id ? 'notion://www.notion.so/' + item.id.replace(/[^a-fA-F0-9]/g, '') : '#'}
        onClick={event => { event.preventDefault(); if (item.id) run("/usr/bin/open -a Notion 'notion://www.notion.so/" + item.id.replace(/[^a-fA-F0-9]/g, '') + "'"); else openChat(); }}>
        <div className="notice-label">{item.label}</div><p>{item.text}</p>
      </a>)}
    </section>}
    {(d.updates || []).length > 0 && <section className="due-section"><h2>Gut zu wissen</h2>
      {d.updates.map((text, i) => <p className="update" key={i}>{text}</p>)}
    </section>}
    <section className="due-section" aria-label="Heutige Aufgaben"><h2>Im Tagesplan</h2>
      {(d.today || []).length ? d.today.map(t => <a className="row" key={t.id} href={"notion://www.notion.so/" + t.id.replace(/[^a-fA-F0-9]/g, "")} onClick={event => { event.preventDefault(); run("/usr/bin/open -a Notion 'notion://www.notion.so/" + t.id.replace(/[^a-fA-F0-9]/g, "") + "'"); }} aria-label={t.title + " in Notion öffnen"}>
        <span className="time">{label(t.start)}</span><span className="title" title={t.title}>{t.title}</span>
      </a>) : <div className="empty">{d.error || (error ? 'Organizer-Daten gerade nicht lesbar.' : output ? 'Keine Aufgaben im gespeicherten Tagesplan.' : 'Organizer wird geladen …')}</div>}
    </section>
    <div className="freshness"><strong>Aufgabenstand: {d.snapshot_label || 'wird geladen'}</strong><br/>
      <span>Hinweise aus dem letzten gespeicherten Abgleich.</span>{d.stale && <span className="stale"><br/>Neuer Abgleich ausstehend</span>}
    </div>
    <button onClick={openChat} aria-label="Life-Organizer-Chat in der App öffnen"><span>Im Chat öffnen</span><span className="arrow">↗</span></button>
  </div>;
};
