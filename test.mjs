// 中身のテスト。node test.mjs で走る（フレームワークなし）。
import assert from 'node:assert/strict';
import {
  SIZE, MAX_ANTS, SAMPLES, isRule, randomRule, newWorld, addAnt, step, readState, ruleFromSearch, shareUrl, DEFAULT_STATE,
} from './ant.js';

const test = (name, fn) => { fn(); console.log('✓', name); };
const run = (w, n) => { for (let i = 0; i < n; i++) step(w); };

test('はじめは真ん中に上向きのアリ 1 匹、盤は全部 0', () => {
  const w = newWorld('RL');
  assert.deepEqual(w.ants, [{ x: 80, y: 80, d: 0 }]);
  assert.equal(w.grid.length, SIZE * SIZE);
  assert.ok(w.grid.every((c) => c === 0));
});

test('RL の最初の 1 歩: 右を向き、マスを 1 にして右へ進む', () => {
  const w = newWorld('RL');
  const painted = [];
  step(w, (i, c) => painted.push([i, c]));
  assert.deepEqual(w.ants[0], { x: 81, y: 80, d: 1 });
  assert.deepEqual(painted, [[80 * SIZE + 80, 1]]);
  assert.equal(w.steps, 1);
});

test('N はまっすぐ、U はうしろ。状態は n で 0 に戻る', () => {
  const w = newWorld('NU');
  step(w);   // 0 → N: 上のまま進む、マスは 1
  assert.deepEqual(w.ants[0], { x: 80, y: 79, d: 0 });
  w.grid[79 * SIZE + 80] = 1;
  step(w);   // 1 → U: 下を向いて戻る、マスは 0
  assert.deepEqual(w.ants[0], { x: 80, y: 80, d: 2 });
  assert.equal(w.grid[79 * SIZE + 80], 0);
});

test('端はつながる（上から出たら下、左から出たら右）', () => {
  const w = newWorld('NN');
  w.ants[0] = { x: 0, y: 0, d: 0 };
  step(w);
  assert.deepEqual(w.ants[0], { x: 0, y: SIZE - 1, d: 0 });
  w.ants[0] = { x: 0, y: 5, d: 3 };
  step(w);
  assert.deepEqual(w.ants[0], { x: SIZE - 1, y: 5, d: 3 });
});

test('アリは 8 匹まで。1 歩で全員が進み、歩数は 1 だけ増える', () => {
  const w = newWorld('RL');
  for (let i = 1; i < MAX_ANTS; i++) assert.ok(addAnt(w, i, i));
  assert.equal(addAnt(w, 9, 9), false);
  assert.equal(w.ants.length, MAX_ANTS);
  step(w);
  assert.equal(w.steps, 1);
  assert.equal(w.grid.reduce((s, c) => s + c, 0), MAX_ANTS);
});

test('RL は 11,000 歩のころには 104 歩ごとに斜めに 2 マスずつ進む道（ハイウェイ）を作っている', () => {
  const w = newWorld('RL');
  run(w, 11000);
  let { x, y } = w.ants[0];
  let move = null;
  for (let k = 0; k < 10; k++) {
    run(w, 104);
    const dx = (w.ants[0].x - x + SIZE) % SIZE, dy = (w.ants[0].y - y + SIZE) % SIZE;
    const m = [dx > SIZE / 2 ? dx - SIZE : dx, dy > SIZE / 2 ? dy - SIZE : dy];
    assert.deepEqual(m.map(Math.abs), [2, 2]);
    if (move) assert.deepEqual(m, move);   // 毎回同じ向き
    move = m;
    ({ x, y } = w.ants[0]);
  }
  // 5,000 歩のころはまだごちゃごちゃ（104 歩で同じ動きをくり返していない）
  const v = newWorld('RL');
  run(v, 5000);
  const a = { ...v.ants[0] };
  run(v, 104);
  const b = { ...v.ants[0] };
  run(v, 104);
  const c = { ...v.ants[0] };
  assert.ok(b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y);
});

test('同じルールなら毎回同じ模様になる', () => {
  const a = newWorld('LLRR'), b = newWorld('LLRR');
  run(a, 3000); run(b, 3000);
  assert.deepEqual(a.grid, b.grid);
});

test('ルール文字列は RLNU の 2〜12 文字だけ', () => {
  for (const s of ['RL', 'NU', 'RRLLLRLLLRRR']) assert.ok(isRule(s), s);
  for (const s of ['', 'R', 'RRLLLRLLLRRRL', 'rl', 'RX', 'R L', null, 12, ['R', 'L']]) assert.ok(!isRule(s), String(s));
});

test('見本は 7 つ、おまかせ以外は正しいルール', () => {
  assert.equal(SAMPLES.length, 7);
  for (const s of SAMPLES) assert.ok(s.rule === null || isRule(s.rule), s.name);
  assert.deepEqual(SAMPLES.map((s) => s.rule), ['RL', 'RLR', 'LLRR', 'LRRRRRLLR', 'LLRRRLRLRLLR', 'RRLLLRLLLRRR', null]);
});

test('おまかせは 3〜8 文字で、R と L を必ず含む', () => {
  let n = 1;
  const rand = () => { n = (n * 16807) % 2147483647; return n / 2147483647; };
  for (let i = 0; i < 500; i++) {
    const r = randomRule(rand);
    assert.ok(isRule(r) && r.length >= 3 && r.length <= 8 && r.includes('R') && r.includes('L'), r);
  }
});

test('保存の読み書き: 正しい値は残し、おかしい値は初期値に', () => {
  const s = { v: 1, rule: 'LLRR', speed: 3, seenHelp: true };
  assert.deepEqual(readState(JSON.stringify(s)), s);
  assert.deepEqual(readState(null), DEFAULT_STATE);
  assert.deepEqual(readState('こわれた{'), DEFAULT_STATE);
  assert.deepEqual(readState('"RL"'), DEFAULT_STATE);
  assert.deepEqual(readState(JSON.stringify({ rule: 'RX', speed: 9, seenHelp: 'yes' })), DEFAULT_STATE);
  assert.deepEqual(readState(JSON.stringify({ rule: 'NU', speed: 1.5 })), { ...DEFAULT_STATE, rule: 'NU' });
});

test('URL の ?r=: 正しいルールだけ読み、共有の URL に書ける', () => {
  assert.equal(ruleFromSearch('?r=LLRR'), 'LLRR');
  assert.equal(ruleFromSearch('?x=1&r=RLR'), 'RLR');
  for (const q of ['', '?r=', '?r=R', '?r=llrr', '?r=RLRLRLRLRLRLR', '?r=%3Cscript%3E', '?r=RL%20']) assert.equal(ruleFromSearch(q), null, q);
  const url = shareUrl('https://t-of.github.io/arimichi/', 'LLRR');
  assert.equal(url, 'https://t-of.github.io/arimichi/?r=LLRR');
  assert.equal(ruleFromSearch(new URL(url).search), 'LLRR');
});
