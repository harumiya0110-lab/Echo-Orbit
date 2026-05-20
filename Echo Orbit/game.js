const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const alertBox = document.getElementById('alert');

const width = canvas.width;
const height = canvas.height;

const game = {
  alive: true,
  overTimer: 0,
};

const player = {
  x: width / 2,
  y: height / 2,
  radius: 12,
  speed: 2.4,
  heading: 0,
  pulseTimer: 0,
  stepTimer: 0,
  noiseLevel: 0,
  lastMove: false,
};

const keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
  w: false,
  a: false,
  s: false,
  d: false,
};

const walls = [
  { x: 80, y: 80, w: 200, h: 20 },
  { x: 240, y: 170, w: 20, h: 220 },
  { x: 520, y: 130, w: 260, h: 20 },
  { x: 520, y: 130, w: 20, h: 220 },
  { x: 100, y: 420, w: 420, h: 20 },
  { x: 620, y: 340, w: 220, h: 20 },
  { x: 720, y: 300, w: 20, h: 140 },
];

const enemies = [];
const enemyCount = 6;
const otherPlayers = {};
let networkSendTimer = 0;

const pulse = {
  active: false,
  radius: 0,
  maxRadius: 420,
  alpha: 0.7,
  revealDuration: 24,
};

const network = {
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  room: 'lobby',
  channel: null,
  connected: false,
};

const echoes = [];

const sound = new (window.AudioContext || window.webkitAudioContext)();

