import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3001;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// グローバル状態
const matchmakingQueue = [];
const rooms = new Map();
let roomCounter = 0;

class Player {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    this.roomId = null;
    this.x = 0;
    this.y = 0;
    this.heading = 0;
    this.moving = false;
    this.pulse = false;
    this.state = 'patrol';
  }

  send(message) {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  }

  isAlive() {
    return this.ws.readyState === 1;
  }
}

class GameRoom {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.started = false;
    this.createdAt = Date.now();
  }

  broadcast(message, excludeId = null) {
    this.players.forEach(player => {
      if (excludeId !== player.id && player.isAlive()) {
        player.send(message);
      }
    });
  }

  broadcastAll(message) {
    this.players.forEach(player => {
      if (player.isAlive()) {
        player.send(message);
      }
    });
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    player.roomId = this.id;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  getPlayerCount() {
    return this.players.size;
  }

  getPlayersList() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      heading: p.heading,
      moving: p.moving,
      pulse: p.pulse,
    }));
  }

  isEmpty() {
    return this.players.size === 0;
  }
}

// マッチメイキング
function tryCreateRoom() {
  if (matchmakingQueue.length >= 4) {
    const newPlayers = matchmakingQueue.splice(0, 4);
    const roomId = ++roomCounter;
    const room = new GameRoom(roomId);

    newPlayers.forEach(player => {
      room.addPlayer(player);
      player.send({
        type: 'matched',
        roomId: roomId,
        playerCount: 4,
      });
    });

    rooms.set(roomId, room);

    // 全プレイヤーに他プレイヤーリストを送信
    room.broadcastAll({
      type: 'players_list',
      players: room.getPlayersList(),
    });

    console.log(`[Room ${roomId}] created with 4 players`);
  }
}

// クライアント接続処理
wss.on('connection', ws => {
  const playerId = Math.random().toString(36).slice(2, 11);
  const player = new Player(ws, playerId);

  console.log(`[Player ${playerId}] connected`);

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg.toString());
      handleMessage(player, data);
    } catch (e) {
      console.error('Parse error:', e);
    }
  });

  ws.on('close', () => {
    handlePlayerDisconnect(player);
  });

  ws.on('error', err => {
    console.error('WebSocket error:', err);
  });

  // マッチメイキング要求
  player.send({
    type: 'welcome',
    playerId: playerId,
  });
});

function handleMessage(player, data) {
  if (data.type === 'matchmake') {
    // キューに追加
    if (!matchmakingQueue.find(p => p.id === player.id)) {
      matchmakingQueue.push(player);
      console.log(`[Matchmake] Queue size: ${matchmakingQueue.length}`);
      tryCreateRoom();
    }
  }

  if (data.type === 'cancel_matchmake') {
    const idx = matchmakingQueue.findIndex(p => p.id === player.id);
    if (idx >= 0) {
      matchmakingQueue.splice(idx, 1);
      console.log(`[Matchmake] Player ${player.id} cancelled`);
    }
  }

  if (data.type === 'state_update' && player.roomId) {
    const room = rooms.get(player.roomId);
    if (room) {
      player.x = data.x;
      player.y = data.y;
      player.heading = data.heading;
      player.moving = data.moving;
      player.pulse = data.pulse;
      player.state = data.state;

      // 他プレイヤーへ同期
      room.broadcast(
        {
          type: 'player_update',
          playerId: player.id,
          x: player.x,
          y: player.y,
          heading: player.heading,
          moving: player.moving,
          pulse: player.pulse,
          state: player.state,
        },
        player.id
      );
    }
  }

  if (data.type === 'event' && player.roomId) {
    const room = rooms.get(player.roomId);
    if (room) {
      room.broadcast(
        {
          type: 'event',
          playerId: player.id,
          event: data.event,
          x: data.x,
          y: data.y,
        },
        player.id
      );
    }
  }

  if (data.type === 'game_over' && player.roomId) {
    const room = rooms.get(player.roomId);
    if (room) {
      room.broadcastAll({
        type: 'player_defeated',
        playerId: player.id,
      });
    }
  }

  if (data.type === 'leave_room' && player.roomId) {
    handlePlayerLeaveRoom(player);
  }
}

function handlePlayerDisconnect(player) {
  // マッチメイキングキューから削除
  const queueIdx = matchmakingQueue.findIndex(p => p.id === player.id);
  if (queueIdx >= 0) {
    matchmakingQueue.splice(queueIdx, 1);
  }

  // ルームから削除
  if (player.roomId) {
    handlePlayerLeaveRoom(player);
  }

  console.log(`[Player ${player.id}] disconnected`);
}

function handlePlayerLeaveRoom(player) {
  if (!player.roomId) return;

  const room = rooms.get(player.roomId);
  if (room) {
    room.broadcast({
      type: 'player_left',
      playerId: player.id,
    });

    room.removePlayer(player.id);

    if (room.isEmpty()) {
      rooms.delete(player.roomId);
      console.log(`[Room ${player.roomId}] closed`);
    }
  }

  player.roomId = null;
}

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/stats', (req, res) => {
  res.json({
    queue_size: matchmakingQueue.length,
    active_rooms: rooms.size,
    connected_players: wss.clients.size,
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
