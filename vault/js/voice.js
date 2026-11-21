/* Voice for the vault viewer: the browser's own speech recognition (Chrome,
   Edge, Safari; not Firefox), a fixed command grammar instead of JARVIS's
   local language model, and short spoken replies. Recognition pauses while a
   reply is spoken so it never hears itself (the speech.js rule). */
(function (global) {
  'use strict';
  const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
  const NUMS = { one: '1', two: '2', three: '3', four: '4', first: '1', second: '2', third: '3', won: '1', to: '2', too: '2' };
  const STOP = new Set(['the', 'a', 'an', 'me', 'show', 'open', 'isolate', 'take', 'out', 'on', 'in', 'into',
    'zoom', 'go', 'to', 'please', 'jarvis', 'look', 'at', 'focus', 'select', 'pull', 'up', 'of', 'it', 'and']);
  const ALIAS = { head: 'intake nose', front: 'intake nose', tail: 'tail dock kit', back: null,
    body: 'common unit', segment: 'common unit' };

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => NUMS[w] || w);

  function findNode(asm, words) {
    let want = words.filter((w) => !STOP.has(w));
    if (!want.length) return null;
    const phrase = want.join(' ');
    for (const [k, v] of Object.entries(ALIAS)) if (v && phrase === k) want = norm(v);
    let best = null, bestScore = 0;
    for (const n of asm.nodes.values()) {
      if (!n.name) continue;
      const nw = norm(n.name);
      let hit = 0;
      for (const w of want) if (nw.includes(w) || nw.some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)))) hit++;
      if (!hit) continue;
      // cover what was said, prefer subassemblies, then shorter names
      const score = hit / want.length + hit / nw.length * 0.3 + (n.kind !== 'part' ? 0.15 : 0);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return bestScore >= 0.5 ? best : null;
  }

  class Voice {
    constructor(viewer, { onHeard, onState }) {
      this.viewer = viewer; this.onHeard = onHeard || (() => {}); this.onState = onState || (() => {});
      this.on = false; this.speaking = false; this.rec = null; this.lastStart = 0;
      this.talk = true;
    }
    get supported() { return !!SR; }

    say(text) {
      this.onHeard(null, text);
      if (!this.talk || !global.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 0.9;
      const v = speechSynthesis.getVoices().find((x) => /en-GB/.test(x.lang) && /Daniel|Arthur|Male/i.test(x.name))
        || speechSynthesis.getVoices().find((x) => /en-GB/.test(x.lang));
      if (v) u.voice = v;
      this.speaking = true;
      try { this.rec && this.rec.abort(); } catch (_) {}
      u.onend = u.onerror = () => { this.speaking = false; this._arm(); };
      speechSynthesis.speak(u);
    }

    start() {
      if (!SR) return false;
      this.on = true;
      this._arm();
      this.onState(true);
      return true;
    }
    stop() {
      this.on = false;
      try { this.rec && this.rec.abort(); } catch (_) {}
      this.onState(false);
    }

    _arm() {
      if (!this.on || this.speaking) return;
      const now = performance.now();
      if (now - this.lastStart < 800) { setTimeout(() => this._arm(), 900); return; }
      this.lastStart = now;
      const rec = new SR();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) this.command(e.results[i][0].transcript);
        }
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.stop(); this.onHeard(null, 'Microphone blocked. Allow it in the address bar.'); } };
      rec.onend = () => { if (this.rec === rec) this._arm(); };
      this.rec = rec;
      try { rec.start(); } catch (_) {}
    }

    command(text) {
      this.onHeard(text, null);
      const v = this.viewer, asm = v.asm;
      const w = norm(text), s = ' ' + w.join(' ') + ' ';
      const has = (...xs) => xs.some((x) => s.includes(' ' + x + ' '));
      if (!asm || !asm.ready) return this.say('Still loading.');
      if (has('explode', 'exploded', 'apart', 'break it apart', 'take it apart', 'blow it up')) { asm.op({ op: 'explode' }); return this.say('Exploded.'); }
      if (has('assemble', 'reassemble', 'put it back', 'put it together', 'together', 'close it')) { asm.op({ op: 'reassemble' }); return this.say('Reassembled.'); }
      if (has('reset', 'reset view', 'home', 'start over')) { asm.op({ op: 'reassemble' }); v.reset(); return this.say('View reset.'); }
      if (has('go back', 'back', 'undo', 'previous')) { asm.op({ op: 'back' }); return this.say('Back.'); }
      if (has('spin', 'rotate', 'turntable')) { v.spin = true; return this.say('Rotating.'); }
      if (has('stop', 'hold', 'freeze', 'stay')) { v.spin = false; return this.say('Holding.'); }
      if (has('zoom in', 'closer')) { v.targetDistance = Math.max(0.2, v.targetDistance * 0.7); return; }
      if (has('zoom out', 'further', 'farther')) { v.targetDistance = Math.min(5.5, v.targetDistance / 0.7); return; }
      if (has('help', 'what can you do', 'commands')) return this.say('Say explode, put it back, show the nose, show the tail, show unit two, rotate, stop, or reset.');
      const node = findNode(asm, w);
      if (node) { asm.op({ op: 'isolate', id: node.id }); return this.say(node.name.charAt(0).toUpperCase() + node.name.slice(1) + '.'); }
      this.say("I didn't catch a part name. Try: show the nose.");
    }
  }
  global.VaultVoice = Voice;
})(window);