function createEnemies() {
  enemies.length = 0;
  for (let i = 0; i < enemyCount; i++) {
    enemies.push({
      x: Math.random() * (width - 120) + 60,
      y: Math.random() * (height - 120) + 60,
      radius: 12,
      speed: 1.2 + Math.random() * 0.9,
      direction: Math.random() * Math.PI * 2,
      state: 'patrol',
      alertTime: 0,
      lastHeard: null,
      nextFootstep: 0,
      noisePulse: 0,
    });
  }
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function circleRectCollision(circle, rect) {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.w);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.h);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function resolveWallCollision(entity) {
  walls.forEach(wall => {
    const closestX = clamp(entity.x, wall.x, wall.x + wall.w);
    const closestY = clamp(entity.y, wall.y, wall.y + wall.h);
    let dx = entity.x - closestX;
    let dy = entity.y - closestY;
    let dist = Math.hypot(dx, dy);
    if (dist === 0) {
      const left = Math.abs(entity.x - wall.x);
      const right = Math.abs(entity.x - (wall.x + wall.w));
      const top = Math.abs(entity.y - wall.y);
      const bottom = Math.abs(entity.y - (wall.y + wall.h));
      if (left < right && left < top && left < bottom) {
        dx = -1;
        dy = 0;
      } else if (right < left && right < top && right < bottom) {
        dx = 1;
        dy = 0;
      } else if (top < bottom) {
        dx = 0;
        dy = -1;
      } else {
        dx = 0;
        dy = 1;
      }
      dist = 1;
    }
    const overlap = entity.radius - dist;
    if (overlap > 0) {
      entity.x += (dx / dist) * overlap;
      entity.y += (dy / dist) * overlap;
    }
  });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function connectNetwork() {
  const roomInput = document.getElementById('roomInput');
  const netStatus = document.getElementById('netStatus');
  const roomName = roomInput.value.trim() || 'lobby';
  network.room = roomName;
  if (network.channel) {
    network.channel.close();
  }
  try {
    network.channel = new BroadcastChannel(`echo-orbit-${roomName}`);
    network.channel.onmessage = handleNetworkMessage;
    network.connected = true;
    netStatus.textContent = `接続中: ${roomName}`;
    broadcastNetwork({
      type: 'join',
      id: network.id,
      x: player.x,
      y: player.y,
      heading: player.heading,
      pulse: pulse.active,
      moving: player.lastMove,
      timestamp: Date.now(),
    });
    pushAlert('他プレイヤーとの同期を開始しました。');
  } catch (e) {
    network.connected = false;
    netStatus.textContent = '接続失敗';
    pushAlert('オンライン接続に失敗しました。');
  }
}

function isMoveBlocked(entity, angle) {
  const nx = entity.x + Math.cos(angle) * entity.speed;
  const ny = entity.y + Math.sin(angle) * entity.speed;
  const probe = { x: nx, y: ny, radius: entity.radius };
  return walls.some(wall => circleRectCollision(probe, wall));
}

function normalizeAngle(angle) {
  let a = angle;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function findClearDirection(entity, desiredAngle) {
  const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.2, -1.2, Math.PI * 0.5, -Math.PI * 0.5];
  for (let offset of offsets) {
    const testAngle = normalizeAngle(desiredAngle + offset);
    if (!isMoveBlocked(entity, testAngle)) {
      return testAngle;
    }
  }
  return desiredAngle;
}

function broadcastNetwork(message) {
  if (!network.connected || !network.channel) return;
  network.channel.postMessage(message);
}

function handleNetworkMessage(event) {
  const data = event.data;
  if (!data || data.id === network.id) return;
  if (data.type === 'leave') {
    delete otherPlayers[data.id];
    pushAlert('他プレイヤーが退出しました。');
    return;
  }
  otherPlayers[data.id] = {
    id: data.id,
    x: data.x,
    y: data.y,
    heading: data.heading,
    pulse: data.pulse,
    lastSeen: Date.now(),
    heard: false,
    name: data.name || 'Player',
    moving: data.moving,
  };
  if (distance(player, otherPlayers[data.id]) < 140 && data.moving) {
    otherPlayers[data.id].heard = true;
    pushAlert('他プレイヤーの足音が近い！');
  }
}

function sendNetworkUpdate() {
  broadcastNetwork({
    type: 'update',
    id: network.id,
    x: player.x,
    y: player.y,
    heading: player.heading,
    pulse: pulse.active,
    moving: player.lastMove,
    timestamp: Date.now(),
  });
}

function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function playTone(freq = 220, duration = 0.08, volume = 0.08) {
  const osc = sound.createOscillator();
  const gain = sound.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(sound.destination);
  osc.start();
  osc.stop(sound.currentTime + duration);
}

function pushAlert(message) {
  alertBox.textContent = message;
}

function emitPulse() {
  if (!game.alive || pulse.active) return;
  pulse.active = true;
  pulse.radius = player.radius;
  pulse.alpha = 0.72;
  player.pulseTimer = pulse.revealDuration;
  pushAlert('音波を発した。壁と敵が輪郭を描く。');
  playTone(520, 0.13, 0.14);
  echoes.push({ x: player.x, y: player.y, radius: 0, max: 420, alpha: 0.35, color: 'cyan' });
  enemies.forEach(enemy => {
    const dist = distance(player, enemy);
    if (dist < 300) {
      enemy.state = 'alert';
      enemy.alertTime = 220;
      enemy.lastHeard = { x: player.x, y: player.y };
      enemy.noisePulse = 20;
    }
  });
}

function createFootstep() {
  playTone(170 + Math.random() * 40, 0.05, 0.06);
  echoes.push({ x: player.x, y: player.y, radius: 0, max: 120, alpha: 0.28, color: 'white' });
  player.noiseLevel = 1;
  enemies.forEach(enemy => {
    const hearRange = 160;
    const dist = distance(player, enemy);
    if (dist < hearRange) {
      enemy.state = 'alert';
      enemy.alertTime = 180;
      enemy.lastHeard = { x: player.x, y: player.y };
      pushAlert('足音が暗闇で響いた。敵がこちらに向かう！');
    }
  });
}

function updatePlayer() {
  let dx = 0;
  let dy = 0;
  if (keys.ArrowUp || keys.w) dy -= 1;
  if (keys.ArrowDown || keys.s) dy += 1;
  if (keys.ArrowLeft || keys.a) dx -= 1;
  if (keys.ArrowRight || keys.d) dx += 1;

  const moving = dx !== 0 || dy !== 0;
  if (moving) {
    const mag = Math.hypot(dx, dy);
    dx /= mag;
    dy /= mag;
    player.x += dx * player.speed;
    player.y += dy * player.speed;
    player.heading = angleBetween({ x: player.x - dx, y: player.y - dy }, player);
    if (player.stepTimer <= 0) {
      player.stepTimer = 16;
      createFootstep();
    }
  }

  player.stepTimer = Math.max(0, player.stepTimer - 1);
  player.noiseLevel = Math.max(0, player.noiseLevel - 0.02);
  player.x = clamp(player.x, 20, width - 20);
  player.y = clamp(player.y, 20, height - 20);
  resolveWallCollision(player);

  if (!moving && player.lastMove) {
    pushAlert('足音が止んだ。暗闇が静かになる。');
  }
  player.lastMove = moving;
}

function updateEnemies() {
  enemies.forEach(enemy => {
    if (enemy.noisePulse > 0) {
      enemy.noisePulse -= 1;
    }
    if (enemy.nextFootstep > 0) {
      enemy.nextFootstep -= 1;
    }

    if (enemy.state === 'alert') {
      if (enemy.lastHeard) {
        const desired = angleBetween(enemy, enemy.lastHeard);
        enemy.direction = findClearDirection(enemy, desired);
      }
      enemy.alertTime -= 1;
      if (enemy.alertTime <= 0) {
        enemy.state = 'search';
        enemy.nextFootstep = 20;
      }
    } else if (enemy.state === 'search') {
      if (!enemy.lastHeard || distance(enemy, enemy.lastHeard) < 20) {
        enemy.direction += (Math.random() - 0.5) * 0.9;
      } else {
        const desired = angleBetween(enemy, enemy.lastHeard);
        enemy.direction = findClearDirection(enemy, desired);
      }
      if (Math.random() < 0.008) {
        enemy.direction += (Math.random() - 0.5) * 0.6;
      }
      if (Math.random() < 0.005) {
        enemy.state = 'patrol';
      }
    } else {
      if (Math.random() < 0.01) {
        enemy.direction += (Math.random() - 0.5) * 1.2;
      }
    }

    if (isMoveBlocked(enemy, enemy.direction)) {
      enemy.direction = findClearDirection(enemy, enemy.direction);
    }

    const vx = Math.cos(enemy.direction) * enemy.speed;
    const vy = Math.sin(enemy.direction) * enemy.speed;
    enemy.x += vx;
    enemy.y += vy;
    enemy.x = clamp(enemy.x, 20, width - 20);
    enemy.y = clamp(enemy.y, 20, height - 20);
    resolveWallCollision(enemy);

    if (enemy.state !== 'alert' && player.noiseLevel > 0.1) {
      const hearing = 120 + player.noiseLevel * 120;
      if (distance(player, enemy) < hearing) {
        enemy.state = 'alert';
        enemy.alertTime = 180;
        enemy.lastHeard = { x: player.x, y: player.y };
        pushAlert('敵があなたの足音を聞きつけた！');
      }
    }

    if (enemy.nextFootstep <= 0) {
      enemy.nextFootstep = 30 + Math.random() * 30;
      if (enemy.state !== 'patrol') {
        playTone(300, 0.06, 0.05);
        echoes.push({ x: enemy.x, y: enemy.y, radius: 0, max: 100, alpha: 0.18, color: 'red' });
      }
    }

    if (distance(enemy, player) < enemy.radius + player.radius + 4) {
      game.alive = false;
      game.overTimer = 0;
      status.textContent = '敵に接近された。ゲームオーバー。Rで再開。';
    }
  });
}

function updatePulse() {
  if (!pulse.active) return;
  pulse.radius += 18;
  pulse.alpha *= 0.95;
  if (pulse.radius > pulse.maxRadius || pulse.alpha < 0.02) {
    pulse.active = false;
    status.textContent = '暗闇を取り戻した。次の音波でまた輪郭を得る。';
  }
}

function updateEchoes() {
  for (let i = echoes.length - 1; i >= 0; i--) {
    const echo = echoes[i];
    echo.radius += 8;
    echo.alpha -= 0.01;
    if (echo.radius > echo.max || echo.alpha <= 0) {
      echoes.splice(i, 1);
    }
  }
}

function drawScene() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 0, width, height);

  drawEchoes();
  if (pulse.active || player.pulseTimer > 0) {
    drawPulse();
    drawWalls(true);
    drawEnemies(true);
    drawOtherPlayers(true);
    player.pulseTimer -= 1;
  } else {
    drawEnemies(false);
    drawOtherPlayers(false);
  }

  drawPlayer();
  drawHud();
}

