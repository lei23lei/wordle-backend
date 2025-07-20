// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { VALID_WORDS } = require("./words.js");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000", // In production, replace with your frontend URL
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Game state management
const rooms = new Map();
const players = new Map();

// Generate random room ID (numbers only)
function generateRoomId() {
  return Math.floor(Math.random() * 900000) + 100000; // 6-digit number (100000-999999)
}

// Get a random word for the game
function getRandomWord() {
  return VALID_WORDS[Math.floor(Math.random() * VALID_WORDS.length)];
}

// Word validation using Free Dictionary API with local fallback
async function isValidWord(word) {
  const wordStr = word.toUpperCase();

  // First check local word list (instant)
  if (VALID_WORDS.includes(wordStr)) {
    return true;
  }

  // If not in local list, check API
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${wordStr.toLowerCase()}`
    );
    return response.ok;
  } catch {
    // If API fails, fall back to local list only
    console.warn("Dictionary API failed, using local validation only");
    return false;
  }
}

// Evaluate guess according to WORDLE rules
function evaluateGuess(guess, targetWord) {
  const result = new Array(5);
  const targetArray = targetWord.split("");
  const guessArray = guess.split("");
  console.log(targetWord);
  // First pass: mark correct letters
  for (let i = 0; i < 5; i++) {
    if (guessArray[i] === targetArray[i]) {
      result[i] = "correct";
      targetArray[i] = null; // Mark as used
      guessArray[i] = null; // Mark as used
    }
  }

  // Second pass: mark present letters
  for (let i = 0; i < 5; i++) {
    if (guessArray[i] !== null) {
      const targetIndex = targetArray.indexOf(guessArray[i]);
      if (targetIndex !== -1) {
        result[i] = "present";
        targetArray[targetIndex] = null; // Mark as used
      } else {
        result[i] = "absent";
      }
    }
  }

  return result;
}

// Create sanitized game state (hides actual words from other players)
function createGameStateForPlayer(room, playerId) {
  const gameState = {
    gameStarted: room.gameStarted,
    gameOver: room.gameOver,
    winner: room.winner,
    word: room.gameOver ? room.word : undefined, // Only reveal word when game is over
    players: room.players,
    playerGuessStates: {},
    playerGuessesCount: {},
    myGuesses: room.playerGuesses.get(playerId) || [],
    myGuessStates: room.playerGuessStates.get(playerId) || [],
  };

  // For each player, show guess states
  room.players.forEach((pid) => {
    const guesses = room.playerGuesses.get(pid) || [];
    const states = room.playerGuessStates.get(pid) || [];

    gameState.playerGuessStates[pid] = states;
    gameState.playerGuessesCount[pid] = guesses.length;
  });

  // When game is over, reveal all players' actual guesses
  if (room.gameOver) {
    gameState.playerGuesses = {};
    room.players.forEach((pid) => {
      const guesses = room.playerGuesses.get(pid) || [];
      gameState.playerGuesses[pid] = guesses;
    });
  }

  return gameState;
}

// Socket connection handling
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create a new room
  socket.on("createRoom", (callback) => {
    const roomId = generateRoomId();
    const word = getRandomWord();

    rooms.set(roomId, {
      id: roomId,
      players: [socket.id],
      word: word,
      gameStarted: false,
      playerGuesses: new Map(),
      playerGuessStates: new Map(),
      gameOver: false,
      winner: null,
    });

    players.set(socket.id, {
      id: socket.id,
      roomId: roomId,
      isHost: true,
    });

    socket.join(roomId);

    console.log(`Room created: ${roomId} with word: ${word}`);
    callback({ success: true, roomId: roomId });
  });

  // Join an existing room
  socket.on("joinRoom", (roomId, callback) => {
    // Convert roomId to string to handle type mismatch
    const roomIdStr = String(roomId);
    const room = rooms.get(roomIdStr);

    if (!room) {
      callback({ success: false, error: "Room not found" });
      return;
    }

    if (room.players.length >= 2) {
      callback({ success: false, error: "Room is full" });
      return;
    }

    if (room.gameStarted) {
      callback({ success: false, error: "Game already started" });
      return;
    }

    // Add player to room
    room.players.push(socket.id);
    players.set(socket.id, {
      id: socket.id,
      roomId: roomIdStr,
      isHost: false,
    });

    socket.join(roomIdStr);

    // Notify all players in the room
    io.to(roomIdStr).emit("playerJoined", {
      playerId: socket.id,
      playerCount: room.players.length,
    });

    console.log(`Player ${socket.id} joined room ${roomIdStr}`);
    callback({ success: true, roomId: roomIdStr });
  });

  // Start the game
  socket.on("startGame", () => {
    const player = players.get(socket.id);
    if (!player) return;

    const room = rooms.get(player.roomId);
    if (!room || !player.isHost) return;

    if (room.players.length < 2) {
      socket.emit("error", { message: "Need at least 2 players to start" });
      return;
    }

    room.gameStarted = true;

    // Initialize player guesses
    room.players.forEach((playerId) => {
      room.playerGuesses.set(playerId, []);
      room.playerGuessStates.set(playerId, []);
    });

    // Send game started event to all players with their personalized state
    room.players.forEach((playerId) => {
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        const gameState = createGameStateForPlayer(room, playerId);
        playerSocket.emit("gameStarted", gameState);
      }
    });

    console.log(`Game started in room ${room.id}`);
  });

  // Submit a guess - now works simultaneously for both players
  socket.on("submitGuess", async (guess) => {
    const player = players.get(socket.id);
    if (!player) return;

    const room = rooms.get(player.roomId);
    if (!room || !room.gameStarted || room.gameOver) return;

    // Validate guess (5 letters)
    if (guess.length !== 5 || !/^[A-Z]+$/.test(guess)) {
      socket.emit("error", { message: "Invalid guess. Must be 5 letters." });
      return;
    }

    // Check if player already has 6 guesses
    const currentGuesses = room.playerGuesses.get(socket.id) || [];
    if (currentGuesses.length >= 6) {
      socket.emit("error", { message: "You have already used all 6 guesses." });
      return;
    }

    // Validate word exists
    const isValid = await isValidWord(guess);
    if (!isValid) {
      socket.emit("error", { message: "Not in dictionary" });
      return;
    }

    // Add guess to player's history
    const playerGuesses = room.playerGuesses.get(socket.id) || [];
    const playerGuessStates = room.playerGuessStates.get(socket.id) || [];

    playerGuesses.push(guess);
    const evaluation = evaluateGuess(guess, room.word);
    playerGuessStates.push(evaluation);

    room.playerGuesses.set(socket.id, playerGuesses);
    room.playerGuessStates.set(socket.id, playerGuessStates);

    console.log(
      `Player ${socket.id} guessed "${guess}" for word "${room.word}"`
    );

    // Check if guess is correct
    const isCorrect = evaluation.every((state) => state === "correct");

    if (isCorrect) {
      // Game over - this player wins
      room.gameOver = true;
      room.winner = socket.id;

      // Send game over event to all players with full game state
      room.players.forEach((playerId) => {
        const playerSocket = io.sockets.sockets.get(playerId);
        if (playerSocket) {
          const gameState = createGameStateForPlayer(room, playerId);
          playerSocket.emit("gameOver", gameState);
        }
      });

      console.log(`Game over in room ${room.id}. Winner: ${socket.id}`);
    } else {
      // Check if this player has used all 6 guesses
      if (playerGuesses.length >= 6) {
        // Check if other player has also finished or used all guesses
        const otherPlayer = room.players.find((p) => p !== socket.id);
        const otherPlayerGuesses = room.playerGuesses.get(otherPlayer) || [];
        const otherPlayerStates = room.playerGuessStates.get(otherPlayer) || [];

        // Check if other player won
        const otherPlayerWon = otherPlayerStates.some((states) =>
          states.every((state) => state === "correct")
        );

        if (otherPlayerGuesses.length >= 6 || otherPlayerWon) {
          // Both players finished - determine winner or tie
          room.gameOver = true;

          if (otherPlayerWon) {
            room.winner = otherPlayer;
          } else {
            room.winner = null; // Tie
          }

          // Send game over event to all players
          room.players.forEach((playerId) => {
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
              const gameState = createGameStateForPlayer(room, playerId);
              playerSocket.emit("gameOver", gameState);
            }
          });

          console.log(
            `Game over in room ${room.id}. Winner: ${room.winner || "Tie"}`
          );
        }
      }

      // If game is not over, send updated state to all players
      if (!room.gameOver) {
        room.players.forEach((playerId) => {
          const playerSocket = io.sockets.sockets.get(playerId);
          if (playerSocket) {
            const gameState = createGameStateForPlayer(room, playerId);
            playerSocket.emit("gameStateUpdate", gameState);
          }
        });
      }
    }
  });

  // Restart game (either player can restart)
  socket.on("restartGame", () => {
    const player = players.get(socket.id);
    if (!player) return;

    const room = rooms.get(player.roomId);
    if (!room) return;

    // Reset game state
    room.word = getRandomWord();
    room.gameStarted = true;
    room.gameOver = false;
    room.winner = null;

    // Clear all player guesses
    room.players.forEach((playerId) => {
      room.playerGuesses.set(playerId, []);
      room.playerGuessStates.set(playerId, []);
    });

    // Notify all players that game restarted
    room.players.forEach((playerId) => {
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        const gameState = createGameStateForPlayer(room, playerId);
        playerSocket.emit("gameRestarted", gameState);
      }
    });

    console.log(
      `Game restarted in room ${room.id} with new word: ${room.word}`
    );
  });

  // Get room status
  socket.on("getRoomStatus", (callback) => {
    const player = players.get(socket.id);
    if (!player) {
      callback({ success: false, error: "Player not found" });
      return;
    }

    const room = rooms.get(player.roomId);
    if (!room) {
      callback({ success: false, error: "Room not found" });
      return;
    }

    const gameState = createGameStateForPlayer(room, socket.id);
    callback({
      success: true,
      room: {
        id: room.id,
        ...gameState,
      },
    });
  });

  // Handle explicit leave room (when clicking "Return Home")
  socket.on("leaveRoom", () => {
    console.log(`User explicitly left room: ${socket.id}`);
    handlePlayerLeaving(socket.id, "quit");
  });

  // Shared function to handle player leaving (disconnect or explicit leave)
  function handlePlayerLeaving(playerId, reason = "disconnect") {
    const player = players.get(playerId);
    if (player) {
      const room = rooms.get(player.roomId);
      if (room) {
        // Remove player from room
        room.players = room.players.filter((p) => p !== playerId);

        if (room.players.length === 0) {
          // Room is empty, delete it
          rooms.delete(player.roomId);
          console.log(`Room ${player.roomId} deleted (empty)`);
        } else {
          // Notify remaining players
          io.to(player.roomId).emit("playerLeft", {
            playerId: playerId,
            playerCount: room.players.length,
          });

          // If game was started (whether in progress or finished), handle opponent leaving
          if (room.gameStarted) {
            const remainingPlayerId = room.players[0];
            const remainingSocket = io.sockets.sockets.get(remainingPlayerId);
            if (remainingSocket) {
              if (room.gameOver) {
                // Game is finished - send gameOver event with quit reason to update dialog
                const gameState = createGameStateForPlayer(
                  room,
                  remainingPlayerId
                );
                gameState.quitReason = "opponent_quit";
                remainingSocket.emit("gameOver", gameState);
              } else {
                // Game is in progress - end the game and show dialog with quit reason
                room.gameOver = true;
                room.winner = remainingPlayerId; // Remaining player wins
                const gameState = createGameStateForPlayer(
                  room,
                  remainingPlayerId
                );
                gameState.quitReason = "opponent_quit";
                remainingSocket.emit("gameOver", gameState);
              }
            }
          }
        }
      }

      players.delete(playerId);
    }
  }

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    handlePlayerLeaving(socket.id, "disconnect");
  });
});

// Basic health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "WORDLE Backend Server",
    status: "running",
    activeRooms: rooms.size,
    activePlayers: players.size,
  });
});

// Get active rooms (for debugging)
app.get("/rooms", (req, res) => {
  const roomList = Array.from(rooms.values()).map((room) => ({
    id: room.id,
    playerCount: room.players.length,
    gameStarted: room.gameStarted,
    gameOver: room.gameOver,
  }));

  res.json({ rooms: roomList });
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
  console.log(`WORDLE Backend Server is running on port ${PORT}`);
  console.log(`WebSocket server is ready for connections`);
});
