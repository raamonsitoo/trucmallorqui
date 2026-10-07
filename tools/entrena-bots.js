'use strict';
// Entrenament dels bots: juguen milers de cantons entre ells, sense esperes, i ens quedam amb els
// paràmetres que guanyen. Cada repartiment es juga dues vegades canviant les parelles de lloc,
// així la sort de les cartes no compta.
//
//   node tools/entrena-bots.js torneig [cantons]        taula de nivells, uns contra els altres
//   node tools/entrena-bots.js dificil [rondes]         entrena el bot difícil
//   node tools/entrena-bots.js mestre [rondes]          ajusta els marges del mestre (lent)
//   node tools/entrena-bots.js variants '[{...}]'       compara variants del mestre contra el difícil
//
// Els resultats es desen a bots-entrenats.json (game.js els llegeix en arrencar).
const fs = require('fs');
const path = require('path');
const { Game, LEVELS, LEVEL_IDS, mulberry32 } = require('../game.js');

const OUT = path.join(__dirname, '..', 'bots-entrenats.json');
const clone = o => JSON.parse(JSON.stringify(o));
const room = () => ({ seats: [0, 1, 2, 3].map(() => ({ human: false })), sendAll() {}, sendSeat() {}, phase: 'playing' });

// Un cantó amb A als seients 0 i 2 i B a l'1 i el 3. Torna 1 si guanya A.
async function canton(A, B, seed) {
  const g = new Game(room(), { speed: 0, rng: mulberry32(seed * 7919 + 13), dealRng: mulberry32(seed), params: [A, B, A, B] });
  return (await g.playCanton()) === 0 ? 1 : 0;
}
// Proporció de cantons que guanya A contra B (n repartiments, cadascun jugat per les dues bandes).
async function match(A, B, n, seed0) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const s = seed0 + i;
    w += await canton(A, B, s);
    w += 1 - await canton(B, A, s);
  }
  return w / (2 * n);
}
const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
// Interval aproximat del 95% per a una proporció amb n cantons
const err = n => (100 * 1.96 * Math.sqrt(0.25 / n)).toFixed(1);

function save(part, params, note) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* nou */ }
  data[part] = params;
  data.notes = Object.assign({}, data.notes, { [part]: note });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
}

