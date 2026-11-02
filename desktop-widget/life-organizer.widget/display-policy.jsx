import { run } from 'uebersicht';

// This invisible helper stays on the main display, even when the visible
// widget's chosen external display is unplugged. No system background job.
export const refreshFrequency = 15000;
export const render = () => null;
const id = 'life-organizer-widget-index-jsx';

export const command = (dispatch) => {
  run("/usr/bin/python3 \"$HOME/Library/Application Support/Übersicht/widgets/life-organizer.widget/lib/displays.py\"")
    .then(output => {
      const displays = JSON.parse(output);
      if (!Array.isArray(displays) || !displays.length) return;
      const external = displays.filter(d => !d.builtin).map(d => d.id).sort((a, b) => a - b)[0];
      return fetch('/state/').then(r => r.json()).then(state => {
        const current = state.settings[id];
        if (!current) return;
        const screens = external === undefined ? [] : [external];
        const main = external === undefined;
        if (current.showOnAllScreens === false && current.showOnMainScreen === main &&
            current.showOnSelectedScreens === !main && JSON.stringify(current.screens || []) === JSON.stringify(screens)) return;
        const socket = new WebSocket('ws://127.0.0.1:41416');
        socket.onopen = () => {
          socket.send(JSON.stringify({type: 'WIDGET_SETTINGS_CHANGED', payload: {id,
            settings: {...current, showOnAllScreens: false, showOnMainScreen: main,
              showOnSelectedScreens: !main, screens}}}));
          socket.close();
        };
        socket.onerror = () => socket.close();
      });
    }).then(() => dispatch({output: ''}))
    .catch(() => dispatch({output: ''}));
};