function drawPulse() {
  const grad = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, pulse.radius);
  grad.addColorStop(0, `rgba(0, 210, 255, ${pulse.alpha * 0.54})`);
  grad.addColorStop(0.7, 'rgba(0, 210, 255, 0.08)');
  grad.addColorStop(1, 'rgba(0, 210, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(player.x, player.y, pulse.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawEchoes() {
  echoes.forEach(echo => {
    ctx.strokeStyle = `rgba(${echo.color === 'red' ? '255,92,92' : '0,210,255'}, ${echo.alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(echo.x, echo.y, echo.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function drawWalls(reveal = false) {
  walls.forEach(w => {
    ctx.fillStyle = reveal ? 'rgba(255,255,255,0.16)' : 'transparent';
    ctx.strokeStyle = reveal ? 'rgba(255,255,255,0.12)' : 'transparent';
    ctx.lineWidth = 2;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  });
}

function drawEnemies(reveal = false) {
  enemies.forEach(enemy => {
    if (!reveal && enemy.state !== 'alert') return;
    const opacity = reveal ? 0.94 : 0.28;
    ctx.fillStyle = enemy.state === 'alert' ? `rgba(255,92,92,${opacity})` : `rgba(255,92,92,${opacity * 0.6})`;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    if (enemy.state === 'alert') {
      ctx.strokeStyle = 'rgba(255,204,92,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function drawOtherPlayers(reveal = false) {
  Object.values(otherPlayers).forEach(other => {
    const heard = other.heard || (reveal && pulse.active);
    if (!heard) return;
    ctx.fillStyle = 'rgba(106,255,161,0.7)';
    ctx.beginPath();
    ctx.arc(other.x, other.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(106,255,161,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(other.x, other.y, 18, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function drawPlayer() {
  ctx.fillStyle = 'rgba(122,252,255,0.96)';
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  const eyeX = player.x + Math.cos(player.heading) * 8;
  const eyeY = player.y + Math.sin(player.heading) * 8;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawHud() {
  if (pulse.active) {
    ctx.fillStyle = 'rgba(0, 210, 255, 0.22)';
    ctx.font = '16px sans-serif';
    ctx.fillText('SONAR ACTIVE', 18, height - 22);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '14px sans-serif';
  ctx.fillText('R: 再開', width - 100, 22);
}

function resetGame() {
  game.alive = true;
  player.x = width / 2;
  player.y = height / 2;
  player.pulseTimer = 0;
  player.stepTimer = 0;
  player.noiseLevel = 0;
  player.lastMove = false;
  pulse.active = false;
  echoes.length = 0;
  createEnemies();
  status.textContent = '真っ暗な戦場。音波でしか見えない。';
  pushAlert('敵は足音や残響であなたを探す。');
}

function gameLoop() {
  if (game.alive) {
    updatePlayer();
    updateEnemies();
    updatePulse();
    updateEchoes();
    if (network.connected) {
      networkSendTimer -= 1;
      if (networkSendTimer <= 0) {
        sendNetworkUpdate();
        networkSendTimer = 8;
      }
    }
  }
  drawScene();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', e => {
  const key = e.key;
  if (key === ' ' || key === 'Spacebar') {
    e.preventDefault();
    emitPulse();
    return;
  }
  if (key.toLowerCase() === 'r') {
    resetGame();
    return;
  }
  if (Object.prototype.hasOwnProperty.call(keys, key)) {
    keys[key] = true;
  }
});

window.addEventListener('keyup', e => {
  const key = e.key;
  if (Object.prototype.hasOwnProperty.call(keys, key)) {
    keys[key] = false;
  }
});

const connectBtn = document.getElementById('connectBtn');
if (connectBtn) {
  connectBtn.addEventListener('click', () => {
    connectNetwork();
  });
}

window.addEventListener('beforeunload', () => {
  if (network.connected) {
    broadcastNetwork({ type: 'leave', id: network.id });
    network.channel.close();
  }
});

createEnemies();
resetGame();
gameLoop();
