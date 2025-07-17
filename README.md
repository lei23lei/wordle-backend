# WORDLE Backend - Two Player WebSocket Server

A Node.js WebSocket server for a two-player WORDLE game where players compete to solve the word first.

## Features

- **Room Management**: Create and join rooms with unique IDs
- **Two-Player Game**: Maximum 2 players per room
- **Turn-Based Gameplay**: Players take turns making guesses
- **Real-time Updates**: WebSocket communication for instant game updates
- **Game State Management**: Track guesses, turns, and game status
- **Word Validation**: Uses local word list + Dictionary API for validation
- **WORDLE Logic**: Proper letter evaluation (correct, present, absent)

## Installation

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```
PORT=8000
```

3. Start the server:

```bash
node index.js
```

## WebSocket API

### Connection

Connect to the WebSocket server:

```javascript
const socket = io("http://localhost:8000");
```

### Events

#### Client to Server Events

**`createRoom`**

- Creates a new game room
- Returns: `{ success: true, roomId: "ABC123" }`

```javascript
socket.emit("createRoom", (response) => {
  console.log(response.roomId); // Room ID to share with other player
});
```

**`joinRoom`**

- Joins an existing room by ID
- Parameters: `roomId` (string)
- Returns: `{ success: true, roomId: "ABC123" }` or `{ success: false, error: "..." }`

```javascript
socket.emit("joinRoom", "ABC123", (response) => {
  if (response.success) {
    console.log("Joined room:", response.roomId);
  } else {
    console.log("Error:", response.error);
  }
});
```

**`startGame`**

- Starts the game (only room host can call this)
- Requires at least 2 players in the room

```javascript
socket.emit("startGame");
```

**`submitGuess`**

- Submits a 5-letter word guess
- Parameters: `guess` (string, uppercase)
- Must be your turn to submit
- Validates word against local list + Dictionary API

```javascript
socket.emit("submitGuess", "APPLE");
```

**`getRoomStatus`**

- Gets current room status
- Returns: Room object with game state

```javascript
socket.emit("getRoomStatus", (response) => {
  console.log("Room status:", response.room);
});
```

#### Server to Client Events

**`playerJoined`**

- Emitted when a new player joins the room

```javascript
socket.on("playerJoined", (data) => {
  console.log("Player joined:", data.playerId);
  console.log("Players in room:", data.playerCount);
});
```

**`gameStarted`**

- Emitted when the game begins

```javascript
socket.on("gameStarted", (data) => {
  console.log("Game started!");
  console.log("Current turn:", data.currentTurn);
  console.log("Players:", data.players);
});
```

**`turnChanged`**

- Emitted when it's a new player's turn

```javascript
socket.on("turnChanged", (data) => {
  console.log("Current turn:", data.currentTurn);
  console.log("Player guesses:", data.playerGuesses);
  console.log("Player guess states:", data.playerGuessStates);
});
```

**`gameOver`**

- Emitted when the game ends

```javascript
socket.on("gameOver", (data) => {
  if (data.winner) {
    console.log("Winner:", data.winner);
  } else {
    console.log("It's a tie!");
  }
  console.log("The word was:", data.word);
  console.log("All guesses:", data.playerGuesses);
  console.log("All guess states:", data.playerGuessStates);
});
```

**`playerLeft`**

- Emitted when a player disconnects

```javascript
socket.on("playerLeft", (data) => {
  console.log("Player left:", data.playerId);
  console.log("Players remaining:", data.playerCount);
});
```

**`error`**

- Emitted when an error occurs

```javascript
socket.on("error", (error) => {
  console.log("Error:", error.message);
});
```

## Game Rules

1. **Room Creation**: First player creates a room and gets a room ID
2. **Joining**: Second player joins using the room ID
3. **Game Start**: Host starts the game when both players are ready
4. **Turns**: Players take turns making 5-letter word guesses
5. **Word Validation**: Words must be valid English words (checked against local list + Dictionary API)
6. **Letter Evaluation**: Each letter is marked as:
   - 🟩 **Correct**: Letter is in the right position
   - 🟨 **Present**: Letter is in the word but wrong position
   - ⬛ **Absent**: Letter is not in the word
7. **Winning**: First player to guess the word correctly wins
8. **Tie**: If both players use all 6 guesses without winning, it's a tie

## Data Structures

### Room Object

```javascript
{
  id: "ABC123",
  players: ["socketId1", "socketId2"],
  word: "DREAM", // The target word
  gameStarted: true,
  currentTurn: "socketId1",
  playerGuesses: {
    "socketId1": ["APPLE", "BEACH"],
    "socketId2": ["CHAIR"]
  },
  playerGuessStates: {
    "socketId1": [
      ["absent", "present", "present", "absent", "absent"],
      ["absent", "correct", "correct", "absent", "absent"]
    ],
    "socketId2": [
      ["absent", "absent", "correct", "absent", "absent"]
    ]
  },
  gameOver: false,
  winner: null
}
```

### Guess States

- `"correct"`: Letter is in the correct position
- `"present"`: Letter is in the word but wrong position
- `"absent"`: Letter is not in the word

## HTTP Endpoints

**`GET /`** - Health check

```json
{
  "message": "WORDLE Backend Server",
  "status": "running",
  "activeRooms": 5,
  "activePlayers": 8
}
```

**`GET /rooms`** - List active rooms (debugging)

```json
{
  "rooms": [
    {
      "id": "ABC123",
      "playerCount": 2,
      "gameStarted": true,
      "gameOver": false
    }
  ]
}
```

## Frontend Integration Example

```javascript
import { io } from "socket.io-client";
const socket = io("http://localhost:8000");

// Create a room
socket.emit("createRoom", (response) => {
  if (response.success) {
    setRoomId(response.roomId);
    setGameState("waiting");
  }
});

// Join a room
socket.emit("joinRoom", roomId, (response) => {
  if (response.success) {
    setGameState("waiting");
  }
});

// Listen for game updates
socket.on("gameStarted", (data) => {
  setGameState("playing");
  setCurrentTurn(data.currentTurn);
});

socket.on("turnChanged", (data) => {
  setCurrentTurn(data.currentTurn);
  setPlayerGuesses(data.playerGuesses);
  setPlayerGuessStates(data.playerGuessStates);
});

socket.on("gameOver", (data) => {
  setGameState("finished");
  setWinner(data.winner);
  setWord(data.word);
  setPlayerGuesses(data.playerGuesses);
  setPlayerGuessStates(data.playerGuessStates);
});

// Submit a guess
const submitGuess = (guess) => {
  socket.emit("submitGuess", guess.toUpperCase());
};
```

## Environment Variables

- `PORT`: Server port (default: 8000)

## Dependencies

- `express`: Web framework
- `socket.io`: WebSocket library
- `cors`: Cross-origin resource sharing
- `dotenv`: Environment variable management
# wordle-backend
