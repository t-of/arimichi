// 画面と操作。中身（盤・アリの 1 歩・ルール・保存と URL の読み書き）は ant.js にある。
import {
  SIZE, MAX_ANTS, MIN_RULE, MAX_RULE, TURNS, SAMPLES, randomRule, newWorld, addAnt, step, readState, ruleFromSearch, shareUrl,
} from './ant.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'arimichi.' で始める。
const STORE = 'arimichi.';

function loadRaw(key) {
  try { return localStorage.getItem(STORE + key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'ありみち', text: '右か左に曲がるだけのアリが、歩くたびにマスの色を変えて模様を描く。曲がり方のルールを変えると、渦・左右対称・三角など、まったく違う形が育つ。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- ここからアプリ本体 ----

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('ja-JP');

// 状態 0 は背景に近い色、1 からは隣どうしで明るさと色合いが大きく変わる並び。アリの色（#ff7a45）とは重ねない
const PALETTE = ['#181c24', '#f2ead8', '#3d7bd9', '#f5c84c', '#7a4fc9', '#5fd08a', '#d6457a', '#4fd1d9', '#8a5a3c', '#b8e05a', '#5a6b8c', '#ff9fc0'];
const ANT = '#ff7a45';
// ImageData に書くための 32 bit 値（リトルエンディアンなので ABGR の順）
const PAL32 = PALETTE.map((h) => (0xff << 24 | parseInt(h.slice(5, 7), 16) << 16 | parseInt(h.slice(3, 5), 16) << 8 | parseInt(h.slice(1, 3), 16)) >>> 0);

const LABEL = { R: '右', L: '左', N: '直', U: '戻' };
const RATE = [7.5, 120, 3000, 60000];   // 1 秒あたりの歩数
const MAX_PER_FRAME = 2000;             // 1 フレームで進める歩数の上限（画面を固めない）

const state = readState(loadRaw('state'));
const store = () => save('state', state);
state.rule = ruleFromSearch(location.search) || state.rule;   // URL の ?r= は保存したルールより優先

// ---- 音 ----
// 音声ファイルは使わず Web Audio で作る。オン・オフは 'arimichi.sound' に覚える
let soundOn = loadRaw('sound') !== 'false';

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(on) {
  try { if (navigator.audioSession) navigator.audioSession.type = on ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
setAudioSession(soundOn);

let actxAudio = null, master = null, lastSound = 0;
// ブラウザは触る前の音を止めるので、AudioContext は最初に触ったときに作る
function unlockAudio() {
  if (!soundOn) return;
  setAudioSession(true);
  if (!actxAudio) {
    try { actxAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = actxAudio.createGain();
    master.gain.value = 0.5;
    master.connect(actxAudio.destination);
  }
  if (actxAudio.state === 'suspended') actxAudio.resume();
}
addEventListener('pointerdown', unlockAudio, true);
addEventListener('keydown', unlockAudio, true);

// 短い音を 1 つ。notes = [[周波数, 開始の遅れ(秒)], …]
function tone(notes, { dur = 0.12, type = 'sine', gain = 0.08 } = {}) {
  if (!soundOn || !actxAudio) return;   // resume() の途中でも予約しておけば、動き出したときに鳴る
  const now = actxAudio.currentTime;
  if (now - lastSound < 0.04) return;   // 連打・キーの押しっぱなしで重ねない
  lastSound = now;
  for (const [f, at = 0] of notes) {
    const t = now + at;
    const o = actxAudio.createOscillator(), g = actxAudio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}
// 札の音の高さ: 状態 k ごとに五音音階を上っていく
const PENTA = [0, 2, 4, 7, 9];
const scale = (k) => 523.25 * 2 ** ((PENTA[k % 5] + 12 * Math.floor(k / 5)) / 12);
const sfx = {
  play: () => tone([[523.25], [783.99, 0.07]], { dur: 0.14, type: 'triangle' }),
  pause: () => tone([[659.25], [440, 0.07]], { dur: 0.14, type: 'triangle' }),
  step: () => tone([[1318.5]], { dur: 0.04, gain: 0.05 }),
  reset: () => tone([[784], [587.33, 0.05], [392, 0.1]], { dur: 0.12, type: 'triangle', gain: 0.06 }),
  card: (k) => tone([[scale(k)]], { dur: 0.1, type: 'triangle' }),
  add: () => tone([[scale(0)], [scale(2), 0.05]], { dur: 0.09, type: 'triangle', gain: 0.07 }),
  remove: () => tone([[scale(2)], [scale(0), 0.05]], { dur: 0.09, type: 'triangle', gain: 0.07 }),
  sample: () => tone([[523.25], [659.25, 0.06], [783.99, 0.12], [1046.5, 0.18]], { dur: 0.2, type: 'triangle', gain: 0.05 }),
  speed: (n) => tone([[440 * 2 ** (n * 4 / 12)]], { dur: 0.06, gain: 0.06 }),
  ant: () => tone([[880], [1174.66, 0.035]], { dur: 0.06, gain: 0.06 }),
  full: () => tone([[196], [185, 0.08]], { dur: 0.14, type: 'square', gain: 0.03 }),
};

function renderSound() {
  $('soundBtn').setAttribute('aria-pressed', String(soundOn));
  $('soundBtn').setAttribute('aria-label', soundOn ? '音: オン' : '音: オフ');
  $('soundIcon').innerHTML = soundOn
    ? '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.3 6a8.5 8.5 0 0 1 0 12"/>'
    : '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9.5 5 5m0-5-5 5"/>';
}
$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  save('sound', soundOn);
  setAudioSession(soundOn);
  renderSound();
  if (soundOn) { unlockAudio(); sfx.speed(1); }
});
renderSound();

// ---- 盤の描画 ----
// 盤は 1 マス = 1 点の Canvas を CSS で拡大する。変わったマスだけ ImageData に書き、その範囲だけ画面に出す
const cells = $('cells');
const cctx = cells.getContext('2d');
const img = cctx.createImageData(SIZE, SIZE);
const px = new Uint32Array(img.data.buffer);
let dirty = null;   // [x0, y0, x1, y1]

function paint(i, c) {
  px[i] = PAL32[c];
  const x = i % SIZE, y = (i - x) / SIZE;
  if (!dirty) dirty = [x, y, x, y];
  else {
    if (x < dirty[0]) dirty[0] = x; else if (x > dirty[2]) dirty[2] = x;
    if (y < dirty[1]) dirty[1] = y; else if (y > dirty[3]) dirty[3] = y;
  }
}

// アリは別の Canvas に、画面の解像度で向きの分かる三角として描く
const antsCanvas = $('ants');
const actx = antsCanvas.getContext('2d');
function drawAnts() {
  const W = antsCanvas.width;
  actx.clearRect(0, 0, W, W);
  const cs = W / SIZE;
  const dpr = devicePixelRatio || 1;
  const r = Math.max(cs * 1.6, 8 * dpr);
  actx.fillStyle = ANT;
  actx.strokeStyle = '#0f1115';
  actx.lineWidth = 1.5 * dpr;
  actx.lineJoin = 'round';
  for (const a of world.ants) {
    const ang = a.d * Math.PI / 2;   // 0 = 上
    const cx = (a.x + 0.5) * cs, cy = (a.y + 0.5) * cs;
    const pt = (t, k) => [cx + Math.sin(ang + t) * r * k, cy - Math.cos(ang + t) * r * k];
    actx.beginPath();
    actx.moveTo(...pt(0, 1));
    actx.lineTo(...pt(2.5, 0.85));
    actx.lineTo(...pt(-2.5, 0.85));
    actx.closePath();
    actx.fill();
    actx.stroke();
  }
}

function draw() {
  if (dirty) {
    const [x0, y0, x1, y1] = dirty;
    cctx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    dirty = null;
  }
  drawAnts();
  $('steps').textContent = fmt(world.steps);
  $('antCount').textContent = world.ants.length;
}

new ResizeObserver(() => {
  const w = Math.round(cells.getBoundingClientRect().width * (devicePixelRatio || 1));
  if (w > 0 && w !== antsCanvas.width) { antsCanvas.width = antsCanvas.height = w; drawAnts(); }
}).observe(cells);

// ---- 動かす ----
let world;
let playing = false;
let acc = 0, last = 0;

function restart(rule) {
  state.rule = rule;
  store();
  world = newWorld(rule);
  px.fill(PAL32[0]);
  dirty = [0, 0, SIZE - 1, SIZE - 1];
  acc = 0;
  renderRule();
  draw();
}

function frame(t) {
  if (!playing) return;
  acc += RATE[state.speed] * Math.min((t - last) / 1000, 0.1);   // 裏に回って戻ったときにまとめて進めない
  last = t;
  const n = Math.min(Math.floor(acc), MAX_PER_FRAME);
  acc = Math.min(acc - n, 1);
  for (let i = 0; i < n; i++) step(world, paint);
  if (n) draw();
  requestAnimationFrame(frame);
}

function setPlaying(on) {
  if (on === playing) return;
  playing = on;
  $('play').textContent = on ? '⏸' : '▶';
  $('play').setAttribute('aria-label', on ? '止める' : '再生');
  if (on) requestAnimationFrame((t) => { last = t; frame(t); });
}

function toggle() {
  setPlaying(!playing);
  (playing ? sfx.play : sfx.pause)();
}
$('play').addEventListener('click', toggle);
$('step').addEventListener('click', () => { setPlaying(false); step(world, paint); draw(); sfx.step(); });
$('reset').addEventListener('click', () => { restart(state.rule); sfx.reset(); });

function renderSpeed() {
  for (const b of $('speed').children) b.setAttribute('aria-pressed', String(+b.dataset.speed === state.speed));
}
$('speed').addEventListener('click', (e) => {
  const b = e.target.closest('[data-speed]');
  if (!b) return;
  state.speed = +b.dataset.speed;
  acc = 0;
  store();
  renderSpeed();
  sfx.speed(state.speed);
});

// 盤をタップするとアリを足す。なぞったときはスクロールになり click は来ない
$('board').addEventListener('click', (e) => {
  const r = cells.getBoundingClientRect();
  const x = Math.min(SIZE - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * SIZE)));
  const y = Math.min(SIZE - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * SIZE)));
  if (addAnt(world, x, y)) sfx.ant();
  else { WebAppKit.toast(`アリは ${MAX_ANTS} 匹まで`); sfx.full(); }
  draw();
});

// ---- ルールの札と見本 ----
function renderRule() {
  const rule = state.rule;
  $('ruleText').textContent = rule;
  const cards = [...rule].map((ch, k) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.dataset.k = k;
    b.setAttribute('aria-label', `色 ${k + 1}: ${LABEL[ch]}`);
    b.innerHTML = `<span class="card__swatch" style="background:${PALETTE[k]}"></span>${LABEL[ch]}`;
    return b;
  });
  const plus = Object.assign(document.createElement('button'), { className: 'card card--op', textContent: '＋', disabled: rule.length >= MAX_RULE });
  plus.dataset.op = '+';
  plus.setAttribute('aria-label', '札を足す');
  const minus = Object.assign(document.createElement('button'), { className: 'card card--op', textContent: '−', disabled: rule.length <= MIN_RULE });
  minus.dataset.op = '-';
  minus.setAttribute('aria-label', '最後の札を消す');
  $('cards').replaceChildren(...cards, plus, minus);
  for (const b of $('samples').children) b.setAttribute('aria-pressed', String(b.dataset.rule === rule));
}