// ---------- Torneig ----------
async function torneig(n) {
  const ids = LEVEL_IDS;
  console.log(`Torneig: ${2 * n} cantons per parella de nivells (±${err(2 * n)} punts). Fila contra columna.\n`);
  console.log('            ' + ids.map(x => x.padStart(8)).join(''));
  for (const a of ids) {
    let row = a.padEnd(12);
    for (const b of ids) {
      if (a === b) { row += '       ·'; continue; }
      const t0 = Date.now(), r = await match(LEVELS[a], LEVELS[b], n, 1e6);
      row += '  ' + pct(r).trim().padStart(6);
      if (process.env.VERBOSE) console.log(`  ${a}-${b} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    console.log(row);
  }
}

// ---------- Entrenament del difícil ----------
// [nom, pas, mínim, màxim, enter?]; `envAcc.2` vol dir l'element 2 de la llista envAcc.
const SPEC = [
  ['trucBase', 0.35, 1.5, 6], ['trucStep', 0.2, 0.3, 2.5], ['raiseM', 0.35, 0, 4], ['accRand', 0.04, 0, 0.35],
  ['callM', 0.35, -1.5, 3], ['callP', 0.12, 0.1, 1], ['bluff', 0.04, 0, 0.4], ['noise', 0.25, 0, 2],
  ['trickWon', 0.3, 0, 3], ['trickLost', 0.3, 0, 3], ['wMax', 0.07, 0.4, 1], ['behind', 0.4, -2, 4], ['caughtPen', 0.15, 0, 1.2],
  ['envNoise', 0.4, 0, 3], ['envAccRand', 0.04, 0, 0.35], ['envCall', 1, 20, 33], ['envCallP', 0.12, 0.1, 1], ['envBluff', 0.04, 0, 0.4],
  ['envAcc.1', 1, 20, 33], ['envAcc.2', 1, 20, 34], ['envAcc.3', 1, 20, 35], ['envAcc.4', 1, 20, 36],
  ['envRai.1', 1, 24, 40], ['envRai.2', 1, 24, 40], ['envRai.3', 1, 24, 40],
  ['secure', 0.2, 0, 1], ['lead0', 1, 0, 2, true]
];
const getP = (o, k) => { const [a, i] = k.split('.'); return i ? o[a][+i] : o[a]; };
const setP = (o, k, v) => { const [a, i] = k.split('.'); if (i) o[a][+i] = v; else o[a] = v; };
function mutate(P, rnd, spec) {
  const Q = clone(P), k = 1 + Math.floor(rnd() * 3), changed = [];
  for (let j = 0; j < k; j++) {
    const [name, step, lo, hi, int] = spec[Math.floor(rnd() * spec.length)];
    const g = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    let v = getP(Q, name) + g * step;
    v = Math.min(hi, Math.max(lo, v));
    v = int ? Math.round(v) : Math.round(v * 1000) / 1000;
    setP(Q, name, v); changed.push(name + '=' + v);
  }
  return { Q, changed };
}

async function entrena(part, rounds, spec, start, opts) {
  const rnd = mulberry32(Date.now() % 1e9);
  let champ = clone(start), seed = 1;
  const base = LEVELS[opts.vs];
  const N = opts.n;
  let vsBase = await match(champ, base, opts.nBase, 5e6);
  console.log(`Inici: ${part} guanya el ${pct(vsBase).trim()} contra ${opts.vs} (${2 * opts.nBase} cantons)`);
  let accepted = 0;
  for (let r = 1; r <= rounds; r++) {
    const { Q, changed } = mutate(champ, rnd, spec);
    // Primer una prova curta; si promet, una de llarga amb repartiments nous
    const quick = await match(Q, champ, N, seed); seed += N;
    let ok = false, long = quick;
    if (quick > 0.5) {
      const more = await match(Q, champ, 2 * N, seed); seed += 2 * N;
      long = (quick * N + more * 2 * N) / (3 * N);
      ok = long > 0.5 + opts.edge;
    }
    // A més, no pot jugar pitjor contra un rival diferent (així no aprèn trucs que només van bé contra ell mateix)
    if (ok && opts.spar) {
      const s0 = 9e6 + r * 1000, a = await match(Q, opts.spar, opts.nSpar, s0), b = await match(champ, opts.spar, opts.nSpar, s0);
      if (a < b - 0.005) { ok = false; console.log(`ronda ${r}: ✘ guanyava l'anterior (${pct(long).trim()}) però juga pitjor contra el sparring (${pct(a).trim()} < ${pct(b).trim()})`); }
    }
    if (ok) {
      champ = Q; accepted++;
      console.log(`ronda ${r}: ✔ ${pct(long).trim()} contra l'anterior · ${changed.join(', ')}`);
      if (accepted % 4 === 0) {
        vsBase = await match(champ, base, opts.nBase, 5e6);
        console.log(`   ara guanya el ${pct(vsBase).trim()} contra ${opts.vs}`);
        save(part, champ, `${pct(vsBase).trim()} contra ${opts.vs} (${2 * opts.nBase} cantons), ${new Date().toISOString().slice(0, 10)}`);
      }
    } else if (process.env.VERBOSE) console.log(`ronda ${r}: ✘ ${pct(long).trim()} · ${changed.join(', ')}`);
  }
  vsBase = await match(champ, base, opts.nBase, 5e6);
  console.log(`Final: ${part} guanya el ${pct(vsBase).trim()} contra ${opts.vs} (±${err(2 * opts.nBase)})`);
  save(part, champ, `${pct(vsBase).trim()} contra ${opts.vs} (${2 * opts.nBase} cantons), ${new Date().toISOString().slice(0, 10)}`);
  return champ;
}

const MESTRE_SPEC = [
  ['mCall', 0.01, -0.05, 0.08], ['mAcc', 0.01, -0.06, 0.06], ['mRai', 0.01, -0.03, 0.08], ['mEnvCall', 0.01, -0.04, 0.06],
  ['bluffMc', 0.04, 0, 0.5], ['envBluffMc', 0.04, 0, 0.5], ['infer', 0.3, 0, 1]
];

(async () => {
  const [cmd = 'torneig', arg] = process.argv.slice(2);
  const t0 = Date.now();
  // Sparring: un mestre que mira menys mans (va més aviat)
  const spar = Object.assign({}, LEVELS.mestre, { mc: 12 });
  if (cmd === 'torneig') await torneig(+arg || 300);
  else if (cmd === 'dificil') await entrena('dificil', +arg || 150, SPEC, LEVELS.dificil, { vs: 'normal', n: 500, nBase: 2000, edge: 0.012, spar, nSpar: 400 });
  else if (cmd === 'variants') {
    // Prova variants del mestre contra el difícil, amb els mateixos repartiments: node tools/entrena-bots.js variants '[{"infer":0},{"bluffMc":0.15}]'
    const n = +process.env.N || 400;
    for (const v of [{}].concat(JSON.parse(arg || '[]'))) {
      const r = await match(Object.assign({}, LEVELS.mestre, v), LEVELS.dificil, n, 7e6);
      console.log(`${pct(r)}  ${JSON.stringify(v)}`);
    }
  }
  else if (cmd === 'mestre') {
    const pick = o => Object.fromEntries(MESTRE_SPEC.map(([k]) => [k, o[k]]));
    const best = await entrena('mestre', +arg || 30, MESTRE_SPEC, LEVELS.mestre, { vs: 'dificil', n: 60, nBase: 200, edge: 0.02 });
    save('mestre', pick(best), JSON.parse(fs.readFileSync(OUT, 'utf8')).notes.mestre);
  } else { console.log('Ordres: torneig | dificil | mestre'); process.exit(1); }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
})();
