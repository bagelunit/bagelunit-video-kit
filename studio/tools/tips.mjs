// tips.mjs · one short, non-blocking line on stderr at the step where an optional tool would help. Never changes an exit code or
// stdout. Rules: at most ONE tip per command; the same tool at most once per 7 days (brand/.tips.json); nothing when the tool
// is connected, declared or dismissed; off with BAGELUNIT_NO_TIPS=1, the flag --no-tips, or tools.tips=false in brand.json.
import fs from 'node:fs';
import path from 'node:path';
import * as S from './suggest.mjs';

export const WINDOW_DAYS = 7;
// the step that shows each tip; the first entry whose tools are all missing wins. primary = the tool named in "Dismiss:".
export const STAGES = {
  new: [
    { tools: ['blender'], primary: 'blender', text: 'Tip: Blender could make a 3D hero shot or a map for this video (video suggest blender).' },
    { tools: ['higgsfield'], primary: 'higgsfield', text: 'Tip: a generated-video tool such as Higgsfield could make a short establishing shot between chapters (video suggest higgsfield).' },
  ],
  thumbnail: [
    { tools: ['canva', 'adobe-firefly'], primary: 'canva', text: 'Tip: Canva or Adobe Firefly could design this thumbnail (video suggest canva).' },
    { tools: ['blender'], primary: 'blender', text: 'Tip: Blender could render a 3D hero object for this thumbnail (video suggest blender).' },
  ],
  render: [
    { tools: ['uppbeat', 'epidemic-sound'], primary: 'uppbeat', text: 'Tip: licensed music such as Uppbeat could give each chapter its own bed under the voice (video suggest uppbeat).' },
    { tools: ['blender'], primary: 'blender', text: 'Tip: Blender could add a 3D shot to a scene in this video (video suggest blender).' },
  ],
  voice: [
    { tools: ['elevenlabs'], primary: 'elevenlabs', text: 'Tip: a voice service such as ElevenLabs gives a natural narration voice (video suggest elevenlabs).' },
  ],
  upload: [],
};

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export function tip(stage, { dir, flags = {}, env = process.env, now = Date.now(), out = (l) => process.stderr.write(l + '\n') } = {}) {
  try {
    if (env.BAGELUNIT_NO_TIPS === '1' || flags['no-tips']) return null;
    const brand = S.findBrandDir(dir);
    if (!brand) return null;
    const mine = S.readTools(brand);
    if (mine.tips === false) return null;
    const file = path.join(brand, 'brand', '.tips.json');
    const seen = readJSON(file, {});
    const cat = S.loadCatalog(), ids = new Set(S.allTools(cat).map((t) => t.id));
    const recent = (id) => seen[id] && now - Date.parse(seen[id]) < WINDOW_DAYS * 86400000;
    for (const e of STAGES[stage] || []) {
      if (!ids.has(e.primary) || mine.dismissed.includes(e.primary) || recent(e.primary)) continue;
      if (e.tools.some((id) => mine.have.includes(id))) continue;
      const st = S.statuses(brand, cat);                      // the slower connector check runs only once a tip is otherwise due
      if (e.tools.some((id) => st[id] && st[id].status === 'connected')) continue;
      out(`${e.text} Dismiss: video suggest --dismiss ${e.primary}`);
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ ...seen, [e.primary]: new Date(now).toISOString() }, null, 2) + '\n');
      fs.renameSync(tmp, file);
      return e.primary;
    }
  } catch { /* a tip never breaks a command */ }
  return null;
}
