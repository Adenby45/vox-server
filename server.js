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

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
    };

    const nearby = [];
    for (const [id, user] of Object.entries(users)) {
      if (id === socket.id) continue;
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
    socket.emit('channel_created', { code });
    console.log(`${data.username} created channel ${code}`);
  });

  socket.on('join_channel', (data) => {
    socket.join(data.code);
    socket.to(data.code).emit('user_joined_channel', { username: data.username });
    socket.emit('channel_joined', { code: data.code });
    console.log(`${data.username} joined channel ${data.code}`);
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    console.log('User disconnected:', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Vox server running on port 3000');
});