$('cards').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const rule = state.rule;
  if (b.dataset.op === '+') { restart(rule + 'R'); sfx.add(); }
  else if (b.dataset.op === '-') { restart(rule.slice(0, -1)); sfx.remove(); }
  else {
    const k = +b.dataset.k;
    const next = TURNS[(TURNS.indexOf(rule[k]) + 1) % TURNS.length];
    restart(rule.slice(0, k) + next + rule.slice(k + 1));
    sfx.card(k);
  }
  // 札を作り直したので、押した札にフォーカスを戻す（キーボードで続けて押せるように）
  const again = b.dataset.op ? $('cards').querySelector(`[data-op="${b.dataset.op}"]`) : $('cards').children[b.dataset.k];
  if (again && !again.disabled) again.focus();
});

$('samples').replaceChildren(...SAMPLES.map((s) => {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = s.name;
  if (s.rule) b.dataset.rule = s.rule;
  b.addEventListener('click', () => { restart(s.rule || randomRule()); sfx.sample(); });
  return b;
}));

// 共有: webapp-kit が document で拾う前に、今のルールと歩数を入れておく
$('share').addEventListener('click', () => {
  WebAppKit.init({
    text: `ありみちで ${state.rule} のアリを ${fmt(world.steps)} 歩あるかせた`,
    url: shareUrl(location.origin + location.pathname, state.rule),
  });
});

// ---- 遊び方 ----
function openHelp() { $('help').hidden = false; $('helpClose').focus(); }
function closeHelp() {
  $('help').hidden = true;
  if (!state.seenHelp) { state.seenHelp = true; store(); setPlaying(true); sfx.play(); }
}
$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
$('help').addEventListener('click', (e) => { if (e.target === $('help')) closeHelp(); });

// PC: Space で再生・停止、→ で 1 歩。札や見本にフォーカスがあっても Space は再生・停止にする
// （ボタンは keyup の Space で押されるので、keyup も止める）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('help').hidden) { closeHelp(); return; }
  if (!$('help').hidden) return;
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) toggle(); }
  else if (e.key === 'ArrowRight' && !e.target.closest('input')) { e.preventDefault(); $('step').click(); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && $('help').hidden) e.preventDefault();
});

// ---- はじめ ----
renderSpeed();
restart(state.rule);
if (state.seenHelp) setPlaying(true); else openHelp();
