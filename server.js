const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const LIVEKIT_API_KEY = 'APIEhcDYMzGiVgY';
const LIVEKIT_API_SECRET = 'Of5D5KkwsbBNpAklfm1tKAqjCn4ntZgHLW7ng9ILiS6';
const LIVEKIT_URL = 'wss://vox-285kxqsh.livekit.cloud';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const users = {};
const channels = {};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function broadcastChannelMembers(channelCode) {
  if (!channels[channelCode]) return;
  const members = channels[channelCode].members;
  members.forEach(socketId => {
    io.to(socketId).emit('channel_members', 
      members.map(id => users[id]?.username).filter(Boolean)
    );
  });
}

app.get('/token', async (req, res) => {
  const { username, room } = req.query;
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: username,
  });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  res.json({ token: await token.toJwt() });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('update_location', (data) => {
    users[socket.id] = {
      username: data.username,
      latitude: data.latitude,
      longitude: data.longitude,
      blockedUsers: users[socket.id]?.blockedUsers || [],
    };

    const nearby = [];
    for (const [id, user] of Object.entries(users)) {
      if (id === socket.id) continue;
      if (users[socket.id].blockedUsers.includes(user.username)) continue;
      const dist = getDistance(
        data.latitude, data.longitude,
        user.latitude, user.longitude
      );
      if (dist <= 91) {
        nearby.push({ username: user.username, distance: Math.round(dist) });
      }
    }
    socket.emit('nearby_users', nearby);
  });

  socket.on('create_channel', (data) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.join(code);
    channels[code] = { members: [socket.id] };
    users[socket.id] = { ...users[socket.id], username: data.username };
    socket.emit('channel_created', { code });
    broadcastChannelMembers(code);
    console.log(`${data.username} created channel ${code}`);
  });

  socket.on('join_channel', (data) => {
    socket.join(data.code);
    if (!channels[data.code]) {
      channels[data.code] = { members: [] };
    }
    channels[data.code].members.push(socket.id);
    users[socket.id] = { ...users[socket.id], username: data.username };
    socket.to(data.code).emit('user_joined_channel', { username: data.username });
    socket.emit('channel_joined', { code: data.code });
    broadcastChannelMembers(data.code);
    console.log(`${data.username} joined channel ${data.code}`);
  });

  socket.on('speaking', (data) => {
    const user = users[socket.id];
    if (!user || !data.channelCode) return;
    socket.to(data.channelCode).emit('user_speaking', {
      username: user.username,
      speaking: data.speaking,
    });
  });

  socket.on('block_user', (data) => {
    if (!users[socket.id]) return;
    if (!users[socket.id].blockedUsers) {
      users[socket.id].blockedUsers = [];
    }
    users[socket.id].blockedUsers.push(data.blocked);
    console.log(`${data.username} blocked ${data.blocked}`);
  });

  socket.on('mute_user', (data) => {
    console.log(`${data.username} muted ${data.muted}`);
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    for (const code in channels) {
      channels[code].members = channels[code].members.filter(id => id !== socket.id);
      broadcastChannelMembers(code);
      if (channels[code].members.length === 0) {
        delete channels[code];
      }
    }
    delete users[socket.id];
    console.log('User disconnected:', socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Vox server running on port', process.env.PORT || 3000);
});