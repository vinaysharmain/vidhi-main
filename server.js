require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { CohereClient } = require('cohere-ai');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/build')));
}

// Initialize Cohere client
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY
});

// Store active debates
const activeDebates = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('joinDebate', (data) => {
    const { topic, username, team } = data;
    if (!activeDebates.has(topic)) {
      activeDebates.set(topic, {
        participants: new Map(),
        messages: [],
        points: { team1: 0, team2: 0 },
        polls: new Map()
      });
    }
    const debate = activeDebates.get(topic);
    debate.participants.set(socket.id, { username, team });
    socket.join(topic);
    socket.emit('debateJoined', { topic, username, team });
    io.to(topic).emit('userJoined', { username });
  });

  socket.on('sendMessage', (message) => {
    const debate = activeDebates.get(message.topic);
    if (debate) {
      const messageWithId = { ...message, id: Date.now() };
      debate.messages.push(messageWithId);
      io.to(message.topic).emit('receiveMessage', messageWithId);
    }
  });

  socket.on('sendVoiceMessage', (message) => {
    const debate = activeDebates.get(message.topic);
    if (debate) {
      const messageWithId = { ...message, id: Date.now() };
      debate.messages.push(messageWithId);
      io.to(message.topic).emit('receiveVoiceMessage', messageWithId);
    }
  });

  socket.on('votePoll', (data) => {
    const debate = activeDebates.get(data.topic);
    if (debate) {
      let poll = debate.polls.get(data.pollId);
      if (!poll) {
        poll = { votes: { valid: 0, invalid: 0 }, totalVotes: 0 };
        debate.polls.set(data.pollId, poll);
      }
      poll.votes[data.vote]++;
      poll.totalVotes++;
      io.to(data.topic).emit('pollUpdate', {
        pollId: data.pollId,
        votes: poll.votes,
        totalVotes: poll.totalVotes
      });
    }
  });

  socket.on('checkFact', async (data) => {
    try {
      const response = await cohere.generate({
        prompt: `Fact check this statement: ${data.text}`,
        max_tokens: 300,
        temperature: 0.7,
        k: 0,
        stop_sequences: [],
        return_likelihoods: 'NONE'
      });

      const result = {
        original: data.text,
        result: response.body.generations[0].text,
        timestamp: new Date().toLocaleTimeString()
      };

      socket.emit('factCheckResult', result);
    } catch (error) {
      console.error('Fact check error:', error);
      socket.emit('factCheckError', { message: 'Error checking fact' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    // Clean up user from active debates
    activeDebates.forEach((debate, topic) => {
      if (debate.participants.has(socket.id)) {
        const user = debate.participants.get(socket.id);
        debate.participants.delete(socket.id);
        io.to(topic).emit('userLeft', { username: user.username });
      }
    });
  });
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Handle React routing in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 