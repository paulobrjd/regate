// Test de bout en bout : lance le jeu dans Chromium sans écran, joue contre l'IA et capture chaque vue.
// Usage : npm run build && npm run e2e   (options : --secondes=120)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const SECONDES = +arg('secondes', 120);
const root = resolve('dist'), out = resolve('captures');
await mkdir(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = createServer(async (req, res) => {
  let p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p = join(p, 'index.html');
  try { const f = await readFile(p); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(f); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${srv.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.waitForTimeout(1500);
await page.locator('#game').screenshot({ path: join(out, '0-menu.png') });

// course rapide (banane) : 4 IA ; le bateau du joueur est confié à une IA pour boucler la course
await page.selectOption('#course', 'banane');
await page.selectOption('#met', '2');
await page.click('#goBtn');
await page.evaluate(() => window.__regate.autopilot());
const shots = [['pov', '1-cockpit'], ['chase', '2-poursuite'], ['top', '3-ciel']];
const t0 = Date.now();
let i = 0;
while ((Date.now() - t0) / 1000 < SECONDES) {
  const [v, name] = shots[i % shots.length];
  // la machine de test rend sans GPU (lent) : on avance la course pour couvrir ~2 min de régate
  await page.evaluate(v => { window.__regate.setView(v); window.__regate.advance(90); }, v);
  await page.waitForTimeout(Math.max(1000, (SECONDES * 1000) / 9));
  const st = await page.evaluate(() => { const g = window.__regate.app.g; return { t: g.t.toFixed(1), leg: g.me.leg, v: (g.me.v / 0.514444).toFixed(1), fin: g.me.fin }; });
  console.log(`[${name}] chrono ${st.t}s, bord ${st.leg}, ${st.v} nds${st.fin != null ? ', arrivé' : ''}`);
  await page.locator('#game').screenshot({ path: join(out, `${name}-${Math.floor(i / 3)}.png`) });
  i++;
}
await page.screenshot({ path: join(out, '9-page.png'), fullPage: true });
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log(`images/s (Chromium logiciel, sans GPU) : ${fps.toFixed(0)}`);
await browser.close(); srv.close();
if (errors.length) { console.error('Erreurs dans la page :\n' + errors.join('\n')); process.exit(1); }
console.log('OK, captures dans ' + out);
