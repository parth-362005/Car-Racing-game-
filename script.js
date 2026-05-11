/* ═══════════════════════════════════════════════════════
   NEON RACER — script.js
   Complete game logic: rendering, AI, physics, audio, UI
   ═══════════════════════════════════════════════════════ */

"use strict";

/* ══════════════════════════════════════════════
   1. GLOBAL CONSTANTS & CONFIG
══════════════════════════════════════════════ */
const CONFIG = {
  LANES: 5,
  BASE_SPEED: 4,
  MAX_SPEED: 18,
  ACCEL: 0.04,
  DECEL: 0.06,
  PLAYER_MOVE_SPEED: 5.5,
  NITRO_MULT: 2.1,
  NITRO_MAX: 100,
  NITRO_DRAIN: 1.2,
  NITRO_REGEN: 0.28,
  ENEMY_COUNT_BASE: 3,
  ENEMY_COUNT_MAX: 8,
  LEVEL_UP_SCORE: 1200,
  ROAD_SEGMENT_H: 60,
  CAR_W: 38,
  CAR_H: 72,
  SKID_LIFE: 45,
  PARTICLE_LIFE: 60,
};

/* ══════════════════════════════════════════════
   2. AUDIO ENGINE (Web Audio API — no files needed)
══════════════════════════════════════════════ */
const Audio = (() => {
  let ctx = null;
  let engineGain = null, engineOsc = null;
  let bgGain = null;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      engineGain = ctx.createGain(); engineGain.gain.value = 0;
      engineGain.connect(ctx.destination);
      bgGain = ctx.createGain(); bgGain.gain.value = 0;
      bgGain.connect(ctx.destination);
    } catch(e) { ctx = null; }
  }

  function startEngine() {
    if (!ctx) return;
    if (engineOsc) { engineOsc.stop(); engineOsc = null; }
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 80;
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i=0;i<256;i++) { const x=i*2/256-1; curve[i]=x*(1.5+Math.abs(x*3)); }
    dist.curve = curve;
    engineOsc.connect(dist); dist.connect(engineGain);
    engineOsc.start();
    engineGain.gain.setTargetAtTime(0.04, ctx.currentTime, 0.1);
  }

  function updateEngine(speedRatio, nitro) {
    if (!engineOsc) return;
    const freq = 60 + speedRatio * 220 + (nitro ? 80 : 0);
    engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
    engineGain.gain.setTargetAtTime(nitro ? 0.07 : 0.04, ctx.currentTime, 0.1);
  }

  function stopEngine() {
    if (!engineGain) return;
    engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  }

  function playBeep(freq=440, dur=0.08, vol=0.12, type='square') {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime+dur+0.05);
  }

  function playExplosion() {
    if (!ctx) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate*0.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0; i<d.length; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/d.length, 1.5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 400;
    src.connect(flt); flt.connect(g); g.connect(ctx.destination);
    src.start();
  }

  function playNitro() { playBeep(220, 0.15, 0.08, 'sawtooth'); }
  function playLevelUp() {
    [523, 659, 784, 1047].forEach((f,i) =>
      setTimeout(() => playBeep(f, 0.1, 0.1, 'square'), i*80));
  }
  function playCollect() { playBeep(880, 0.06, 0.07, 'sine'); }

  return { init, startEngine, updateEngine, stopEngine, playBeep, playExplosion, playNitro, playLevelUp, playCollect };
})();


/* ══════════════════════════════════════════════
   3. DRAWING HELPERS
══════════════════════════════════════════════ */

