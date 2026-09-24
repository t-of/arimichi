// ありみちの中身（盤・アリの 1 歩・ルール文字列・保存と URL の読み書き・見本）。
// DOM には触らない。ブラウザでは main.js から、テストでは node test.mjs から読む。

export const SIZE = 160;        // 盤は SIZE × SIZE。上下・左右の端はつながっている
export const MAX_ANTS = 8;
export const MIN_RULE = 2;
export const MAX_RULE = 12;
export const TURNS = ['R', 'L', 'N', 'U'];   // 札をタップしたときに変わる順

// 向き: 0 = 上、1 = 右、2 = 下、3 = 左
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DELTA = { R: 1, L: 3, N: 0, U: 2 };

export const isRule = (s) => typeof s === 'string' && /^[RLNU]{2,12}$/.test(s);

export const SAMPLES = [
  { name: 'はじまり', rule: 'RL' },
  { name: 'ぐちゃぐちゃ', rule: 'RLR' },
  { name: '左右対称', rule: 'LLRR' },
  { name: '四角', rule: 'LRRRRRLLR' },
  { name: 'ねじれ道', rule: 'LLRRRLRLRLLR' },
  { name: '三角', rule: 'RRLLLRLLLRRR' },
  { name: 'おまかせ', rule: null },
];

// おまかせ: 3〜8 文字。R と L を必ず 1 つずつ以上含める
export function randomRule(rand = Math.random) {
  const len = 3 + Math.floor(rand() * 6);
  for (;;) {
    let s = '';
    for (let i = 0; i < len; i++) s += TURNS[Math.floor(rand() * 4)];
    if (s.includes('R') && s.includes('L')) return s;
  }
}

// 盤を全部 0 にし、アリは真ん中に上向きで 1 匹
export function newWorld(rule) {
  return {
    rule,
    turns: Uint8Array.from(rule, (ch) => DELTA[ch]),
    grid: new Uint8Array(SIZE * SIZE),
    ants: [{ x: SIZE / 2, y: SIZE / 2, d: 0 }],
    steps: 0,
  };
}

export function addAnt(w, x, y) {
  if (w.ants.length >= MAX_ANTS) return false;
  w.ants.push({ x, y, d: 0 });
  return true;
}

// 1 歩 = 置いた順に全部のアリが 1 回ずつ進む。onPaint(マスの番号, 新しい状態) で変わったマスを知らせる
export function step(w, onPaint) {
  const { grid, turns, ants } = w;
  const n = turns.length;
  for (const a of ants) {
    const i = a.y * SIZE + a.x;
    const c = grid[i];
    a.d = (a.d + turns[c]) & 3;
    const next = c + 1 === n ? 0 : c + 1;
    grid[i] = next;
    if (onPaint) onPaint(i, next);
    a.x = (a.x + DX[a.d] + SIZE) % SIZE;
    a.y = (a.y + DY[a.d] + SIZE) % SIZE;
  }
  w.steps++;
}

// ---- 保存（arimichi.state）と URL ----

export const DEFAULT_STATE = { v: 1, rule: 'RL', speed: 1, seenHelp: false };

// 保存した文字列を読む。読めない・形がおかしいところは初期値にする
export function readState(raw) {
  let o;
  try { o = JSON.parse(raw); } catch { o = null; }
  if (!o || typeof o !== 'object') return { ...DEFAULT_STATE };
  return {
    v: 1,
    rule: isRule(o.rule) ? o.rule : DEFAULT_STATE.rule,
    speed: Number.isInteger(o.speed) && o.speed >= 0 && o.speed <= 3 ? o.speed : DEFAULT_STATE.speed,
    seenHelp: o.seenHelp === true,
  };
}

// location.search の ?r= を読む。合わなければ null（無視する）
export function ruleFromSearch(search) {
  const r = new URLSearchParams(search).get('r');
  return isRule(r) ? r : null;
}

export const shareUrl = (base, rule) => `${base}?r=${rule}`;