/** Draw a neon-glowing rounded rect */
function drawGlowRect(ctx, x, y, w, h, r, color, glow=18, alpha=1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur  = glow;
  ctx.fillStyle   = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** Draw a car given a color scheme */
function drawCar(ctx, x, y, w, h, colors, flip=false, nitroOn=false) {
  ctx.save();
  if (flip) { ctx.translate(x + w/2, y + h/2); ctx.scale(1,-1); ctx.translate(-w/2, -h/2); x=0; y=0; }

  const cw = w, ch = h;

  // Body shadow
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 20;

  // Main body
  const bodyGrad = ctx.createLinearGradient(x, y, x+cw, y);
  bodyGrad.addColorStop(0, colors.dark);
  bodyGrad.addColorStop(.45, colors.main);
  bodyGrad.addColorStop(1, colors.dark);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.roundRect(x+cw*.08, y+ch*.08, cw*.84, ch*.84, 6); ctx.fill();

  // Cockpit
  ctx.fillStyle = colors.cockpit;
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.roundRect(x+cw*.2, y+ch*.2, cw*.6, ch*.38, 4); ctx.fill();

  // Windshield glare
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.roundRect(x+cw*.25, y+ch*.22, cw*.2, ch*.14, 2); ctx.fill();

  // Headlights
  const hlColor = nitroOn ? '#ffffff' : colors.light;
  ctx.shadowColor = hlColor; ctx.shadowBlur = nitroOn ? 22 : 12;
  ctx.fillStyle = hlColor;
  // left HL
  ctx.beginPath(); ctx.roundRect(x+cw*.1, y+ch*.08, cw*.22, ch*.08, 3); ctx.fill();
  // right HL
  ctx.beginPath(); ctx.roundRect(x+cw*.68, y+ch*.08, cw*.22, ch*.08, 3); ctx.fill();

  // Rear lights
  ctx.shadowColor = '#ff2244'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#ff2244';
  ctx.beginPath(); ctx.roundRect(x+cw*.1, y+ch*.84, cw*.2, ch*.07, 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x+cw*.7, y+ch*.84, cw*.2, ch*.07, 2); ctx.fill();

  // Wheels
  ctx.shadowColor = '#111'; ctx.shadowBlur = 0;
  ctx.fillStyle = '#1a1a2e';
  ctx.strokeStyle = colors.wheel;
  ctx.lineWidth = 2;
  [[x+cw*.04, y+ch*.17, cw*.14, ch*.2],[x+cw*.82, y+ch*.17, cw*.14, ch*.2],
   [x+cw*.04, y+ch*.63, cw*.14, ch*.2],[x+cw*.82, y+ch*.63, cw*.14, ch*.2]]
    .forEach(([wx,wy,ww,wh]) => {
      ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,3); ctx.fill(); ctx.stroke();
    });

  // Nitro flames
  if (nitroOn) {
    const fx = x + cw*.15, fy = y + ch*.92;
    const fg = ctx.createLinearGradient(fx, fy, fx, fy+ch*.3);
    fg.addColorStop(0, '#00f5ff'); fg.addColorStop(.5, '#9d00ff'); fg.addColorStop(1, 'transparent');
    ctx.fillStyle = fg;
    ctx.shadowColor = '#00f5ff'; ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + cw*.7, fy);
    ctx.lineTo(fx + cw*.5 + (Math.random()-.5)*8, fy + ch*.35);
    ctx.lineTo(fx + cw*.35, fy); ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

/** Draw stylized road */
function drawRoad(ctx, W, H, scroll, lanes, roadX, roadW) {
  // Asphalt
  const roadGrad = ctx.createLinearGradient(roadX, 0, roadX+roadW, 0);
  roadGrad.addColorStop(0,    '#0d0d1a');
  roadGrad.addColorStop(0.08, '#111128');
  roadGrad.addColorStop(0.5,  '#14142e');
  roadGrad.addColorStop(0.92, '#111128');
  roadGrad.addColorStop(1,    '#0d0d1a');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(roadX, 0, roadW, H);

  // Road edge glow strips
  ctx.shadowColor = '#00f5ff'; ctx.shadowBlur = 14;
  ctx.fillStyle   = '#00f5ff';
  ctx.fillRect(roadX,           0, 3, H);
  ctx.fillRect(roadX+roadW-3,   0, 3, H);
  ctx.shadowBlur = 0;

  // Dashed lane lines
  const laneW = roadW / lanes;
  ctx.setLineDash([28, 22]);
  ctx.lineDashOffset = -scroll % (28+22);
  ctx.lineWidth = 2;
  for (let i=1; i<lanes; i++) {
    const lx = roadX + i * laneW;
    ctx.strokeStyle = i === Math.floor(lanes/2)+1
      ? 'rgba(255,238,0,0.35)'
      : 'rgba(0,245,255,0.18)';
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Draw sky & city background */
function drawBackground(ctx, W, H, scroll, roadX, roadW) {
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#000010');
  sky.addColorStop(.55, '#04060d');
  sky.addColorStop(1, '#0d0d1a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  const starSeed = 42;
  for (let i=0; i<80; i++) {
    const sx = ((starSeed * (i*17+1)) % 997) / 997 * W;
    const sy = ((starSeed * (i*31+7)) % 997) / 997 * H * .6;
    const sr = ((i*13)%3)*.5 + .3;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
  }

  // Parallax city silhouettes
  const cityScroll = (scroll * 0.12) % W;
  ctx.fillStyle = '#06080f';
  drawCitySkyline(ctx, W, H, -cityScroll);
  drawCitySkyline(ctx, W, H, W - cityScroll);

  // Horizon glow
  const hg = ctx.createLinearGradient(0, H*.45, 0, H*.65);
  hg.addColorStop(0, 'transparent');
  hg.addColorStop(.4, 'rgba(157,0,255,0.08)');
  hg.addColorStop(.7, 'rgba(0,245,255,0.05)');
  hg.addColorStop(1, 'transparent');
  ctx.fillStyle = hg; ctx.fillRect(0, H*.45, W, H*.2);

  // Side gutters (outside road)
  ctx.fillStyle = '#080c18';
  ctx.fillRect(0, 0, roadX, H);
  ctx.fillRect(roadX+roadW, 0, W - roadX - roadW, H);
}

function drawCitySkyline(ctx, W, H, offsetX) {
  const buildings = [
    [0.02,0.38,0.055,0.28],[0.08,0.32,0.04,0.22],[0.13,0.42,0.06,0.18],
    [0.2,0.28,0.045,0.3],[0.25,0.35,0.07,0.25],[0.33,0.22,0.05,0.3],
    [0.39,0.38,0.055,0.2],[0.45,0.3,0.04,0.22],[0.5,0.4,0.06,0.18],
    [0.57,0.25,0.07,0.28],[0.65,0.35,0.05,0.2],[0.71,0.3,0.04,0.25],
    [0.76,0.42,0.055,0.18],[0.82,0.28,0.06,0.3],[0.89,0.38,0.05,0.22],
    [0.95,0.32,0.045,0.26],
  ];
  buildings.forEach(([rx,ry,rw,rh]) => {
    const bx = offsetX + rx*W, by = ry*H, bw = rw*W, bh = rh*H;
    ctx.fillRect(bx, by, bw, bh);
    // windows
    ctx.fillStyle = 'rgba(0,245,255,0.04)';
    for (let wi=0; wi<Math.floor(bw/8); wi++) {
      for (let wj=0; wj<Math.floor(bh/10); wj++) {
        if (Math.random()>.65) ctx.fillRect(bx+wi*8+1, by+wj*10+1, 5, 7);
      }
    }
    ctx.fillStyle = '#06080f';
  });
}


/* ══════════════════════════════════════════════
   4. PARTICLE SYSTEM
══════════════════════════════════════════════ */
class Particle {
  constructor(x, y, vx, vy, color, size, life, type='circle') {
    Object.assign(this, {x,y,vx,vy,color,size,life,maxLife:life,type});
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vy += 0.15; // gravity
    this.vx *= 0.97;
    this.life--;
    return this.life > 0;
  }
  draw(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = this.color; ctx.shadowBlur = 8;
    ctx.fillStyle = this.color;
    if (this.type === 'circle') {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillRect(this.x - this.size/2, this.y - this.size/2, this.size, this.size);
    }
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() { this.particles = []; }
  spawn(x, y, opts={}) {
    const count = opts.count || 8;
    for (let i=0; i<count; i++) {
      const angle = Math.random()*Math.PI*2;
      const speed = (opts.speed || 3) * (.5 + Math.random());
      this.particles.push(new Particle(
        x + (Math.random()-.5)*(opts.spread||10),
        y + (Math.random()-.5)*(opts.spread||10),
        Math.cos(angle)*speed,
        Math.sin(angle)*speed - (opts.upBias||0),
        opts.color || '#ff2244',
        opts.size || 4,
        opts.life || 40,
        opts.type || 'circle'
      ));
    }
  }
  spawnExplosion(x, y) {
    const colors = ['#ff2244','#ff8c00','#ffee00','#ff00aa','#ffffff'];
    for (let i=0; i<60; i++) {
      const c = colors[Math.floor(Math.random()*colors.length)];
      const angle = Math.random()*Math.PI*2;
      const speed = 1 + Math.random()*6;
      this.particles.push(new Particle(
        x + (Math.random()-.5)*20, y + (Math.random()-.5)*20,
        Math.cos(angle)*speed, Math.sin(angle)*speed - 2,
        c, 3+Math.random()*5, 50+Math.random()*30,
        Math.random()>.5 ? 'circle' : 'rect'
      ));
    }
  }
  update() { this.particles = this.particles.filter(p => p.update()); }
  draw(ctx) { this.particles.forEach(p => p.draw(ctx)); }
  clear() { this.particles = []; }
}


/* ══════════════════════════════════════════════
   5. SKID MARKS
══════════════════════════════════════════════ */
class SkidMark {
  constructor(x, y, w) {
    this.x=x; this.y=y; this.w=w; this.life=CONFIG.SKID_LIFE;
  }
  update(scrollSpeed) { this.y += scrollSpeed; this.life--; return this.life > 0; }
  draw(ctx) {
    const alpha = (this.life / CONFIG.SKID_LIFE) * 0.35;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#555';
    ctx.fillRect(this.x - 3, this.y, 4, 8);
    ctx.fillRect(this.x + this.w - 1, this.y, 4, 8);
    ctx.restore();
  }
}


/* ══════════════════════════════════════════════
   6. CAR CLASSES
══════════════════════════════════════════════ */
const PLAYER_COLORS = {
  dark: '#001a2e', main: '#003d6b', glow: '#00f5ff',
  cockpit: 'rgba(0,245,255,0.25)', light: '#00f5ff', wheel: '#00f5ff'
};

const ENEMY_PALETTES = [
  { dark:'#1a0000', main:'#660000', glow:'#ff2244', cockpit:'rgba(255,34,68,.2)', light:'#ff5566', wheel:'#ff2244' },
  { dark:'#1a0e00', main:'#7a3e00', glow:'#ff8c00', cockpit:'rgba(255,140,0,.2)',  light:'#ffaa33', wheel:'#ff8c00' },
  { dark:'#0d001a', main:'#400080', glow:'#9d00ff', cockpit:'rgba(157,0,255,.2)',  light:'#bb44ff', wheel:'#9d00ff' },
  { dark:'#001a0a', main:'#005c20', glow:'#39ff14', cockpit:'rgba(57,255,20,.2)',  light:'#55ff33', wheel:'#39ff14' },
  { dark:'#1a001a', main:'#7a006b', glow:'#ff00aa', cockpit:'rgba(255,0,170,.2)', light:'#ff33cc', wheel:'#ff00aa' },
];

class PlayerCar {
  constructor(x, y, lane) {
    this.x = x; this.y = y;
    this.lane = lane;
    this.targetX = x;
    this.speed = 0;
    this.nitro = CONFIG.NITRO_MAX;
    this.nitroOn = false;
    this.alive = true;
    this.w = CONFIG.CAR_W; this.h = CONFIG.CAR_H;
  }
  get cx() { return this.x + this.w/2; }
  get cy() { return this.y + this.h/2; }
}

class EnemyCar {
  constructor(x, y, lane, speed, palette) {
    this.x = x; this.y = y; this.lane = lane;
    this.baseSpeed = speed; this.speed = speed;
    this.palette = palette;
    this.w = CONFIG.CAR_W; this.h = CONFIG.CAR_H;
    this.switchCooldown = 0;
    this.targetX = x;
    this.alive = true;
  }
}


/* ══════════════════════════════════════════════
   7. MAIN GAME CLASS
══════════════════════════════════════════════ */
class NeonRacer {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this.previewCanvas = document.getElementById('previewCanvas');
    this.previewCtx    = this.previewCanvas.getContext('2d');

    this.state = 'start'; // start | playing | paused | gameover
    this.score = 0;
    this.hiScore = parseInt(localStorage.getItem('neonracer_hi') || '0');
    this.level = 1;
    this.levelProgress = 0;
    this.distance = 0;
    this.roadScroll = 0;
    this.frameCount = 0;
    this.animId = null;

    this.particles  = new ParticleSystem();
    this.skidMarks  = [];
    this.player     = null;
    this.enemies    = [];
    this.keys       = {};
    this.touchState = { left:false, right:false, nitro:false };

    this.roadX = 0; this.roadW = 0; this.laneW = 0;

    this._resize();
    this._bindEvents();
    this._bindUI();
    this._updateHiScoreDisplay();
    this._drawPreview();
    this._startBackgroundLoop();
  }

  /* ─── Resize ─────────────────────────────────────── */
  _resize() {
    this.W = this.canvas.width  = window.innerWidth;
    this.H = this.canvas.height = window.innerHeight;
    const totalRoadW = Math.min(this.W * .65, 500);
    this.roadX = (this.W - totalRoadW) / 2;
    this.roadW = totalRoadW;
    this.laneW = this.roadW / CONFIG.LANES;
    if (this.player) {
      this.player.targetX = this._laneCenter(this.player.lane) - CONFIG.CAR_W/2;
      this.player.x = this.player.targetX;
    }
  }

  _laneCenter(lane) {
    return this.roadX + (lane + .5) * this.laneW;
  }

  /* ─── Event Binding ──────────────────────────────── */
  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('keydown', e => {
      this.keys[e.key] = true;
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
      if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && this.state === 'playing') this._pause();
      else if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && this.state === 'paused') this._resume();
    });
    window.addEventListener('keyup', e => { this.keys[e.key] = false; });

    // Mobile touch
    const addTouch = (el, prop, val) => {
      el.addEventListener('touchstart', e => { e.preventDefault(); this.touchState[prop]=val; Audio.init(); }, {passive:false});
      el.addEventListener('touchend',   e => { e.preventDefault(); this.touchState[prop]=false; }, {passive:false});
    };
    addTouch(document.getElementById('touchLeft'),  'left',  true);
    addTouch(document.getElementById('touchRight'), 'right', true);
    addTouch(document.getElementById('touchNitro'), 'nitro', true);
  }

  _bindUI() {
    document.getElementById('btnStart').addEventListener('click', () => { Audio.init(); this._startGame(); });
    document.getElementById('btnHowTo').addEventListener('click', () => {
      document.getElementById('howToPanel').classList.toggle('hidden');
    });
    document.getElementById('btnPause').addEventListener('click', () => {
      if (this.state==='playing') this._pause();
      else if (this.state==='paused') this._resume();
    });
    document.getElementById('btnRestart').addEventListener('click', () => this._startGame());
    document.getElementById('btnResume').addEventListener('click', () => this._resume());
    document.getElementById('btnRestartFromPause').addEventListener('click', () => this._startGame());
    document.getElementById('btnPlayAgain').addEventListener('click', () => this._startGame());
    document.getElementById('btnGoHome').addEventListener('click', () => this._showStart());
  }

  /* ─── Preview Car on Start Screen ───────────────── */
  _drawPreview() {
    const pc = this.previewCtx;
    pc.clearRect(0,0,80,130);
    drawCar(pc, 4, 8, 72, 116, PLAYER_COLORS, false, false);
  }

  /* ─── Hi-score ────────────────────────────────────  */
  _updateHiScoreDisplay() {
    const fmt = n => String(n).padStart(6,'0');
    document.getElementById('hiScoreStart').textContent = fmt(this.hiScore);
    document.getElementById('hiScoreDisplay').textContent = fmt(this.hiScore);
  }

  /* ─── Screen Management ──────────────────────────── */
  _showScreen(id) {
    ['startScreen','gameScreen','pauseScreen','gameOverScreen'].forEach(s => {
      const el = document.getElementById(s);
      el.classList.remove('active');
    });
    document.getElementById(id).classList.add('active');
  }

  _showStart() {
    this.state = 'start';
    Audio.stopEngine();
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId=null; }
    this._showScreen('startScreen');
  }

  /* ─── Game Init ───────────────────────────────────── */
  _startGame() {
    Audio.init();
    this.state = 'playing';
    this.score = 0; this.level = 1; this.levelProgress = 0;
    this.distance = 0; this.roadScroll = 0; this.frameCount = 0;
    this.particles.clear(); this.skidMarks = [];

    // Player
    const startLane = Math.floor(CONFIG.LANES / 2);
    const px = this._laneCenter(startLane) - CONFIG.CAR_W/2;
    const py = this.H - CONFIG.CAR_H - 80;
    this.player = new PlayerCar(px, py, startLane);
    this.player.targetX = px;

    // Enemies
    this.enemies = [];
    for (let i=0; i<CONFIG.ENEMY_COUNT_BASE; i++) this._spawnEnemy(true);

    this._showScreen('gameScreen');

    Audio.startEngine();
    if (this.animId) cancelAnimationFrame(this.animId);
    this._loop();
  }

  _pause() {
    this.state = 'paused';
    Audio.stopEngine();
    document.getElementById('pauseScore').textContent = String(Math.floor(this.score)).padStart(6,'0');
    document.getElementById('pauseScreen').classList.add('active');
  }

  _resume() {
    this.state = 'playing';
    Audio.startEngine();
    document.getElementById('pauseScreen').classList.remove('active');
    this._loop();
  }

  _gameOver() {
    this.state = 'gameover';
    Audio.stopEngine();
    Audio.playExplosion();

    // Explosion particles at player position
    const px = this.player.x + CONFIG.CAR_W/2;
    const py = this.player.y + CONFIG.CAR_H/2;
    this.particles.spawnExplosion(px, py);

    const fmt = n => String(Math.floor(n)).padStart(6,'0');
    const isNew = this.score > this.hiScore;
    if (isNew) {
      this.hiScore = Math.floor(this.score);
      localStorage.setItem('neonracer_hi', this.hiScore);
      this._updateHiScoreDisplay();
    }

    document.getElementById('goScore').textContent    = fmt(this.score);
    document.getElementById('goBest').textContent     = fmt(this.hiScore);
    document.getElementById('goLevel').textContent    = String(this.level).padStart(2,'0');
    document.getElementById('goDistance').textContent = (this.distance/1000).toFixed(1)+' km';
    document.getElementById('newHiScoreBadge').classList.toggle('hidden', !isNew);

    // Draw last frame with explosion then show overlay
    setTimeout(() => {
      document.getElementById('gameOverScreen').classList.add('active');
    }, 600);
  }

  /* ─── Enemy Spawning ─────────────────────────────── */
  _spawnEnemy(initial=false) {
    const maxEnemies = Math.min(CONFIG.ENEMY_COUNT_BASE + this.level - 1, CONFIG.ENEMY_COUNT_MAX);
    if (this.enemies.length >= maxEnemies) return;

    // Pick a lane not occupied by player or too close to another enemy
    const occupied = new Set(this.enemies.map(e => e.lane));
    const free = [];
    for (let i=0; i<CONFIG.LANES; i++) {
      if (!occupied.has(i)) free.push(i);
    }
    if (free.length === 0) return;
    const lane = free[Math.floor(Math.random()*free.length)];
    const x = this._laneCenter(lane) - CONFIG.CAR_W/2;
    const y = initial
      ? -CONFIG.CAR_H - Math.random() * this.H * .9
      : -CONFIG.CAR_H - Math.random() * 200;

    const baseSpd = (CONFIG.BASE_SPEED + (this.level-1)*0.4) * (0.6 + Math.random()*.7);
    const palette = ENEMY_PALETTES[Math.floor(Math.random()*ENEMY_PALETTES.length)];
    this.enemies.push(new EnemyCar(x, y, lane, baseSpd, palette));
  }

  /* ─── AI Update ────────────────────────────────────── */
  _updateAI(enemy) {
    const px = this.player.x + CONFIG.CAR_W/2;
    const py = this.player.y;
    const ex = enemy.x + CONFIG.CAR_W/2;
    const ey = enemy.y;

    // Lane switch logic
    enemy.switchCooldown = Math.max(0, enemy.switchCooldown-1);
    if (enemy.switchCooldown === 0 && Math.random() < 0.008) {
      // Avoid same lane as player if close
      const sameAsPlayer = enemy.lane === this.player.lane && Math.abs(ey-py) < 220;
      // Avoid other enemies
      const blocked = this.enemies.some(e =>
        e !== enemy && e.lane === enemy.lane && Math.abs(e.y - ey) < CONFIG.CAR_H * 1.5
      );

      if (sameAsPlayer || blocked || Math.random() < 0.3) {
        const options = [];
        if (enemy.lane > 0) options.push(enemy.lane-1);
        if (enemy.lane < CONFIG.LANES-1) options.push(enemy.lane+1);
        if (options.length) {
          // Prefer lane away from player
          options.sort((a,b) => {
            const da = Math.abs(this._laneCenter(a) - px);
            const db = Math.abs(this._laneCenter(b) - px);
            return db - da;
          });
          enemy.lane = options[0];
          enemy.targetX = this._laneCenter(enemy.lane) - CONFIG.CAR_W/2;
          enemy.switchCooldown = 60 + Math.random()*60;
        }
      }
    }

    // Smooth x movement
    enemy.x += (enemy.targetX - enemy.x) * 0.08;

    // Speed variation
    const closeness = Math.max(0, 1 - Math.abs(ey-py)/300);
    enemy.speed = enemy.baseSpeed * (1 + closeness * .3 * (ey > py ? 1 : -1));
    enemy.speed = Math.max(enemy.baseSpeed * .5, Math.min(enemy.baseSpeed * 1.5, enemy.speed));
  }

  /* ─── Input Handling ───────────────────────────────── */
  _handleInput() {
    const p = this.player;
    const k = this.keys;
    const t = this.touchState;

    // Lane change
    const goLeft  = k['ArrowLeft']  || k['a'] || k['A'] || t.left;
    const goRight = k['ArrowRight'] || k['d'] || k['D'] || t.right;
    const brake   = k['ArrowDown']  || k['s'] || k['S'];
    const accel   = k['ArrowUp']    || k['w'] || k['W'];
    const nitro   = k['Shift'] || k['ShiftLeft'] || k['ShiftRight'] || t.nitro;

    // Horizontal: snap to lane (with smooth lerp)
    if (goLeft && !this._leftPressed) {
      if (p.lane > 0) {
        p.lane--;
        p.targetX = this._laneCenter(p.lane) - CONFIG.CAR_W/2;
        // Skid
        this.skidMarks.push(new SkidMark(p.x, p.y+p.h*.8, p.w));
        Audio.playBeep(120, 0.04, 0.03, 'sawtooth');
      }
    }
    if (goRight && !this._rightPressed) {
      if (p.lane < CONFIG.LANES-1) {
        p.lane++;
        p.targetX = this._laneCenter(p.lane) - CONFIG.CAR_W/2;
        this.skidMarks.push(new SkidMark(p.x, p.y+p.h*.8, p.w));
        Audio.playBeep(120, 0.04, 0.03, 'sawtooth');
      }
    }
    this._leftPressed  = goLeft;
    this._rightPressed = goRight;

    // Speed
    const baseSpd = CONFIG.BASE_SPEED + (this.level-1) * 0.5;
    if (accel) p.speed = Math.min(p.speed + CONFIG.ACCEL * baseSpd, CONFIG.MAX_SPEED);
    else if (brake) p.speed = Math.max(p.speed - CONFIG.DECEL * baseSpd, baseSpd * .5);
    else p.speed += (baseSpd - p.speed) * 0.02;

    // Nitro
    if (nitro && p.nitro > 0) {
      p.nitroOn = true;
      p.nitro = Math.max(0, p.nitro - CONFIG.NITRO_DRAIN);
      if (!this._nitroWasOn) Audio.playNitro();
      this._nitroWasOn = true;
      // Nitro particles
      if (this.frameCount % 2 === 0) {
        this.particles.spawn(p.x+p.w*.3, p.y+p.h, {
          count:4, speed:3, spread:8, upBias:2,
          color:'#00f5ff', size:5, life:20
        });
      }
    } else {
      p.nitroOn = false;
      p.nitro = Math.min(CONFIG.NITRO_MAX, p.nitro + CONFIG.NITRO_REGEN);
      this._nitroWasOn = false;
    }

    p.x += (p.targetX - p.x) * CONFIG.PLAYER_MOVE_SPEED / 10;
  }

  /* ─── Collision Detection ───────────────────────── */
  _checkCollisions() {
    const p = this.player;
    const margin = 6;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const overlap =
        p.x + margin < e.x + e.w - margin &&
        p.x + p.w - margin > e.x + margin &&
        p.y + margin < e.y + e.h - margin &&
        p.y + p.h - margin > e.y + margin;
      if (overlap) {
        p.alive = false;
        this._gameOver();
        return;
      }
    }
  }

  /* ─── Level Progression ─────────────────────────── */
  _updateLevel() {
    this.levelProgress += this.player.speed * (this.player.nitroOn ? CONFIG.NITRO_MULT : 1);
    if (this.levelProgress >= CONFIG.LEVEL_UP_SCORE) {
      this.level++;
      this.levelProgress = 0;
      Audio.playLevelUp();
      // Spawn extra enemy
      this._spawnEnemy();
    }
    const pct = (this.levelProgress / CONFIG.LEVEL_UP_SCORE) * 100;
    document.getElementById('levelBar').style.width = pct + '%';
    document.getElementById('levelDisplay').textContent = String(this.level).padStart(2,'0');
  }

  /* ─── HUD Update ─────────────────────────────────── */
  _updateHUD() {
    const fmt = n => String(Math.floor(n)).padStart(6,'0');
    document.getElementById('scoreDisplay').textContent = fmt(this.score);
    document.getElementById('hiScoreDisplay').textContent = fmt(this.hiScore);

    const speedRatio = this.player.speed / CONFIG.MAX_SPEED;
    const kmh = Math.floor(this.player.speed * 18 * (this.player.nitroOn ? CONFIG.NITRO_MULT : 1));
    document.getElementById('speedBar').style.height = (speedRatio*100)+'%';
    document.getElementById('speedValue').innerHTML = kmh+' <span>km/h</span>';
    document.getElementById('nitroBar').style.height = (this.player.nitro/CONFIG.NITRO_MAX*100)+'%';
  }

  /* ─── Background Loop (for start/gameover) ─────── */
  _startBackgroundLoop() {
    let scroll = 0;
    const loop = () => {
      if (this.state === 'start' || this.state === 'gameover') {
        // handled by main loop or just idle
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  /* ═══ MAIN GAME LOOP ═══════════════════════════════ */
  _loop() {
    if (this.state !== 'playing' && this.state !== 'gameover') return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    /* ── 1. Background ── */
    drawBackground(ctx, this.W, this.H, this.roadScroll, this.roadX, this.roadW);

    /* ── 2. Road ── */
    drawRoad(ctx, this.W, this.H, this.roadScroll, CONFIG.LANES, this.roadX, this.roadW);

    /* ── 3. Skid marks ── */
    const scrollSpd = this.state==='gameover' ? 0 : this.player.speed;
    this.skidMarks = this.skidMarks.filter(s => s.update(scrollSpd) && s.draw(ctx) !== false);
    this.skidMarks.forEach(s => s.draw(ctx));

    if (this.state === 'playing') {
      this.frameCount++;

      /* ── Input & Player ── */
      this._handleInput();
      const p = this.player;
      const eff = p.speed * (p.nitroOn ? CONFIG.NITRO_MULT : 1);
      this.roadScroll += eff;
      this.distance   += eff * 0.5;
      this.score      += eff * 0.12;

      /* ── Enemies ── */
      for (const e of this.enemies) {
        this._updateAI(e);
        // Enemies move at relative speed to player
        e.y += (eff - e.speed);
        // Recycle off-screen
        if (e.y > this.H + 50) {
          e.y = -CONFIG.CAR_H - Math.random()*200;
          e.lane = Math.floor(Math.random()*CONFIG.LANES);
          e.targetX = this._laneCenter(e.lane) - CONFIG.CAR_W/2;
          e.x = e.targetX;
        }
        if (e.y < -CONFIG.CAR_H - 400) {
          e.y = this.H + 50;
        }
      }

      /* ── Spawn if needed ── */
      if (this.frameCount % 90 === 0) this._spawnEnemy();

      /* ── Collision ── */
      this._checkCollisions();

      /* ── Level ── */
      this._updateLevel();

      /* ── Score ── */
      if (this.score > this.hiScore) {
        this.hiScore = Math.floor(this.score);
        localStorage.setItem('neonracer_hi', this.hiScore);
      }

      /* ── Ambient particles (road sparks) ── */
      if (this.frameCount % 8 === 0 && p.speed > 8) {
        const sx = this.roadX + Math.random()*this.roadW;
        this.particles.spawn(sx, p.y + p.h, {
          count:1, speed:.8, spread:2, upBias:.5,
          color: Math.random()>.5 ? '#00f5ff' : '#ffffff',
          size:1.5, life:18
        });
      }

      /* ── Audio ── */
      Audio.updateEngine(p.speed/CONFIG.MAX_SPEED, p.nitroOn);

      /* ── HUD ── */
      this._updateHUD();
    }

    /* ── 4. Draw enemies ── */
    for (const e of this.enemies) {
      drawCar(ctx, e.x, e.y, e.w, e.h, e.palette, true, false);
    }

    /* ── 5. Draw player ── */
    if (this.player && this.state === 'playing') {
      drawCar(ctx, this.player.x, this.player.y, CONFIG.CAR_W, CONFIG.CAR_H,
               PLAYER_COLORS, false, this.player.nitroOn);
    }

    /* ── 6. Particles ── */
    this.particles.update();
    this.particles.draw(ctx);

    /* ── 7. Speed lines (motion blur effect) ── */
    if (this.state === 'playing' && this.player.speed > 7) {
      const alpha = Math.min(.35, (this.player.speed - 7) / (CONFIG.MAX_SPEED-7) * .35);
      const lineCount = 12;
      ctx.save();
      ctx.globalAlpha = alpha * (this.player.nitroOn ? 1.8 : 1);
      ctx.strokeStyle = this.player.nitroOn ? '#00f5ff' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      for (let i=0; i<lineCount; i++) {
        const lx = this.roadX + 10 + (i/lineCount)*this.roadW*0.9;
        const ly = Math.random() * this.H;
        const ll = 20 + Math.random()*50;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly+ll); ctx.stroke();
      }
      ctx.restore();
    }

    /* ── 8. Nitro screen flash ── */
    if (this.state === 'playing' && this.player.nitroOn) {
      ctx.save();
      ctx.globalAlpha = .04;
      ctx.fillStyle = '#00f5ff';
      ctx.fillRect(0,0,this.W,this.H);
      ctx.restore();
    }

    /* ── Schedule next frame ── */
    if (this.state === 'playing') {
      this.animId = requestAnimationFrame(() => this._loop());
    } else if (this.state === 'gameover') {
      // Keep drawing particles for the explosion
      this.animId = requestAnimationFrame(() => this._loop());
    }
  }
}

/* ══════════════════════════════════════════════
   8. BOOT
══════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  window._game = new NeonRacer();
});
