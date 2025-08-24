const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fs = require('fs');

// Import LowCard bot using CommonJS require
let lowCardBot = null;
try {
  // Try TypeScript version first, then fallback to JavaScript version
  try {
    const { processLowCardCommand, handleLowCardBot, isBotActiveInRoom, getBotStatus } = require('./games/lowcard.ts');
    lowCardBot = { processLowCardCommand, handleLowCardBot, isBotActiveInRoom, getBotStatus };
    console.log('LowCard bot loaded successfully from TypeScript');
  } catch (tsError) {
    const { processLowCardCommand, handleLowCardBot, isBotActiveInRoom, getBotStatus } = require('../src/games/lowcard.js');
    lowCardBot = { processLowCardCommand, handleLowCardBot, isBotActiveInRoom, getBotStatus };
    console.log('LowCard bot loaded successfully from JavaScript fallback');
  }
} catch (error) {
  console.error('Failed to load LowCard bot:', error);
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`; // For constructing image URLs

// Multer storage configuration for emojis
const storageEmoji = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/emojis/');
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const uploadEmoji = multer({ storage: storageEmoji });

// Multer storage configuration for gifts
const storageGift = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/gifts/');
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const uploadGift = multer({ storage: storageGift });

// Multer storage configuration for generic uploads (e.g., media for posts)
const storageUpload = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/media/');
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storageUpload });


// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Successfully connected to PostgreSQL database');
    release();
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for potential file data
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // For form data

// Error handling middleware for JSON parsing
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Bad JSON:', err.message);
    return res.status(400).json({ error: 'Invalid JSON format: ' + err.message });
  }
  next();
});

// Add request logging for API routes only
app.use('/api', (req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  if (req.path.includes('admin')) {
    console.log('🔐 Admin endpoint accessed');
    console.log('Headers:', {
      authorization: req.headers.authorization ? 'Present' : 'Missing',
      'content-type': req.headers['content-type']
    });
    console.log('Body:', req.body);
  }
  next();
});

// Also add request logging for chat routes
app.use('/chat', (req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

// Handle preflight requests
app.options('*', cors());

// In-memory database for non-critical data (posts will be moved to DB later)
let posts = [];

// Function to save chat message to database
const saveChatMessage = async (roomId, username, content, media = null, messageType = 'message', userRole = 'user', userLevel = 1, isPrivate = false) => {
  try {
    // Get user ID by username
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    const userId = userResult.rows.length > 0 ? userResult.rows[0].id : null;

    const result = await pool.query(`
      INSERT INTO chat_messages (
        room_id, user_id, username, content, media_data,
        message_type, user_role, user_level, is_private
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      roomId,
      userId,
      username,
      content,
      media ? JSON.stringify(media) : null,
      messageType,
      userRole,
      userLevel,
      isPrivate
    ]);

    return result.rows[0];
  } catch (error) {
    console.error('Error saving chat message:', error);
    return null;
  }
};

// Database initialization - create tables if they don't exist
const initDatabase = async () => {
  try {
    // Create users table only if it doesn't exist (preserve existing data)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        country VARCHAR(50),
        gender VARCHAR(10),
        bio TEXT DEFAULT '',
        avatar TEXT,
        verified BOOLEAN DEFAULT false,
        birth_date DATE,
        signature TEXT,
        role VARCHAR(20) DEFAULT 'user',
        pin VARCHAR(6) DEFAULT '123456',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        exp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1
      )
    `);

    // Add role column if it doesn't exist (for existing databases)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
          ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
        END IF;
      END $$;
    `);

    // Add pin column if it doesn't exist (for existing databases)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pin') THEN
          ALTER TABLE users ADD COLUMN pin VARCHAR(6) DEFAULT '123456';
        END IF;
      END $$;
    `);

    // Add last_login, exp, and level columns if they don't exist
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_login') THEN
          ALTER TABLE users ADD COLUMN last_login TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='exp') THEN
          ALTER TABLE users ADD COLUMN exp INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='level') THEN
          ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;
        END IF;
      END $$;
    `);


    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        managed_by VARCHAR(50),
        type VARCHAR(20) DEFAULT 'room',
        members INTEGER DEFAULT 0,
        max_members INTEGER DEFAULT 100,
        created_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(50) NOT NULL,
        content TEXT,
        media_files JSONB DEFAULT '[]',
        likes INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS post_comments (
        id BIGSERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id),
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS privacy_settings (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) UNIQUE,
        profile_visibility VARCHAR(20) DEFAULT 'public',
        privacy_notifications BOOLEAN DEFAULT true,
        location_sharing BOOLEAN DEFAULT false,
        biometric_auth BOOLEAN DEFAULT false,
        two_factor_auth BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_album (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        filename VARCHAR(255) NOT NULL,
        file_data TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_gifts (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        gift_type VARCHAR(50) NOT NULL,
        given_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_follows (
        id BIGSERIAL PRIMARY KEY,
        follower_id INTEGER REFERENCES users(id),
        following_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(follower_id, following_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        achievement_type VARCHAR(50) NOT NULL,
        count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, achievement_type)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGSERIAL PRIMARY KEY,
        room_id VARCHAR(100) NOT NULL,
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        media_data TEXT,
        message_type VARCHAR(20) DEFAULT 'message',
        user_role VARCHAR(20) DEFAULT 'user',
        user_level INTEGER DEFAULT 1,
        is_private BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
    `);

    // Create support tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id BIGSERIAL PRIMARY KEY,
        ticket_id VARCHAR(50) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id),
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_responses (
        id BIGSERIAL PRIMARY KEY,
        ticket_id VARCHAR(50) REFERENCES support_tickets(ticket_id),
        user_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        response_type VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_feedback (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_credits table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_credits (
        user_id INTEGER PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create credit_transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER,
        to_user_id INTEGER,
        amount INTEGER NOT NULL,
        type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_user_id) REFERENCES users(id),
        FOREIGN KEY (to_user_id) REFERENCES users(id)
      )
    `);

    // Create merchant_promotions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_promotions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        promoted_by INTEGER NOT NULL,
        promoted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (promoted_by) REFERENCES users(id)
      )
    `);

    // Create notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        from_user_id INTEGER REFERENCES users(id),
        from_username VARCHAR(50),
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create private chats tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS private_chats (
        id VARCHAR(255) PRIMARY KEY,
        created_by VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS private_chat_participants (
        id BIGSERIAL PRIMARY KEY,
        chat_id VARCHAR(255) REFERENCES private_chats(id) ON DELETE CASCADE,
        username VARCHAR(50) NOT NULL,
        UNIQUE(chat_id, username)
      )
    `);

    // Create daily_login_rewards table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_login_rewards (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        login_date DATE NOT NULL,
        exp_reward INTEGER NOT NULL,
        consecutive_days INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, login_date)
      )
    `);

    // Create custom_emojis table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_emojis (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        emoji VARCHAR(255) NOT NULL,
        category VARCHAR(50) DEFAULT 'general',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Update existing emoji column if it exists with smaller size
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='custom_emojis' AND column_name='emoji' 
                   AND character_maximum_length = 10) THEN
          ALTER TABLE custom_emojis ALTER COLUMN emoji TYPE VARCHAR(255);
        END IF;
      END $$;
    `);

    // Create custom_gifts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_gifts (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        icon VARCHAR(100) NOT NULL,
        image VARCHAR(500),
        animation TEXT,
        price INTEGER NOT NULL DEFAULT 100,
        type VARCHAR(20) DEFAULT 'static',
        category VARCHAR(100) DEFAULT 'popular',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'text',
        file_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create password_resets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `);

    // Create emojis table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emojis (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create friendships table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, friend_id)
      )
    `);

    // Create user_exp_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_exp_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        activity_type VARCHAR(50) NOT NULL,
        exp_gained INTEGER NOT NULL,
        new_exp INTEGER NOT NULL,
        new_level INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');

    // Add default admin user 'asu' if not exists
    try {
      const existingUser = await pool.query('SELECT id, role FROM users WHERE username = $1', ['asu']);
      if (existingUser.rows.length === 0) {
        const hashedPassword = await bcrypt.hash('123456', 10);
        const adminUser = await pool.query(`
          INSERT INTO users (username, email, password, role, verified, exp, level, last_login)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, username, role, exp, level
        `, ['asu', 'asu@admin.com', hashedPassword, 'admin', true, 0, 1, new Date()]);

        // Initialize admin user with credits
        await pool.query(`
          INSERT INTO user_credits (user_id, balance)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO UPDATE SET balance = $2
        `, [adminUser.rows[0].id, 100000]);

        console.log('Admin user "asu" created successfully with 100,000 coins:', adminUser.rows[0]);
      } else {
        // Always ensure user has admin role and credentials
        const userId = existingUser.rows[0].id;
        await pool.query('UPDATE users SET role = $1, verified = $2 WHERE username = $3', ['admin', true, 'asu']);

        // Check if user has credits, if not add them
        const creditsResult = await pool.query('SELECT balance FROM user_credits WHERE user_id = $1', [userId]);
        if (creditsResult.rows.length === 0) {
          await pool.query(`
            INSERT INTO user_credits (user_id, balance)
            VALUES ($1, $2)
          `, [userId, 100000]);
        }

        console.log('User "asu" ensured to have admin role and credentials');
      }
    } catch (adminError) {
      console.error('Error creating/updating admin user:', adminError);
    }
  } catch (error) {
    console.error('Error initializing database:', error);
  }
};

// Load rooms from database on startup
const loadRoomsFromDatabase = async () => {
  try {
    const result = await pool.query('SELECT * FROM rooms ORDER BY created_at ASC');

    // Clear in-memory rooms and load from database
    rooms.length = 0;

    result.rows.forEach(dbRoom => {
      rooms.push({
        id: dbRoom.id.toString(),
        name: dbRoom.name,
        description: dbRoom.description,
        managedBy: dbRoom.managed_by,
        type: dbRoom.type,
        members: dbRoom.members || 0,
        maxMembers: dbRoom.max_members,
        createdBy: dbRoom.created_by,
        createdAt: dbRoom.created_at
      });
    });

    // If no rooms in database, add default rooms
    if (rooms.length === 0) {
      const defaultRooms = [
        {
          name: 'General Chat',
          description: 'General Chat - Welcome to merchant official chatroom',
          managedBy: 'admin_user',
          type: 'room',
          members: 0,
          maxMembers: 100,
          createdBy: 'admin_user'
        },
        {
          name: 'Tech Talk',
          description: 'Tech Talk - Welcome to merchant official chatroom',
          managedBy: 'tech_admin',
          type: 'room',
          members: 0,
          maxMembers: 50,
          createdBy: 'tech_admin'
        },
        {
          name: 'Indonesia',
          description: 'Indonesia - Welcome to merchant official chatroom',
          managedBy: 'admin_user',
          type: 'room',
          members: 0,
          maxMembers: 80,
          createdBy: 'admin_user'
        }
      ];

      for (const roomData of defaultRooms) {
        const result = await pool.query(`
          INSERT INTO rooms (name, description, managed_by, type, members, max_members, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [roomData.name, roomData.description, roomData.managedBy, roomData.type, roomData.members, roomData.maxMembers, roomData.createdBy]);

        const dbRoom = result.rows[0];
        rooms.push({
          id: dbRoom.id.toString(),
          name: dbRoom.name,
          description: dbRoom.description,
          managedBy: dbRoom.managed_by,
          type: dbRoom.type,
          members: dbRoom.members,
          maxMembers: dbRoom.max_members,
          createdBy: dbRoom.created_by,
          createdAt: dbRoom.created_at
        });
      }
    }

    console.log(`Loaded ${rooms.length} rooms from database:`, rooms.map(r => `${r.name} (ID: ${r.id})`));
  } catch (error) {
    console.error('Error loading rooms from database:', error);
  }
};

// Initialize database on startup
initDatabase().then(() => {
  loadRoomsFromDatabase();

  // Ensure upload directories exist
  const uploadsDir = path.join(__dirname, 'uploads');
  const giftsDir = path.join(uploadsDir, 'gifts');
  const emojisDir = path.join(uploadsDir, 'emojis');
  const mediaDir = path.join(uploadsDir, 'media');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(giftsDir)) {
    fs.mkdirSync(giftsDir, { recursive: true });
  }
  if (!fs.existsSync(emojisDir)) {
    fs.mkdirSync(emojisDir, { recursive: true });
  }
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  console.log('Upload directories initialized');
});
// Rooms data - starts with initial rooms
const rooms = [
  {
    id: '1',
    name: 'General Chat',
    description: 'General Chat - Welcome to merchant official chatroom',
    managedBy: 'admin_user',
    type: 'room',
    members: 0,
    maxMembers: 100,
    createdBy: 'admin_user'
  },
  {
    id: '2',
    name: 'Tech Talk',
    description: 'Tech Talk - Welcome to merchant official chatroom',
    managedBy: 'tech_admin',
    type: 'room',
    members: 0,
    maxMembers: 50,
    createdBy: 'tech_admin'
  },
  {
    id: '3',
    name: 'Indonesia',
    description: 'Indonesia - Welcome to merchant official chatroom',
    managedBy: 'admin_user',
    type: 'room',
    members: 0,
    maxMembers: 80,
    createdBy: 'admin_user'
  }
];

// Initialize participant data structure
const roomParticipants = {}; // { roomId: [ { id, username, role, isOnline, joinedAt, lastSeen }, ... ], ... }

// Function to generate room description
const generateRoomDescription = (roomName, creatorUsername) => {
  return `${roomName} - Welcome to merchant official chatroom. This room is managed by ${creatorUsername}`;
};

let verificationTokens = [];

// Email verification simulation (replace with real email service)
const sendVerificationEmail = (email, token) => {
  console.log(`=== EMAIL VERIFICATION ===`);
  console.log(`To: ${email}`);
  console.log(`Subject: Verify Your ChatMe Account`);
  console.log(`Verification Link: http://0.0.0.0:5000/api/verify-email?token=${token}`);
  console.log(`========================`);
  return true;
};

const JWT_SECRET = 'your-secret-key';

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('=== AUTH TOKEN MIDDLEWARE ===');
  console.log('Auth header:', authHeader ? 'Present' : 'Missing');
  console.log('Token:', token ? `Present (${token.substring(0, 20)}...)` : 'Missing');

  if (token == null) {
    console.log('No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  // Validate token format
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    console.log('Invalid token format');
    return res.status(403).json({ error: 'Invalid token format' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      console.log('Token verification failed:', err.message);
      if (err.name === 'TokenExpiredError') {
        return res.status(403).json({ error: 'Token expired' });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(403).json({ error: 'Invalid token' });
      }
      return res.status(403).json({ error: 'Token verification failed' });
    }

    console.log('Token verified for user ID:', decoded.userId);

    try {
      // Try to select with pin column first, fallback without pin if it doesn't exist
      let userResult;
      try {
        userResult = await pool.query('SELECT id, username, email, verified, pin, role, exp, level FROM users WHERE id = $1', [decoded.userId]);
      } catch (pinError) {
        if (pinError.code === '42703') { // Column doesn't exist
          console.log('Pin column does not exist, querying without it');
          userResult = await pool.query('SELECT id, username, email, verified, role, exp, level FROM users WHERE id = $1', [decoded.userId]);
        } else {
          throw pinError;
        }
      }

      if (userResult.rows.length === 0) {
        console.log('User not found for token:', decoded.userId);
        return res.status(403).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];
      console.log('User authenticated:', user.username, 'Role:', user.role);

      req.user = user; // Attach user info to request
      req.user.userId = decoded.userId; // Add userId to req.user for credit endpoints
      next(); // proceed to the next middleware or route handler
    } catch (dbError) {
      console.error('Database error during token authentication:', dbError);
      res.status(500).json({ error: 'Database error during authentication' });
    }
  });
};

// Function to add EXP to a user
const addUserEXP = async (userId, expAmount, activityType) => {
  try {
    // Get current exp and level
    const userResult = await pool.query('SELECT exp, level FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }

    const currentUser = userResult.rows[0];
    const currentExp = currentUser.exp || 0;
    const currentLevel = currentUser.level || 1;

    // Define EXP thresholds for leveling up (example)
    const expPerLevel = 1000; // 1000 EXP to reach next level

    const newExp = currentExp + expAmount;
    let newLevel = currentLevel;
    let leveledUp = false;

    // Calculate new level
    if (newExp >= currentLevel * expPerLevel) {
      newLevel = Math.floor(newExp / expPerLevel) || 1;
      leveledUp = true;
    }

    // Update user EXP and level
    await pool.query(
      'UPDATE users SET exp = $1, level = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [newExp, newLevel, userId]
    );

    console.log(`User ${userId} gained ${expAmount} EXP from ${activityType}. New EXP: ${newExp}, New Level: ${newLevel}`);

    // Optionally, record EXP gain in a separate table for history
    await pool.query(`
      INSERT INTO user_exp_history (user_id, activity_type, exp_gained, new_exp, new_level)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, activityType, expAmount, newExp, newLevel]);

    return { success: true, userId, expAmount, newExp, newLevel, leveledUp };

  } catch (error) {
    console.error(`Error adding EXP for user ${userId}:`, error);
    return { success: false, error: error.message };
  }
};


// Auth routes
// Registration endpoint
app.post('/api/auth/register', async (req, res) => {
  console.log('Registration request received:', req.body);

  try {
    const { username, password, email, phone, country, gender } = req.body;

    // Validation
    if (!username || !password || !email || !phone || !country || !gender) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      console.log('User already exists:', username);
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user in database
    const result = await pool.query(
      `INSERT INTO users (username, email, password, phone, country, gender, bio, avatar, verified, exp, level, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, username, email`,
      [username, email, hashedPassword, phone, country, gender, '', null, false, 0, 1, null]
    );

    const newUser = result.rows[0];
    console.log('User created successfully in database:', newUser.username);

    // Generate verification token
    const verificationToken = jwt.sign({ userId: newUser.id, type: 'verification' }, JWT_SECRET, { expiresIn: '1h' });
    verificationTokens.push({ token: verificationToken, userId: newUser.id });

    // Send verification email (simulation)
    sendVerificationEmail(email, verificationToken);

    res.status(201).json({
      message: 'User created successfully. Please verify your email.',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('Login request received:', { username: req.body.username });

    const { username, password } = req.body;

    if (!username || !password) {
      console.log('Missing login credentials');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      console.log('User not found:', username);
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('Invalid password for user:', username);
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

    // Check for daily login reward
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const lastLogin = user.last_login ? new Date(user.last_login).toISOString().split('T')[0] : null;

    let dailyReward = null;
    if (lastLogin !== today) {
      try {
        // Check if user already got today's reward
        const todayReward = await pool.query(
          'SELECT * FROM daily_login_rewards WHERE user_id = $1 AND login_date = $2',
          [user.id, today]
        );

        if (todayReward.rows.length === 0) {
          // Calculate consecutive days
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];

          const yesterdayReward = await pool.query(
            'SELECT consecutive_days FROM daily_login_rewards WHERE user_id = $1 AND login_date = $2',
            [user.id, yesterdayStr]
          );

          const consecutiveDays = yesterdayReward.rows.length > 0 ? yesterdayReward.rows[0].consecutive_days + 1 : 1;
          const baseReward = 50;
          const bonusReward = Math.min(consecutiveDays * 10, 200); // Max bonus 200
          const totalReward = baseReward + bonusReward;

          // Add daily login reward
          await pool.query(`
            INSERT INTO daily_login_rewards (user_id, login_date, exp_reward, consecutive_days)
            VALUES ($1, $2, $3, $4)
          `, [user.id, today, totalReward, consecutiveDays]);

          // Add EXP to user
          const expResult = await addUserEXP(user.id, totalReward, 'daily_login');

          dailyReward = {
            exp: totalReward,
            consecutiveDays: consecutiveDays,
            leveledUp: expResult?.leveledUp || false,
            newLevel: expResult?.newLevel || user.level || 1
          };
        }

        // Update last login timestamp
        await pool.query(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
          [user.id]
        );
      } catch (error) {
        console.error('Error processing daily login reward:', error);
      }
    }

    // Get updated user data with level and EXP
    const updatedUserResult = await pool.query(
      'SELECT id, username, email, bio, phone, avatar, verified, role, exp, level FROM users WHERE id = $1',
      [user.id]
    );
    const updatedUser = updatedUserResult.rows[0];

    console.log('Login successful for user:', username);

    res.json({
      token,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        bio: updatedUser.bio,
        phone: updatedUser.phone,
        avatar: updatedUser.avatar,
        verified: updatedUser.verified,
        role: updatedUser.role,
        exp: updatedUser.exp || 0,
        level: updatedUser.level || 1
      },
      dailyReward: dailyReward
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    // In a real app, you would invalidate the token on the server-side
    // For example, by adding it to a blacklist or using a short expiration time
    console.log(`User ${req.user.username} logged out successfully`);
    res.json({ message: 'Logged out successfully', success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error during logout' });
  }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    // Get user's current password
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Verify old password
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, userId]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if user has PIN
app.get('/api/auth/check-pin', authenticateToken, async (req, res) => {
  try {
    console.log('=== CHECK PIN REQUEST ===');
    console.log('User ID:', req.user.id);

    const userId = req.user.id;

    const result = await pool.query('SELECT pin FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      console.log('User not found for PIN check');
      return res.status(404).json({ error: 'User not found' });
    }

    const hasPin = result.rows[0].pin !== null && result.rows[0].pin !== '123456';
    console.log('User has custom PIN:', hasPin);
    res.json({ hasPin });
  } catch (error) {
    console.error('Check PIN error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change PIN
app.post('/api/auth/change-pin', authenticateToken, async (req, res) => {
  try {
    console.log('=== CHANGE PIN REQUEST ===');
    console.log('User ID:', req.user.id);
    console.log('Request body:', req.body);

    const { oldPin, newPin } = req.body;
    const userId = req.user.id;

    if (!newPin) {
      return res.status(400).json({ error: 'New PIN is required' });
    }

    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
      return res.status(400).json({ error: 'PIN must be exactly 6 digits' });
    }

    // Get user's current PIN
    const userResult = await pool.query('SELECT pin FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      console.log('User not found for PIN change');
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const currentPin = user.pin || '123456'; // Default PIN
    console.log('Current PIN exists:', !!user.pin);

    // Verify old PIN
    if (oldPin !== currentPin) {
      console.log('PIN verification failed');
      return res.status(400).json({ error: 'Current PIN is incorrect' });
    }

    // Update PIN in database
    await pool.query(
      'UPDATE users SET pin = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPin, userId]
    );

    res.json({ message: 'PIN changed successfully' });
  } catch (error) {
    console.error('Change PIN error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check if user exists
    const userResult = await pool.query('SELECT id, username FROM users WHERE email = $1', [email]);

    if (userResult.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ message: 'If this email exists, a reset link has been sent.' });
    }

    const user = userResult.rows[0];

    // Generate reset token (in real app, use crypto.randomBytes)
    const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

    // Store reset token in database
    await pool.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3',
      [user.id, resetToken, expiresAt]
    );

    // In real app, send email with reset link
    console.log(`=== PASSWORD RESET EMAIL ===`);
    console.log(`To: ${email}`);
    console.log(`Subject: Reset Your ChatMe Password`);
    console.log(`Reset Link: http://localhost:5000/api/auth/reset-password?token=${resetToken}`);
    console.log(`This link will expire in 1 hour.`);
    console.log(`===========================`);

    res.json({ message: 'If this email exists, a reset link has been sent.' });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoints with /api prefix
app.get('/api/admin/emojis', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(`
      SELECT id, name, emoji, category, created_at 
      FROM custom_emojis 
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching emojis:', error);
    res.status(500).json({ error: 'Failed to fetch emojis' });
  }
});

app.post('/api/admin/emojis', authenticateToken, async (req, res) => {
  try {
    console.log('=== ADD EMOJI REQUEST ===');
    console.log('User:', req.user.username);
    console.log('Body keys:', Object.keys(req.body));
    console.log('Has emojiFile:', !!req.body.emojiFile);
    console.log('Has emoji:', !!req.body.emoji);

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, category = 'general', emoji, emojiFile, emojiType, fileName } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!emojiFile && !emoji) {
      return res.status(400).json({ error: 'Either emoji file or emoji character is required' });
    }

    let emojiValue = emoji;

    // If file is uploaded, save it and use as emoji
    if (emojiFile) {
      try {
        // Validate base64 data
        if (typeof emojiFile !== 'string' || emojiFile.length < 100) {
          return res.status(400).json({ error: 'Invalid emoji file data' });
        }

        // Create uploads directory if not exists
        const uploadDir = 'uploads/emojis';
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Determine file extension
        const fileExt = emojiType || 'png';
        const uniqueFileName = `emoji_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${uploadDir}/${uniqueFileName}`;

        // Save base64 file
        const buffer = Buffer.from(emojiFile, 'base64');

        // Check buffer size (max 2MB)
        if (buffer.length > 2 * 1024 * 1024) {
          return res.status(400).json({ error: 'File too large. Maximum size is 2MB.' });
        }

        fs.writeFileSync(filePath, buffer);

        // Use file path as emoji value
        emojiValue = `/uploads/emojis/${uniqueFileName}`;

        console.log('Emoji file saved:', filePath, 'Size:', buffer.length, 'bytes');
      } catch (fileError) {
        console.error('Error saving emoji file:', fileError);
        return res.status(500).json({ error: 'Failed to save emoji file: ' + fileError.message });
      }
    }

    // Save to database
    const result = await pool.query(`
      INSERT INTO custom_emojis (name, emoji, category, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name.trim(), emojiValue, category, req.user.id]);

    console.log('Emoji added successfully:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding emoji:', error);
    res.status(500).json({ error: 'Failed to add emoji: ' + error.message });
  }
});

app.delete('/api/admin/emojis/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    // Attempt to get emoji path to delete the file
    const emojiResult = await pool.query('SELECT emoji FROM custom_emojis WHERE id = $1', [id]);
    if (emojiResult.rows.length > 0 && emojiResult.rows[0].emoji.startsWith('/uploads/emojis/')) {
      const filePath = emojiResult.rows[0].emoji.substring(1); // Remove leading slash
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
          if (err) console.error('Error deleting emoji file:', err);
        });
      }
    }

    await pool.query('DELETE FROM custom_emojis WHERE id = $1', [id]);

    res.json({ message: 'Emoji deleted successfully' });
  } catch (error) {
    console.error('Error deleting emoji:', error);
    res.status(500).json({ error: 'Failed to delete emoji' });
  }
});

// Admin endpoints for gift management
app.get('/api/admin/gifts', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log('🔐 Admin endpoint accessed');
    console.log('Headers:', { authorization: req.headers.authorization ? 'Present' : 'Missing', 'content-type': req.headers['content-type'] });
    console.log('Body:', req.body);

    console.log('User authenticated:', req.user.username, 'Role:', req.user.role);

    const result = await pool.query('SELECT * FROM custom_gifts ORDER BY created_at DESC');
    const gifts = result.rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      icon: row.icon,
      image: row.image,
      animation: row.animation,
      price: row.price,
      type: row.type || 'static',
      category: row.category || 'popular'
    }));

    res.json(gifts);
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: 'Failed to fetch gifts' });
  }
});

// Add new gift (admin only)
app.post('/api/admin/gifts', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, icon, price, type = 'static', category = 'popular', giftImage, imageType, imageName } = req.body;

    if (!name || !icon || !price) {
      return res.status(400).json({ error: 'Name, icon, and price are required' });
    }

    let imagePath = null;

    // Handle gift image upload
    if (giftImage && imageType && imageName) {
      try {
        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(__dirname, 'uploads', 'gifts');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // Generate unique filename
        const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1E9);
        // Extract file extension from imageType (e.g., 'image/jpeg' -> 'jpeg')
        const fileExtension = imageType.includes('/') ? imageType.split('/')[1] : imageType;
        const filename = `gift_${uniqueSuffix}.${fileExtension}`;
        const filepath = path.join(uploadsDir, filename);

        // Write base64 image to file
        const imageBuffer = Buffer.from(giftImage, 'base64');
        fs.writeFileSync(filepath, imageBuffer);

        imagePath = `/uploads/gifts/${filename}`;
        console.log('Gift image saved:', filename);
      } catch (error) {
        console.error('Error saving gift image:', error);
        return res.status(500).json({ error: 'Failed to save gift image' });
      }
    }

    const result = await pool.query(`
      INSERT INTO custom_gifts (name, icon, image, price, type, category, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [name, icon, imagePath, parseInt(price), type, category, req.user.id]);

    const gift = result.rows[0];
    if (gift.image) {
      gift.image = `${API_BASE_URL}${gift.image}`;
    }

    res.json(gift);
  } catch (error) {
    console.error('Error adding gift:', error);
    res.status(500).json({ error: 'Failed to add gift' });
  }
});

// Public endpoint to get emojis for chat emoji picker
app.get('/api/emojis', async (req, res) => {
  try {
    console.log('Loading emojis for emoji picker...');
    const result = await pool.query(`
      SELECT id, name, emoji, category, created_at 
      FROM custom_emojis 
      ORDER BY created_at DESC
    `);

    const emojis = result.rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      url: row.emoji.startsWith('/uploads/') ? `${req.protocol}://${req.get('host')}${row.emoji}` : row.emoji,
      type: row.emoji.startsWith('/uploads/') ? 'image' : 'text',
      category: row.category,
      emoji: row.emoji.startsWith('/uploads/') ? undefined : row.emoji
    }));

    console.log(`Returning ${emojis.length} emojis for emoji picker`);
    res.json(emojis);
  } catch (error) {
    console.error('Error fetching emojis for picker:', error);
    res.status(500).json({ error: 'Failed to fetch emojis' });
  }
});

// Public endpoint to get gifts for chat gift picker
app.get('/api/gifts', async (req, res) => {
  try {
    console.log('Loading gifts for gift picker...');

    // Get custom gifts from database
    const result = await pool.query('SELECT * FROM custom_gifts ORDER BY created_at DESC');

    const gifts = result.rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      icon: row.icon,
      price: row.price,
      type: row.type || 'static',
      category: row.category || 'popular',
      image: row.image ? `${API_BASE_URL}${row.image}` : null,
      animation: row.animation
    }));

    // If no custom gifts in database, return default gifts
    if (gifts.length === 0) {
      const defaultGifts = [
        { id: '1', name: 'Lucky Rose', icon: '🌹', price: 10, type: 'static', category: 'lucky' },
        { id: '2', name: 'Ionceng', icon: '🔔', price: 20, type: 'static', category: 'popular' },
        { id: '3', name: 'Lucky Pearls', icon: '🦪', price: 50, type: 'static', category: 'lucky' },
        { id: '4', name: 'Kertas Perkamen', icon: '📜', price: 450, type: 'static', category: 'bangsa' },
        { id: '5', name: 'Kincir Angin', icon: '🌪️', price: 10000, type: 'animated', category: 'set kostum' },
        { id: '6', name: 'Blind Box', icon: '📦', price: 188000, type: 'animated', category: 'tas saya' },
        { id: '7', name: 'Hiasan Berlapis', icon: '✨', price: 100000, type: 'animated', category: 'bangsa' },
        { id: '8', name: 'Doa Bintang', icon: '⭐', price: 1000000, type: 'animated', category: 'tas saya' },
      ];
      console.log(`Returning ${defaultGifts.length} default gifts for gift picker`);
      return res.json(defaultGifts);
    }

    console.log(`Returning ${gifts.length} gifts for gift picker`);
    res.json(gifts);
  } catch (error) {
    console.error('Error fetching gifts for picker:', error);
    res.status(500).json({ error: 'Failed to fetch gifts' });
  }
});

// Upload endpoint for admin gift management
app.post('/api/admin/upload-gift', uploadGift.single('gift'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, icon, price, type = 'static' } = req.body;

    if (!name || !icon || !price) {
      return res.status(400).json({ error: 'Name, icon, and price are required' });
    }

    const animationPath = `/uploads/gifts/${req.file.filename}`;

    const result = await pool.query(`
      INSERT INTO custom_gifts (name, icon, animation, price, type, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, icon, animationPath, parseInt(price), type, req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding gift:', error);
    res.status(500).json({ error: 'Failed to add gift' });
  }
});

app.delete('/api/admin/gifts/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    // Attempt to get file path to delete the file
    const giftResult = await pool.query('SELECT animation FROM custom_gifts WHERE id = $1', [id]);
    if (giftResult.rows.length > 0 && giftResult.rows[0].animation) {
      const filePath = giftResult.rows[0].animation.substring(1); // Remove leading slash
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
          if (err) console.error('Error deleting gift file:', err);
        });
      }
    }

    await pool.query('DELETE FROM custom_gifts WHERE id = $1', [id]);

    res.json({ message: 'Gift deleted successfully' });
  } catch (error) {
    console.error('Error deleting gift:', error);
    res.status(500).json({ error: 'Failed to delete gift' });
  }
});

// Email verification endpoint
app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('<h1>Invalid verification link</h1>');
  }

  // Find token in our list
  const tokenEntry = verificationTokens.find(t => t.token === token);
  if (!tokenEntry) {
    return res.status(400).send('<h1>Invalid or expired verification link</h1>');
  }

  // Verify token validity (e.g., check expiry if you implemented it)
  // For simplicity, we assume the token is valid if found.

  // Update user verification status
  const updateUserResult = await pool.query(
    'UPDATE users SET verified = true WHERE id = $1 RETURNING id',
    [tokenEntry.userId]
  );

  if (updateUserResult.rows.length === 0) {
    return res.status(404).send('<h1>User not found</h1>');
  }

  // Remove the used token
  verificationTokens = verificationTokens.filter(t => t.token !== token);

  res.send(`
    <html>
      <head><title>Email Verified</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #FF6B35;">Email Verified Successfully!</h1>
        <p>Your ChatMe account has been verified. You can now use all features.</p>
        <p>You can close this window and return to the app.</p>
      </body>
    </html>
  `);
});

// Profile routes
app.get('/api/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET USER PROFILE REQUEST ===');
    console.log('User ID:', userId);

    const result = await pool.query(
      'SELECT id, username, email, bio, phone, avatar, country, verified, exp, level FROM users WHERE id = $1',
      [userId]
    );

    if (!result.rows || result.rows.length === 0) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    console.log('Found user:', user.username);
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      bio: user.bio,
      phone: user.phone,
      avatar: user.avatar,
      country: user.country,
      verified: user.verified,
      exp: user.exp || 0,
      level: user.level || 1
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/profile/:id', async (req, res) => {
  try {
    const { username, bio, phone, avatar } = req.body;

    // Get current user data first
    const currentUser = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (currentUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = currentUser.rows[0];

    // Use current values if new ones aren't provided
    const updateUsername = username !== undefined ? username : user.username;
    const updateBio = bio !== undefined ? bio : user.bio;
    const updatePhone = phone !== undefined ? phone : user.phone;
    const updateAvatar = avatar !== undefined ? avatar : user.avatar;

    const result = await pool.query(
      `UPDATE users SET username = $1, bio = $2, phone = $3, avatar = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING id, username, email, bio, phone, avatar`,
      [updateUsername, updateBio, updatePhone, updateAvatar, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API health check - ensure this comes before catch-all
app.get('/api/health', (req, res) => {
  res.json({
    message: 'ChatMe API Server is running!',
    endpoints: [
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/test',
      'GET /api/rooms',
      'GET /api/messages/:roomId',
      'GET /api/feed/posts',
      'POST /api/feed/posts',
      'GET /api/friends',
      'GET /api/support/tickets',
      'GET /api/lowcard/status/:roomId',
      'POST /api/lowcard/command',
      'POST /api/lowcard/init/:roomId',
      'POST /api/lowcard/shutdown/:roomId',
      'GET /api/lowcard/games',
    ],
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to check available routes
app.get('/debug/routes', (req, res) => {
  const routes = [];

  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Simple route
      const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
      routes.push(`${methods} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      // Router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods).join(', ').toUpperCase();
          routes.push(`${methods} ${handler.route.path}`);
        }
      });
    }
  });

  res.json({
    message: 'Available routes',
    routes: routes.sort(),
    timestamp: new Date().toISOString()
  });
});



// Test endpoint
app.get('/api/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
    server: 'ChatMe API Server'
  });
});

// Create room endpoint
app.post('/api/rooms', (req, res) => {
  console.log('POST /api/rooms -', new Date().toISOString());
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);

  const { name, description, type, maxMembers, createdBy } = req.body;
  const creatorUsername = createdBy || 'admin';

  // Validate required fields
  if (!name || !description) {
    return res.status(400).json({
      error: 'Room name and description are required'
    });
  }

  // Validate capacity
  const validCapacities = [25, 40, 80];
  if (!validCapacities.includes(maxMembers)) {
    return res.status(400).json({
      error: 'Invalid capacity. Must be 25, 40, or 80'
    });
  }

  try {
    // Save room to database
    const result = pool.query(`
      INSERT INTO rooms (name, description, managed_by, type, members, max_members, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [name.trim(), description.trim(), creatorUsername, type || 'room', 1, maxMembers, creatorUsername]);

    const dbRoom = result.rows[0];

    const newRoom = {
      id: dbRoom.id.toString(),
      name: dbRoom.name,
      description: dbRoom.description,
      managedBy: dbRoom.managed_by,
      type: dbRoom.type,
      members: dbRoom.members,
      maxMembers: dbRoom.max_members,
      createdBy: dbRoom.created_by,
      createdAt: dbRoom.created_at
    };

    // Add to in-memory rooms array
    rooms.push(newRoom);
    console.log('Room created and saved to database:', newRoom);
    res.json(newRoom);
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

app.post('/api/rooms/:roomId/join', (req, res) => {
  try {
    const { roomId } = req.params;
    const { password } = req.body;

    console.log(`Join room request for ID: ${roomId}`);
    console.log('Available rooms:', rooms.map(r => ({ id: r.id, name: r.name })));

    const room = rooms.find(r => r.id === roomId);
    if (!room) {
      console.log(`Room ${roomId} not found. Available rooms:`, rooms.map(r => r.id));
      return res.status(404).json({ error: `Room with ID ${roomId} not found` });
    }

    // Check if room is locked and requires password
    if (room.type === 'locked' && global.roomLocks && global.roomLocks[roomId]) {
      if (!password || password !== global.roomLocks[roomId]) {
        return res.status(403).json({
          error: 'Room is password protected',
          requiresPassword: true,
          message: 'This room is locked. Please enter the correct password to join.'
        });
      }
    }

    // Check if room is at capacity
    if (room.members >= room.maxMembers) {
      return res.status(400).json({ error: 'Room is at maximum capacity' });
    }

    console.log(`User attempting to join room: ${room.name} (ID: ${room.id})`);

    res.json({
      message: 'Successfully joined room',
      room: room
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get messages for a specific room
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    console.log(`Fetching messages for room: ${roomId} - returning empty array (messages not stored)`);

    // Return empty array since we don't store messages anymore
    res.json([]);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;

    const roomIndex = rooms.findIndex(r => r.id === roomId);
    if (roomIndex === -1) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const deletedRoom = rooms.splice(roomIndex, 1)[0];
    console.log('Room deleted:', deletedRoom.name);

    // Clean up participants for the deleted room
    delete roomParticipants[roomId];

    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add participant to room
app.post('/api/rooms/:roomId/participants', (req, res) => {
  try {
    const { roomId } = req.params;
    const { username, role = 'user' } = req.body;

    console.log('=== ADD PARTICIPANT TO ROOM REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Username:', username);
    console.log('Role:', role);

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Initialize participants array for room if not exists
    if (!roomParticipants[roomId]) {
      roomParticipants[roomId] = [];
    }

    // Check if user is already a participant
    let participant = roomParticipants[roomId].find(p => p.username === username);
    if (participant) {
      // Update existing participant
      participant.role = role;
      participant.isOnline = true;
      participant.lastSeen = new Date().toISOString();
      console.log('Updated existing participant:', username);
    } else {
      // Add new participant
      participant = {
        id: Date.now().toString(),
        username,
        role,
        isOnline: true,
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      roomParticipants[roomId].push(participant);
      console.log('Added new participant:', username);

      // Update room member count
      const roomIndex = rooms.findIndex(r => r.id === roomId);
      if (roomIndex !== -1) {
        rooms[roomIndex].members = roomParticipants[roomId].length;
      }
    }

    res.status(201).json(participant);
  } catch (error) {
    console.error('Error adding participant to room:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get room participants
app.get('/api/rooms/:roomId/participants', (req, res) => {
  try {
    const { roomId } = req.params;
    console.log('=== GET ROOM PARTICIPANTS REQUEST ===');
    console.log('Room ID:', roomId);

    // Return participants from the roomParticipants structure
    const participants = roomParticipants[roomId] || [];
    res.json(participants);
  } catch (error) {
    console.error('Error fetching room participants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Friends API endpoints
// Add friend endpoint
app.post('/api/friends/add', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { friendId } = req.body;

    console.log(`=== ADD FRIEND REQUEST ===`);
    console.log(`User ${userId} wants to add friend ${friendId}`);

    if (!friendId) {
      return res.status(400).json({ error: 'Friend ID is required' });
    }

    if (userId === friendId) {
      return res.status(400).json({ error: 'Cannot add yourself as friend' });
    }

    // Check if friendship already exists
    const existingFriendship = await pool.query(
      'SELECT * FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [userId, friendId]
    );

    if (existingFriendship.rows.length > 0) {
      return res.status(400).json({ error: 'Friendship already exists or pending' });
    }

    // Check if target user exists
    const targetUser = await pool.query('SELECT * FROM users WHERE id = $1', [friendId]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create friendship (assuming auto-accept for now, you can modify for friend requests)
    await pool.query(
      'INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES ($1, $2, $3, NOW())',
      [userId, friendId, 'accepted']
    );

    // Also create the reverse relationship
    await pool.query(
      'INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES ($1, $2, $3, NOW())',
      [friendId, userId, 'accepted']
    );

    console.log(`Friendship created between user ${userId} and ${friendId}`);
    res.json({ success: true, message: 'Friend added successfully' });

  } catch (error) {
    console.error('Error adding friend:', error);
    res.status(500).json({ error: 'Failed to add friend' });
  }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('User ID:', userId);

    // Fetch friends from friendships table
    const friendsQuery = await pool.query(`
      SELECT u.id, u.username as name, u.avatar, 
             CASE WHEN u.last_login > NOW() - INTERVAL '5 minutes' THEN 'online' ELSE 'offline' END as status,
             CASE WHEN u.last_login > NOW() - INTERVAL '5 minutes' THEN 'Active now' 
                  ELSE 'Last seen ' || COALESCE(EXTRACT(EPOCH FROM (NOW() - u.last_login))/60, 0) || ' minutes ago' END as lastSeen
      FROM users u
      JOIN friendships f ON (f.friend_id = u.id)
      WHERE f.user_id = $1 AND f.status = 'accepted'
      ORDER BY u.last_login DESC NULLS LAST
    `, [userId]);

    const friendsData = friendsQuery.rows.map(friend => ({
      id: friend.id.toString(),
      name: friend.name,
      avatar: friend.avatar || friend.name.charAt(0).toUpperCase(),
      status: friend.status,
      lastSeen: friend.lastseen
    }));

    console.log(`Returning ${friendsData.length} friends for user ${userId}`);
    res.json(friendsData);
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search friends
app.get('/api/friends/search', (req, res) => {
  try {
    const { query } = req.query;
    console.log('=== SEARCH FRIENDS REQUEST ===');
    console.log('Query:', query);

    // Mock search results
    const searchResults = [
      {
        id: '3',
        name: 'Search User',
        username: 'searchuser',
        status: 'offline',
        lastSeen: '1 day ago',
        avatar: 'S',
        level: 2
      }
    ];

    res.json(searchResults);
  } catch (error) {
    console.error('Error searching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users
app.get('/api/users/search', async (req, res) => {
  try {
    const { query } = req.query;
    console.log('=== SEARCH USERS REQUEST ===');
    console.log('Query:', query);

    if (!query) {
      return res.json([]);
    }

    // Search users in database
    const result = await pool.query(`
      SELECT id, username, email, avatar, verified, role, exp, level
      FROM users
      WHERE username ILIKE $1 OR email ILIKE $1
      LIMIT 10
    `, [`%${query}%`]);

    const searchResults = result.rows.map(user => ({
      id: user.id.toString(),
      name: user.username,
      username: user.username,
      status: 'online', // Mock status
      lastSeen: 'Active now', // Mock last seen
      avatar: user.avatar || user.username?.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified,
      role: user.role
    }));

    res.json(searchResults);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user status
app.put('/api/user/status', (req, res) => {
  try {
    const { status } = req.body;
    console.log('=== UPDATE STATUS REQUEST ===');
    console.log('New status:', status);

    res.json({ success: true, status });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get rooms endpoint
app.get('/api/rooms', (req, res) => {
  try {
    console.log('GET /api/rooms -', new Date().toISOString());
    console.log('Headers:', req.headers);
    res.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all posts
app.get('/api/feed/posts', async (req, res) => {
  try {
    console.log('Fetching feed posts...');

    const result = await pool.query(`
      SELECT
        p.*,
        u.role,
        u.verified,
        u.avatar,
        u.level,
        COALESCE(
          (SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', pc.id,
              'user', pc.username,
              'content', pc.content,
              'timestamp', pc.created_at
            )
          ) FROM post_comments pc WHERE pc.post_id = p.id),
          '[]'::json
        ) as comments
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);

    const postsWithComments = result.rows.map(row => ({
      id: row.id.toString(),
      user: row.username,
      username: row.username,
      content: row.content,
      timestamp: row.created_at,
      likes: row.likes,
      comments: row.comments || [],
      shares: row.shares,
      level: row.level || 1,
      avatar: row.avatar || row.username?.charAt(0).toUpperCase(),
      role: row.role,
      verified: row.verified,
      mediaFiles: row.media_files || []
    }));

    res.json(postsWithComments);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new post
app.post('/api/feed/posts', async (req, res) => {
  try {
    console.log('=== CREATE POST REQUEST ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);

    const { content, user, username, level = 1, avatar = 'U' } = req.body;

    // Find user by username
    const userResult = await pool.query('SELECT id, level FROM users WHERE username = $1', [username || user]);
    const userId = userResult.rows.length > 0 ? userResult.rows[0].id : 1; // Default to user ID 1 if not found
    const userLevel = userResult.rows.length > 0 ? userResult.rows[0].level : 1;

    if (!content && !user) {
      console.log('Missing content and user');
      return res.status(400).json({ error: 'Content or user is required' });
    }

    if (!user) {
      console.log('Missing user');
      return res.status(400).json({ error: 'User is required' });
    }

    const result = await pool.query(`
      INSERT INTO posts (user_id, username, content, likes, shares)
      VALUES ($1, $2, $3, 0, 0)
      RETURNING *
    `, [userId, username || user, content ? content.trim() : '']);

    const newPost = result.rows[0];

    // Get user role and other info
    const userInfoResult = await pool.query('SELECT role, verified, avatar FROM users WHERE id = $1', [userId]);
    const userInfo = userInfoResult.rows[0];

    const responsePost = {
      id: newPost.id.toString(),
      user: newPost.username,
      username: newPost.username,
      content: newPost.content,
      timestamp: newPost.created_at,
      likes: newPost.likes,
      comments: [],
      shares: newPost.shares,
      level: userLevel,
      avatar: userInfo.avatar || newPost.username?.charAt(0).toUpperCase(),
      role: userInfo.role,
      verified: userInfo.verified,
      mediaFiles: []
    };

    console.log('New post created successfully:', newPost.id);
    res.status(201).json(responsePost);
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Like/Unlike post
app.post('/api/feed/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { action } = req.body; // 'like' or 'unlike'

    const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = postResult.rows[0];
    let newLikes = post.likes;

    if (action === 'like') {
      newLikes += 1;
    } else if (action === 'unlike' && post.likes > 0) {
      newLikes -= 1;
    }

    await pool.query(
      'UPDATE posts SET likes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newLikes, postId]
    );

    console.log(`Post ${postId} ${action}d. New likes count: ${newLikes}`);

    res.json({
      postId,
      likes: newLikes,
      action
    });
  } catch (error) {
    console.error('Error updating post likes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add comment to post
app.post('/api/feed/posts/:postId/comment', async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, user } = req.body;

    if (!content || !user) {
      return res.status(400).json({ error: 'Content and user are required' });
    }

    // Check if post exists
    const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Find user by username to get user ID
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [user]);
    const userId = userResult.rows.length > 0 ? userResult.rows[0].id : 1; // Default to user ID 1 if not found

    // Add comment to database
    const commentResult = await pool.query(`
      INSERT INTO post_comments (post_id, user_id, username, content)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [postId, userId, user, content.trim()]);

    const newComment = commentResult.rows[0];

    // Get total comments count
    const countResult = await pool.query('SELECT COUNT(*) FROM post_comments WHERE post_id = $1', [postId]);
    const totalComments = parseInt(countResult.rows[0].count);

    console.log(`Comment added to post ${postId}:`, newComment.id);

    res.status(201).json({
      comment: {
        id: newComment.id.toString(),
        user: newComment.username,
        content: newComment.content,
        timestamp: newComment.created_at
      },
      totalComments
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Share post
app.post('/api/feed/posts/:postId/share', (req, res) => {
  try {
    const { postId } = req.params;

    const post = posts.find(p => p.id === postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    post.shares += 1;
    console.log(`Post ${postId} shared. New shares count: ${post.shares}`);

    res.json({
      postId,
      shares: post.shares,
      message: 'Post shared successfully'
    });
  } catch (error) {
    console.error('Error sharing post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get comments for a post
app.get('/api/feed/posts/:postId/comments', (req, res) => {
  try {
    const { postId } = req.params;

    const post = posts.find(p => p.id === postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(post.comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Follow/Unfollow user
app.post('/api/users/:userId/follow', async (req, res) => {
  try {
    const { userId } = req.params;
    const { action } = req.body; // 'follow' or 'unfollow'

    console.log('=== FOLLOW/UNFOLLOW REQUEST ===');
    console.log('Target User ID:', userId);
    console.log('Action:', action);

    // Check if target user exists in database
    const userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userResult.rows[0];

    // In a real app, you would:
    // 1. Get current user from JWT token
    // 2. Check if already following
    // 3. Update follow relationship in database
    // 4. Update follower/following counts

    // For now, return success response
    const result = {
      success: true,
      action: action,
      message: action === 'follow' ? 'User followed successfully' : 'User unfollowed successfully',
      targetUser: targetUser.username
    };

    console.log(`User ${targetUser.username} ${action}ed successfully`);
    res.json(result);
  } catch (error) {
    console.error('Error updating follow status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's followers
app.get('/api/users/:userId/followers', (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET USER FOLLOWERS REQUEST ===');
    console.log('User ID:', userId);

    // Mock followers data
    const followers = [
      {
        id: 'follower1',
        username: 'follower1',
        avatar: null,
        isFollowing: false
      },
      {
        id: 'follower2',
        username: 'follower2',
        avatar: null,
        isFollowing: true
      }
    ];

    res.json(followers);
  } catch (error) {
    console.error('Error fetching followers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's following
app.get('/api/users/:userId/following', (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET USER FOLLOWING REQUEST ===');
    console.log('User ID:', userId);

    // Mock following data
    const following = [
      {
        id: 'following1',
        username: 'following1',
        avatar: null,
        isFollowing: true
      },
      {
        id: 'following2',
        username: 'following2',
        avatar: null,
        isFollowing: true
      }
    ];

    res.json(following);
  } catch (error) {
    console.error('Error fetching following:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile for profile screen (different from /api/users/:userId/profile)
app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET USER PROFILE REQUEST ===');
    console.log('User ID/Username:', userId);

    // Check if userId is numeric (ID) or string (username)
    const isNumeric = /^\d+$/.test(userId);
    let result;

    if (isNumeric) {
      // Query by ID
      result = await pool.query(
        'SELECT id, username, email, bio, phone, avatar, gender, birth_date, country, signature, verified, role, exp, level FROM users WHERE id = $1',
        [userId]
      );
    } else {
      // Query by username
      result = await pool.query(
        'SELECT id, username, email, bio, phone, avatar, gender, birth_date, country, signature, verified, role, exp, level FROM users WHERE username = $1',
        [userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get real followers/following count
    const followersResult = await pool.query(
      'SELECT COUNT(*) FROM user_follows WHERE following_id = $1',
      [userId]
    );
    const followingResult = await pool.query(
      'SELECT COUNT(*) FROM user_follows WHERE follower_id = $1',
      [userId]
    );

    // Get achievements from database
    const achievementsResult = await pool.query(`
      SELECT achievement_type, count
      FROM user_achievements
      WHERE user_id = $1
    `, [userId]);

    const achievements = [
      {
        id: 'wealth',
        name: 'Kekayaan',
        icon: '⚡',
        color: '#FFA500',
        count: achievementsResult.rows.find(a => a.achievement_type === 'wealth')?.count || 0
      },
      {
        id: 'persona',
        name: 'pesona',
        icon: '💖',
        color: '#FF69B4',
        count: achievementsResult.rows.find(a => a.achievement_type === 'persona')?.count || 0
      },
      {
        id: 'gaming',
        name: 'Permainan',
        icon: '🎮',
        color: '#00BFFF',
        count: achievementsResult.rows.find(a => a.achievement_type === 'gaming')?.count || 0
      },
      {
        id: 'kasmaran',
        name: 'KASMARAN',
        icon: '💝',
        color: '#32CD32',
        count: achievementsResult.rows.find(a => a.achievement_type === 'kasmaran')?.count || 0
      }
    ];

    const profile = {
      id: user.id.toString(),
      username: user.username,
      bio: user.bio || user.signature || 'tanda tangan: cukup tau aj',
      followers: parseInt(followersResult.rows[0].count),
      following: parseInt(followingResult.rows[0].count),
      avatar: user.avatar,
      level: user.level || 1,
      achievements: achievements,
      isOnline: Math.random() > 0.5, // TODO: implement real online status
      country: user.country || 'ID',
      isFollowing: false // TODO: check if current user follows this user
    };

    console.log('Profile data sent:', profile.username);
    res.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload avatar
app.post('/api/users/:userId/avatar', async (req, res) => {
  try {
    const { userId } = req.params;
    const { avatar, filename } = req.body;

    console.log('Avatar upload request for user:', userId);
    console.log('Filename:', filename);
    console.log('Avatar data length:', avatar ? avatar.length : 0);

    if (!avatar || !filename) {
      return res.status(400).json({ error: 'Avatar data and filename are required' });
    }

    // Validate base64 data
    let cleanBase64 = avatar;
    if (avatar.startsWith('data:')) {
      const base64Match = avatar.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) {
        cleanBase64 = base64Match[1];
      } else {
        return res.status(400).json({ error: 'Invalid base64 data format' });
      }
    }

    // Test if base64 is valid
    try {
      const testBuffer = Buffer.from(cleanBase64, 'base64');
      if (testBuffer.length === 0) {
        return res.status(400).json({ error: 'Empty image data' });
      }
      console.log('Base64 validation successful, buffer size:', testBuffer.length);
    } catch (base64Error) {
      console.error('Base64 validation failed:', base64Error);
      return res.status(400).json({ error: 'Invalid base64 data' });
    }

    // Check if user exists in database
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate unique avatar ID
    const avatarId = `avatar_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const avatarUrl = `/api/users/avatar/${avatarId}`;

    // Store avatar data in memory
    if (!global.avatars) {
      global.avatars = {};
    }

    global.avatars[avatarId] = {
      id: avatarId,
      filename,
      data: cleanBase64, // Clean base64 data without data URL prefix
      uploadedBy: userId,
      uploadedAt: new Date().toISOString()
    };

    console.log(`Avatar stored in memory with ID: ${avatarId}`);

    // Update user avatar in database
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatarUrl, userId]);

    console.log(`Avatar uploaded successfully for user ${userId}:`, filename);

    res.json({
      avatarUrl,
      message: 'Avatar uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Serve avatar files
app.get('/api/users/avatar/:avatarId', (req, res) => {
  try {
    const { avatarId } = req.params;
    console.log(`Serving avatar: ${avatarId}`);

    if (!global.avatars || !global.avatars[avatarId]) {
      console.log(`Avatar not found in memory: ${avatarId}`);
      return res.status(404).json({ error: 'Avatar not found' });
    }

    const avatar = global.avatars[avatarId];
    console.log(`Avatar found: ${avatar.filename}, data length: ${avatar.data.length}`);

    try {
      const buffer = Buffer.from(avatar.data, 'base64');
      console.log(`Buffer created, size: ${buffer.length} bytes`);

      let contentType = 'image/jpeg';
      if (avatar.filename.toLowerCase().includes('png')) {
        contentType = 'image/png';
      } else if (avatar.filename.toLowerCase().includes('gif')) {
        contentType = 'image/gif';
      } else if (avatar.filename.toLowerCase().includes('webp')) {
        contentType = 'image/webp';
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.setHeader('Content-Disposition', `inline; filename="${avatar.filename}"`);

      console.log(`Sending avatar with content-type: ${contentType}`);
      res.send(buffer);
    } catch (bufferError) {
      console.error('Error creating buffer from base64:', bufferError);
      return res.status(500).json({ error: 'Invalid image data' });
    }
  } catch (error) {
    console.error('Error serving avatar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user album
app.get('/api/users/:userId/album', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET USER ALBUM REQUEST ===');
    console.log('User ID/Username:', userId);

    // Check if userId is numeric (ID) or string (username)
    const isNumeric = /^\d+$/.test(userId);
    let actualUserId = userId;

    if (!isNumeric) {
      // Convert username to user ID
      const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      actualUserId = userResult.rows[0].id;
    }

    // Fetch from database
    const result = await pool.query(`
      SELECT * FROM user_album WHERE user_id = $1 ORDER BY uploaded_at DESC
    `, [actualUserId]);

    const album = result.rows.map(row => ({
      id: row.id,
      url: `/api/users/album/${row.id}`,
      filename: row.filename,
      uploadedAt: row.uploaded_at
    }));

    res.json(album);
  } catch (error) {
    console.error('Error fetching album:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user gifts
app.get('/api/users/:userId/gifts', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET USER GIFTS REQUEST ===');
    console.log('User ID/Username:', userId);

    // Check if userId is numeric (ID) or string (username)
    const isNumeric = /^\d+$/.test(userId);
    let actualUserId = userId;

    if (!isNumeric) {
      // Convert username to user ID
      const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      actualUserId = userResult.rows[0].id;
    }

    // Fetch from database
    const result = await pool.query(`
      SELECT gift_type, count(*) as count
      FROM user_gifts
      WHERE user_id = $1
      GROUP BY gift_type
    `, [actualUserId]);

    const gifts = result.rows.map(row => {
      const giftConfig = {
        'rose': { name: 'Rose', icon: '🌹', color: '#FF69B4' },
        'diamond': { name: 'Diamond', icon: '💎', color: '#87CEEB' },
        'crown': { name: 'Crown', icon: '👑', color: '#FFD700' },
        'heart': { name: 'Heart', icon: '❤️', color: '#FF6B6B' }
      };

      const config = giftConfig[row.gift_type] || { name: row.gift_type, icon: '🎁', color: '#999' };

      return {
        id: row.gift_type,
        name: config.name,
        icon: config.icon,
        color: config.color,
        count: parseInt(row.count)
      };
    });

    res.json(gifts);
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload album photo
app.post('/api/users/:userId/album', async (req, res) => {
  try {
    const { userId } = req.params;
    const { photo, filename } = req.body;

    console.log('Album photo upload request for user:', userId);

    if (!photo || !filename) {
      return res.status(400).json({ error: 'Photo data and filename are required' });
    }

    // Check if user exists in database
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Store album photo
    const photoId = `album_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const photoUrl = `/api/users/album/${photoId}`;

    if (!global.albumPhotos) {
      global.albumPhotos = {};
    }
    global.albumPhotos[photoId] = {
      id: photoId,
      filename,
      data: photo, // base64 data
      uploadedBy: userId,
      uploadedAt: new Date().toISOString()
    };

    console.log(`Album photo uploaded successfully for user ${userId}:`, filename);

    res.json({
      id: photoId,
      url: photoUrl,
      filename,
      uploadedAt: new Date().toISOString(),
      message: 'Photo uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading album photo:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Serve album photos
app.get('/api/users/album/:photoId', (req, res) => {
  try {
    const { photoId } = req.params;

    if (!global.albumPhotos || !global.albumPhotos[photoId]) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photo = global.albumPhotos[photoId];
    const buffer = Buffer.from(photo.data, 'base64');

    let contentType = 'image/jpeg';
    if (photo.filename.toLowerCase().includes('png')) {
      contentType = 'image/png';
    } else if (photo.filename.toLowerCase().includes('gif')) {
      contentType = 'image/gif';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${photo.filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error serving album photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile with extended fields
app.put('/api/users/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      username,
      bio,
      phone,
      gender,
      birthDate,
      country,
      signature
    } = req.body;

    // Check if user exists
    const existingUser = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build update query dynamically
    const updateFields = [];
    const values = [];
    let paramCounter = 1;

    if (username !== undefined) {
      updateFields.push(`username = $${paramCounter++}`);
      values.push(username);
    }
    if (bio !== undefined) {
      updateFields.push(`bio = $${paramCounter++}`);
      values.push(bio);
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCounter++}`);
      values.push(phone);
    }
    if (gender !== undefined) {
      updateFields.push(`gender = $${paramCounter++}`);
      values.push(gender);
    }
    if (birthDate !== undefined) {
      updateFields.push(`birth_date = $${paramCounter++}`);
      values.push(birthDate);
    }
    if (country !== undefined) {
      updateFields.push(`country = $${paramCounter++}`);
      values.push(country);
    }
    if (signature !== undefined) {
      updateFields.push(`signature = $${paramCounter++}`);
      values.push(signature);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add updated_at timestamp
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const updateQuery = `
      UPDATE users
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING id, username, email, bio, phone, avatar, gender, birth_date, country, signature, verified
    `;

    const result = await pool.query(updateQuery, values);
    const updatedUser = result.rows[0];

    console.log(`Profile updated for user ${userId}`);
    res.json({
      id: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      bio: updatedUser.bio,
      phone: updatedUser.phone,
      avatar: updatedUser.avatar,
      gender: updatedUser.gender,
      birthDate: updatedUser.birth_date,
      country: updatedUser.country,
      signature: updatedUser.signature,
      verified: updatedUser.verified
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload photo/video for posts
app.post('/api/feed/upload', (req, res) => {
  try {
    console.log('=== UPLOAD REQUEST DEBUG ===');
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Type:', req.body?.type);
    console.log('Data length:', req.body?.data?.length || 0);
    console.log('Filename:', req.body?.filename);
    console.log('User:', req.body?.user);

    // Check if request body exists
    if (!req.body || typeof req.body !== 'object') {
      console.error('Request body is missing or invalid');
      return res.status(400).json({
        error: 'Invalid request body. Please ensure you are sending JSON data.',
        received: typeof req.body
      });
    }

// LowCard Bot API Endpoints
app.get('/api/lowcard/status/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;

    if (!lowCardBot) {
      return res.status(503).json({ error: 'LowCard bot is not available' });
    }

    const status = lowCardBot.getBotStatus(roomId);
    const isActive = lowCardBot.isBotActiveInRoom(roomId);

    res.json({
      roomId,
      status,
      isActive
    });
  } catch (error) {
    console.error('Error getting LowCard status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/lowcard/command', (req, res) => {
  try {
    const { roomId, message, userId, username } = req.body;

    if (!lowCardBot) {
      return res.status(503).json({ error: 'LowCard bot is not available' });
    }

    if (!roomId || !message || !userId || !username) {
      return res.status(400).json({ 
        error: 'Missing required fields: roomId, message, userId, username' 
      });
    }

    // Process the command
    lowCardBot.processLowCardCommand(io, roomId, message, userId, username);

    res.json({
      success: true,
      message: 'Command processed successfully'
    });
  } catch (error) {
    console.error('Error processing LowCard command:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/lowcard/init/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const { username } = req.body;

    if (!lowCardBot) {
      return res.status(503).json({ error: 'LowCard bot is not available' });
    }

    if (!roomId) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    // Initialize bot in the room
    lowCardBot.processLowCardCommand(io, roomId, '/init_bot', 'system', username || 'system');

    res.json({
      success: true,
      message: `LowCard bot initialized in room ${roomId}`
    });
  } catch (error) {
    console.error('Error initializing LowCard bot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/lowcard/shutdown/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;

    if (!lowCardBot) {
      return res.status(503).json({ error: 'LowCard bot is not available' });
    }

    if (!roomId) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    // Shutdown bot in the room
    lowCardBot.processLowCardCommand(io, roomId, '/bot off', 'system', 'system');

    res.json({
      success: true,
      message: `LowCard bot shutdown in room ${roomId}`
    });
  } catch (error) {
    console.error('Error shutting down LowCard bot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all active LowCard games
app.get('/api/lowcard/games', (req, res) => {
  try {
    if (!lowCardBot) {
      return res.status(503).json({ error: 'LowCard bot is not available' });
    }

    // Get all rooms and check which ones have active bots
    const activeGames = [];
    rooms.forEach(room => {
      const isActive = lowCardBot.isBotActiveInRoom(room.id);
      if (isActive) {
        const status = lowCardBot.getBotStatus(room.id);
        activeGames.push({
          roomId: room.id,
          roomName: room.name,
          status,
          isActive
        });
      }
    });

    res.json({
      totalGames: activeGames.length,
      games: activeGames
    });
  } catch (error) {
    console.error('Error getting active LowCard games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



    const { type, data, filename, user } = req.body;

    // Detailed validation with specific error messages
    const missingFields = [];
    if (!type) missingFields.push('type');
    if (!data) missingFields.push('data');
    if (!filename) missingFields.push('filename');
    if (!user) missingFields.push('user');

    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`,
        missingFields: missingFields,
        received: {
          type: type || 'missing',
          data: data ? `${data.length} characters` : 'missing',
          filename: filename || 'missing',
          user: user || 'missing'
        }
      });
    }

    // Validate file type
    const validTypes = ['photo', 'video'];
    if (!validTypes.includes(type)) {
      console.error('Invalid file type:', type);
      return res.status(400).json({
        error: `Invalid file type "${type}". Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Validate filename
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      console.error('Invalid filename:', filename);
      return res.status(400).json({ error: 'Filename must be a non-empty string' });
    }

    // Validate user
    if (typeof user !== 'string' || user.trim().length === 0) {
      console.error('Invalid user:', user);
      return res.status(400).json({ error: 'User must be a non-empty string' });
    }

    // Validate base64 data
    if (typeof data !== 'string' || data.length === 0) {
      console.error('Data is not a string or is empty');
      return res.status(400).json({ error: 'Data must be a non-empty string' });
    }

    // Check for placeholder data
    if (data === 'video_placeholder' || data === 'photo_placeholder') {
      console.error('Received placeholder data');
      return res.status(400).json({
        error: 'File processing failed. Please try selecting the file again.'
      });
    }

    let isValidBase64 = false;
    let actualData = data;

    if (data.startsWith('data:')) {
      // Extract base64 data from data URL
      const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) {
        actualData = base64Match[1];
        isValidBase64 = true;
      }
    } else if (data.match(/^[A-Za-z0-9+/]+={0,2}$/)) {
      isValidBase64 = true;
      actualData = data;
    }

    // Check minimum data length (should be more than a few bytes for real media)
    if (actualData.length < 100) {
      console.error('Data too short for', type, 'length:', actualData.length);
      return res.status(400).json({
        error: 'File data appears to be corrupted or incomplete. Please try uploading again.'
      });
    }

    if (!isValidBase64) {
      console.error('Invalid base64 data format');
      return res.status(400).json({
        error: 'Invalid file data format. Please ensure the file is properly encoded as base64.'
      });
    }

    // Use the validated base64 data
    let base64Data = actualData;

    // Generate unique filename with proper extension
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    let fileExtension = path.extname(filename);

    // If no extension, determine from type and content
    if (!fileExtension) {
      if (type === 'video') {
        fileExtension = '.mp4'; // Default to mp4 for videos
      } else {
        fileExtension = '.jpg'; // Default to jpg for photos
      }
    }

    const fileId = `file_${timestamp}_${randomSuffix}${fileExtension}`;
    const filePath = path.join(__dirname, 'uploads', 'media', fileId);

    // Ensure the uploads/media directory exists
    const uploadsDir = path.join(__dirname, 'uploads', 'media');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    try {
      // Write the base64 data to a file
      fs.writeFileSync(filePath, base64Data, 'base64');

      // Verify file was created and has content
      if (!fs.existsSync(filePath)) {
        throw new Error('File was not created successfully');
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        fs.unlinkSync(filePath); // Remove empty file
        throw new Error('File was created but is empty');
      }

      console.log(`File saved successfully: ${fileId}, Size: ${stats.size} bytes`);
    } catch (writeError) {
      console.error('Error writing file:', writeError);
      throw new Error(`Failed to save file: ${writeError.message}`);
    }

    const uploadedFile = {
      id: fileId,
      filename,
      type, // 'photo' or 'video'
      data: base64Data, // base64 data without data URL prefix
      uploadedBy: user,
      uploadedAt: new Date().toISOString(),
      url: `/api/feed/media/${fileId}`, // URL to access the file
      size: Buffer.byteLength(base64Data, 'base64') // Accurate file size in bytes
    };

    // Store in memory (in production, use proper file storage)
    if (!global.uploadedFiles) {
      global.uploadedFiles = {};
    }
    global.uploadedFiles[fileId] = uploadedFile;

    console.log(`${type} uploaded:`, filename, 'by', user, `Size: ${uploadedFile.size} bytes`);

    res.json({
      success: true,
      fileId: fileId.replace(fileExtension, ''), // Return ID without extension for compatibility
      url: `/api/feed/media/${fileId}`, // But use full filename in URL
      filename: filename,
      type: type
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve uploaded emoji files
app.get('/uploads/emojis/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads/emojis', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Emoji file not found' });
    }

    // Determine content type
    const ext = filename.toLowerCase().split('.').pop();
    let contentType = 'image/png';

    switch (ext) {
      case 'gif':
        contentType = 'image/gif';
        break;
      case 'jpg':
      case 'jpeg':
        contentType = 'image/jpeg';
        break;
      case 'webm':
        contentType = 'video/webm';
        break;
      case 'png':
      default:
        contentType = 'image/png';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving emoji file:', error);
    res.status(500).json({ error: 'Error serving emoji file' });
  }
});

// Serve avatar files without /api prefix (backward compatibility)
app.get('/users/avatar/:avatarId', (req, res) => {
  // Redirect to the API endpoint
  res.redirect(301, `/api/users/avatar/${req.params.avatarId}`);
});

// Serve uploaded gift files
app.get('/uploads/gifts/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads/gifts', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Gift file not found' });
    }

    // Determine content type
    const ext = filename.toLowerCase().split('.').pop();
    let contentType = 'image/png';

    switch (ext) {
      case 'gif':
        contentType = 'image/gif';
        break;
      case 'jpg':
      case 'jpeg':
        contentType = 'image/jpeg';
        break;
      case 'webm':
        contentType = 'video/webm';
        break;
      case 'png':
      default:
        contentType = 'image/png';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving gift file:', error);
    res.status(500).json({ error: 'Error serving gift file' });
  }
});

// Serve uploaded media files
app.get('/api/feed/media/:fileId', (req, res) => {
  try {
    const { fileId } = req.params;
    console.log(`GET /api/feed/media/${fileId} - ${new Date().toISOString()}`);

    // Ensure media directory exists
    const mediaDir = path.join(__dirname, 'uploads', 'media');
    if (!fs.existsSync(mediaDir)) {
      console.log('Media directory does not exist, creating:', mediaDir);
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    // List all files in media directory for debugging
    const files = fs.readdirSync(mediaDir);
    console.log('Available files in media directory:', files);
    console.log('Requested file ID:', fileId);

    // First try exact match
    let filePath = path.join(mediaDir, fileId);
    let foundFile = false;
    let matchingFile = null;

    if (fs.existsSync(filePath)) {
      foundFile = true;
      matchingFile = fileId;
      console.log('Found exact match:', fileId);
    } else {
      // Try exact filename match first
      matchingFile = files.find(file => file === fileId);

      // If not found, try to match by removing extension from fileId
      if (!matchingFile) {
        const fileIdWithoutExt = fileId.replace(/\.[^/.]+$/, "");
        matchingFile = files.find(file => file.startsWith(fileIdWithoutExt));
        console.log('Searching for files starting with:', fileIdWithoutExt);
      }

      // If still not found, try to match the full fileId as prefix
      if (!matchingFile) {
        matchingFile = files.find(file => file.startsWith(fileId.split('.')[0]));
        console.log('Searching for files starting with prefix:', fileId.split('.')[0]);
      }

      if (matchingFile) {
        filePath = path.join(mediaDir, matchingFile);
        foundFile = true;
        console.log(`Found matching file: ${matchingFile}`);
      } else {
        console.log('No matching file found for:', fileId);
      }
    }

    if (foundFile && fs.existsSync(filePath)) {
      // Verify file is not empty
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        console.log(`File is empty: ${filePath}`);
        return res.status(404).json({ 
          error: 'File corrupted',
          requestedFile: fileId,
          message: 'The requested file is corrupted or empty.'
        });
      }

      const ext = path.extname(filePath).toLowerCase();

      let contentType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.mp4') contentType = 'video/mp4';
      else if (ext === '.webm') contentType = 'video/webm';
      else if (ext === '.mov') contentType = 'video/quicktime';

      console.log(`Serving file: ${matchingFile}, Type: ${contentType}, Size: ${stats.size} bytes`);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      // Support range requests for video streaming
      const range = req.headers.range;
      if (range && contentType.startsWith('video/')) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

        // Validate range
        if (start >= stats.size || end >= stats.size || start > end) {
          return res.status(416).json({ error: 'Range not satisfiable' });
        }

        const chunksize = (end - start) + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
        res.setHeader('Content-Length', chunksize);

        const readStream = fs.createReadStream(filePath, { start, end });
        readStream.on('error', (streamError) => {
          console.error('Stream error:', streamError);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          }
        });
        readStream.pipe(res);
      } else {
        const readStream = fs.createReadStream(filePath);
        readStream.on('error', (streamError) => {
          console.error('Stream error:', streamError);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          }
        });
        readStream.pipe(res);
      }
    } else {
      console.log(`File not found: ${fileId}`);
      console.log('Searched in directory:', mediaDir);

      // Check if it's a known missing file and clean up database reference
      if (fileId.includes('file_1755819832061_3xjv6')) {
        console.log('Detected missing file from error, should clean up database reference');
      }

      res.status(404).json({ 
        error: 'File not found',
        requestedFile: fileId,
        message: 'The requested media file could not be found on the server. It may have been removed or the upload failed.',
        availableFiles: files.slice(0, 5) // Show first 5 files for debugging
      });
    }
  } catch (error) {
    console.error('Error serving media file:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Create post with media
app.post('/api/feed/posts/with-media', async (req, res) => {
  try {
    const { content, user, username, level = 1, avatar = 'U', mediaFiles = [] } = req.body;

    console.log('=== CREATE POST WITH MEDIA REQUEST ===');
    console.log('Content:', content);
    console.log('User:', user);
    console.log('Username:', username);
    console.log('Media Files:', JSON.stringify(mediaFiles, null, 2));

    // Find user by username
    const userResult = await pool.query('SELECT id, level FROM users WHERE username = $1', [username || user]);
    const userId = userResult.rows.length > 0 ? userResult.rows[0].id : 1;
    const userLevel = userResult.rows.length > 0 ? userResult.rows[0].level : 1;

    if (!user) {
      return res.status(400).json({ error: 'User is required' });
    }

    // Ensure mediaFiles is properly structured
    const processedMediaFiles = mediaFiles.map(file => ({
      id: file.id,
      type: file.type,
      url: file.url,
      filename: file.filename
    }));

    const result = await pool.query(`
      INSERT INTO posts (user_id, username, content, media_files, likes, shares)
      VALUES ($1, $2, $3, $4, 0, 0)
      RETURNING *
    `, [userId, username || user, content ? content.trim() : '', JSON.stringify(processedMediaFiles)]);

    const newPost = result.rows[0];

    // Get user role and other info
    const userInfoResult = await pool.query('SELECT role, verified, avatar FROM users WHERE id = $1', [userId]);
    const userInfo = userInfoResult.rows[0] || {};

    const responsePost = {
      id: newPost.id.toString(),
      user: newPost.username,
      username: newPost.username,
      content: newPost.content,
      timestamp: newPost.created_at,
      likes: newPost.likes,
      comments: [],
      shares: newPost.shares,
      level: userLevel,
      avatar: userInfo.avatar || newPost.username?.charAt(0).toUpperCase(),
      role: userInfo.role || 'user',
      verified: userInfo.verified || false,
      mediaFiles: processedMediaFiles
    };

    console.log('New post with media created successfully:', newPost.id);
    console.log('Response post media files:', responsePost.mediaFiles);
    res.status(201).json(responsePost);
  } catch (error) {
    console.error('Error creating post with media:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Extract userId from token if available
  const token = socket.handshake.headers['authorization']?.split(' ')[1];
  if (token) {
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (!err && decoded.userId) {
        socket.userId = decoded.userId;
        try {
          const userResult = await pool.query('SELECT username, role, exp, level FROM users WHERE id = $1', [decoded.userId]);
          if (userResult.rows.length > 0) {
            socket.username = userResult.rows[0].username;
            socket.userRole = userResult.rows[0].role;
            socket.userLevel = userResult.rows[0].level || 1;
          }
        } catch (dbError) {
          console.error('Error fetching user details for socket:', dbError);
        }
      }
    });
  }

  socket.on('join-room', async (data) => {
    const { roomId, username, role } = data;
    socket.join(roomId);
    console.log(`${username} joined room ${roomId}`);

    // Add participant to room
    try {
      // Initialize participants array for room if not exists
      if (!roomParticipants[roomId]) {
        roomParticipants[roomId] = [];
      }

      // Check if user is already a participant
      let participant = roomParticipants[roomId].find(p => p.username === username);
      if (participant) {
        // Update existing participant status
        participant.isOnline = true;
        participant.lastSeen = new Date().toISOString();
      } else {
        // Add new participant
        participant = {
          id: Date.now().toString(),
          username,
          role: role || 'user',
          isOnline: true,
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        };
        roomParticipants[roomId].push(participant);

        // Update room member count
        const roomIndex = rooms.findIndex(r => r.id === roomId);
        if (roomIndex !== -1) {
          rooms[roomIndex].members = roomParticipants[roomId].length;
        }
      }

      // Store socket info for participant
      socket.roomId = roomId;
      socket.username = username;

      // Don't save join message to database, just broadcast in memory
      const joinMessage = {
        id: Date.now().toString(),
        sender: username,
        content: `${username} joined the room`,
        timestamp: new Date(),
        roomId: roomId,
        type: 'join',
        userRole: role
      };

      socket.to(roomId).emit('user-joined', joinMessage);

      // Notify room about updated participant list
      io.to(roomId).emit('participants-updated', roomParticipants[roomId]);
    } catch (error) {
      console.error('Error adding participant on join:', error);
    }
  });

  socket.on('leave-room', async (data) => {
    const { roomId, username, role } = data;
    socket.leave(roomId);
    console.log(`${username} left room ${roomId}`);

    // Update participant status to offline
    try {
      if (roomParticipants[roomId]) {
        const participant = roomParticipants[roomId].find(p => p.username === username);
        if (participant) {
          participant.isOnline = false;
          participant.lastSeen = new Date().toISOString();
        }

        // Notify room about updated participant list
        io.to(roomId).emit('participants-updated', roomParticipants[roomId]);
      }
    } catch (error) {
      console.error('Error updating participant on leave:', error);
    }

    // Don't save leave message to database, just broadcast in memory
    const leaveMessage = {
      id: Date.now().toString(),
      sender: username,
      content: `${username} left the room`,
      timestamp: new Date(),
      roomId: roomId,
      type: 'leave',
      userRole: role
    };

    socket.to(roomId).emit('user-left', leaveMessage);
  });

  socket.on('sendMessage', async (messageData) => {
      try {
        // Handle both old format (multiple parameters) and new format (single object)
        let roomId, sender, content, role, level, type, gift, tempId;

        if (typeof messageData === 'object' && messageData.roomId) {
          // New format: single object
          ({ roomId, sender, content, role, level, type, gift, tempId } = messageData);
        } else {
          // Old format: multiple parameters
          roomId = messageData;
          sender = arguments[1];
          content = arguments[2];
          role = arguments[3] || 'user';
          level = arguments[4] || 1;
          type = arguments[5] || 'message';
          gift = arguments[6] || null;
        }

        console.log(`${type === 'gift' ? 'Gift' : 'Message'} from ${sender} in room ${roomId}: ${content}`);

        // Check if this is an add bot command
        if (content && typeof content === 'string' && content.toLowerCase().trim() === '/add bot lowcard') {
          console.log('Processing add bot lowcard command');
          if (lowCardBot) {
            // Initialize bot in the room
            lowCardBot.processLowCardCommand(io, roomId, '/init_bot', socket.userId || sender, sender);

            // Send confirmation message
            io.to(roomId).emit('new-message', {
              id: `${Date.now()}_system`,
              sender: 'System',
              content: '🎮 LowCard Bot has been added to this room! Type !help to see available commands.',
              timestamp: new Date(),
              roomId,
              role: 'system',
              level: 1,
              type: 'system'
            });
          } else {
            // Send error message if bot is not available
            io.to(roomId).emit('new-message', {
              id: `${Date.now()}_system`,
              sender: 'System',
              content: '❌ LowCard Bot is not available at the moment.',
              timestamp: new Date(),
              roomId,
              role: 'system',
              level: 1,
              type: 'system'
            });
          }
          return; // Don't broadcast as regular message
        }

        // Check if this is a LowCard command
        if (lowCardBot && content && typeof content === 'string' && content.startsWith('!')) {
          console.log('Processing LowCard command:', content);
          lowCardBot.processLowCardCommand(io, roomId, content, socket.userId || sender, sender);
          return; // Don't broadcast as regular message
        }

        // Create message with unique ID (use tempId if provided for optimistic updates)
        const messageId = tempId ? tempId.replace('temp_', '') + '_confirmed' : `${Date.now()}_${sender}_${Math.random().toString(36).substr(2, 9)}`;

        const newMessage = {
          id: messageId,
          sender,
          content,
          timestamp: new Date(),
          roomId,
          role: role || 'user',
          level: level || 1,
          type: type || 'message',
          gift: gift || null
        };

        // Broadcast to ALL users in the room IMMEDIATELY (prioritize speed)
        io.to(roomId).emit('new-message', newMessage);
        console.log(`Message broadcasted immediately to room ${roomId} from ${sender}`);

        // Save to database asynchronously (don't wait for it to complete)
        setImmediate(async () => {
          try {
            await saveChatMessage(roomId, sender, content, gift ? JSON.stringify(gift) : null, type, role, level, false);
          } catch (dbError) {
            console.error('Error saving message to database (async):', dbError);
          }
        });

        // If it's a gift, also broadcast the animation event
        if (type === 'gift' && gift) {
          io.to(roomId).emit('gift-animation', {
            gift,
            sender,
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error sending message:', error);
      }
    });

  socket.on('kick-user', async (data) => {
    const { roomId, kickedUser, kickedBy } = data;
    console.log(`${kickedBy} kicked ${kickedUser} from room ${roomId}`);

    // Remove user from room participants
    if (roomParticipants[roomId]) {
      roomParticipants[roomId] = roomParticipants[roomId].filter(p => p.username !== kickedUser);

      // Update room member count in database
      try {
        await pool.query(
          'UPDATE rooms SET members = $1 WHERE id = $2',
          [roomParticipants[roomId].length, roomId]
        );
      } catch (dbError) {
        console.error('Error updating room member count on kick:', dbError);
      }
    }

    // Broadcast kick event to all users in room
    io.to(roomId).emit('user-kicked', {
      roomId,
      kickedUser,
      kickedBy,
      roomName: rooms.find(r => r.id === roomId)?.name || 'Unknown Room'
    });

    // Don't save kick message to database, just broadcast in memory
    const kickMessage = {
      id: Date.now().toString(),
      sender: 'System',
      content: `${kickedUser} was kicked by ${kickedBy}`,
      timestamp: new Date(),
      roomId: roomId,
      type: 'kick'
    };

    io.to(roomId).emit('new-message', kickMessage);
  });

  socket.on('mute-user', (data) => {
    const { roomId, mutedUser, mutedBy, action } = data;
    console.log(`${mutedBy} ${action}d ${mutedUser} in room ${roomId}`);

    // Broadcast mute event to all users in room
    io.to(roomId).emit('user-muted', {
      roomId,
      mutedUser,
      mutedBy,
      action
    });

    // Don't save mute message to database, just broadcast in memory
    const muteMessage = {
      id: Date.now().toString(),
      sender: 'System',
      content: `${mutedUser} was ${action}d by ${mutedBy}`,
      timestamp: new Date(),
      roomId: roomId,
      type: 'mute'
    };

    io.to(roomId).emit('new-message', muteMessage);
  });

  socket.on('send-report', (reportData) => {
    console.log('Report received:', reportData);

    // Store report (in production, save to database)
    if (!global.reports) {
      global.reports = [];
    }
    global.reports.push({
      ...reportData,
      id: Date.now().toString(),
      timestamp: new Date()
    });

    // Send report to admin room (if exists)
    io.emit('admin-notification', {
      type: 'report',
      data: reportData
    });

    console.log('Report forwarded to admins');
  });

  // Initialize LowCard bot for connected sockets
  if (lowCardBot) {
    try {
      lowCardBot.handleLowCardBot(io, socket);
    } catch (error) {
      console.error('Error initializing LowCard bot for socket:', error);
    }
  }

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.username || socket.id}`);

    // Update participant status to offline if they were in a room
    if (socket.roomId && socket.username) {
      try {
        if (roomParticipants[socket.roomId]) {
          const participant = roomParticipants[socket.roomId].find(p => p.username === socket.username);
          if (participant) {
            participant.isOnline = false;
            participant.lastSeen = new Date().toISOString();
            io.to(socket.roomId).emit('participants-updated', roomParticipants[socket.roomId]);
          }
        }
      } catch (error) {
        console.error('Error updating participant status on disconnect:', error);
      }
    }

    // Remove user from all rooms they were in (handled by socket.leave in disconnect event)
    Object.keys(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.to(room).emit('userLeft', socket.username || 'Unknown');
      }
    });
  });
});


// Route for creating private chats
// Create private chat
app.post('/api/chat/private', authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user.userId;

    console.log(`Creating private chat between ${currentUserId} and ${targetUserId}`);

    if (!targetUserId) {
      return res.status(400).json({ error: 'Target user ID is required' });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: 'Cannot create chat with yourself' });
    }

    // Check if target user exists
    const targetUser = await pool.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    // For simplicity, we'll create a room-based private chat using existing room system
    // Check if private room already exists between these users
    const existingRoom = await pool.query(
      `SELECT r.* FROM rooms r 
       WHERE r.name = $1 OR r.name = $2`,
      [`private_${currentUserId}_${targetUserId}`, `private_${targetUserId}_${currentUserId}`]
    );

    if (existingRoom.rows.length > 0) {
      // Room already exists, return existing room
      return res.json({ 
        chatId: existingRoom.rows[0].id,
        message: 'Private chat already exists' 
      });
    }

    // Create new private room
    const roomResult = await pool.query(
      'INSERT INTO rooms (name, description, type, max_members, created_by, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id',
      [
        `private_${currentUserId}_${targetUserId}`,
        `Private chat between users`,
        'private',
        2,
        currentUserId
      ]
    );

    const roomId = roomResult.rows[0].id;

    console.log(`Private chat room created with ID: ${roomId}`);
    res.json({ 
      chatId: roomId,
      message: 'Private chat created successfully' 
    });

  } catch (error) {
    console.error('Error creating private chat:', error);
    res.status(500).json({ error: 'Failed to create private chat' });
  }
});

// Route for getting private chat messages
app.get('/api/chat/private/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    console.log(`GET /api/chat/private/${chatId}/messages - Getting private chat messages`);

    // Fetch messages from database using chatId
    const result = await pool.query(`
      SELECT
        cm.*,
        u.avatar,
        u.verified
      FROM chat_messages cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.room_id = $1 AND cm.is_private = TRUE
      ORDER BY cm.created_at ASC
    `, [chatId]);

    const messages = result.rows.map(row => ({
      id: row.id.toString(),
      sender: row.username,
      content: row.content,
      timestamp: row.created_at,
      chatId: row.room_id,
      role: row.user_role,
      level: row.user_level,
      type: row.message_type,
      userRole: row.user_role,
      media: row.media_data ? JSON.parse(row.media_data) : null,
      avatar: row.avatar,
      verified: row.verified
    }));

    res.json(messages);
  } catch (error) {
    console.error('Error fetching private chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }
});

// Get message history with pagination
app.get('/api/rooms/:roomId/messages/history', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, before, after } = req.query;

    let query = `
      SELECT
        cm.*,
        u.avatar,
        u.verified
      FROM chat_messages cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.room_id = $1
    `;

    let params = [roomId];
    let paramCount = 1;

    if (before) {
      paramCount++;
      query += ` AND cm.created_at < $${paramCount}`;
      params.push(before);
    }

    if (after) {
      paramCount++;
      query += ` AND cm.created_at > $${paramCount}`;
      params.push(after);
    }

    query += ` ORDER BY cm.created_at DESC LIMIT $${paramCount + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    const messages = result.rows.map(row => ({
      id: row.id.toString(),
      sender: row.username,
      content: row.content,
      timestamp: row.created_at,
      roomId: row.room_id,
      role: row.user_role,
      level: row.user_level,
      type: row.message_type,
      userRole: row.user_role,
      media: row.media_data ? JSON.parse(row.media_data) : null,
      avatar: row.avatar,
      verified: row.verified,
      isPrivate: row.is_private
    }));

    res.json({
      messages: messages.reverse(),
      hasMore: messages.length === parseInt(limit),
      oldest: messages.length > 0 ? messages[0].timestamp : null,
      newest: messages.length > 0 ? messages[messages.length - 1].timestamp : null
    });
  } catch (error) {
    console.error('Error fetching message history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete message (admin only)
app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete messages' });
    }

    const result = await pool.query(
      'DELETE FROM chat_messages WHERE id = $1 RETURNING *',
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const deletedMessage = result.rows[0];

    // Broadcast message deletion to room
    io.to(deletedMessage.room_id).emit('message-deleted', {
      messageId: deletedMessage.id.toString(),
      roomId: deletedMessage.room_id
    });

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Debug endpoint to list media files
app.get('/api/debug/media-files', (req, res) => {
  try {
    const mediaDir = path.join(__dirname, 'uploads', 'media');

    if (!fs.existsSync(mediaDir)) {
      return res.json({ 
        error: 'Media directory does not exist',
        mediaDir: mediaDir 
      });
    }

    const files = fs.readdirSync(mediaDir);
    const fileDetails = files.map(filename => {
      const filePath = path.join(mediaDir, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        path: filePath
      };
    });

    res.json({
      mediaDir: mediaDir,
      totalFiles: files.length,
      files: fileDetails
    });
  } catch (error) {
    console.error('Error listing media files:', error);
    res.status(500).json({ error: 'Failed to list media files' });
  }
});

// Clean up posts with missing media files (admin only)
app.post('/api/admin/cleanup-missing-media', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log('Starting cleanup of posts with missing media files...');

    // Get all posts with media files
    const postsWithMedia = await pool.query(`
      SELECT id, media_files FROM posts 
      WHERE media_files IS NOT NULL AND media_files != '[]'::jsonb
    `);

    const mediaDir = path.join(__dirname, 'uploads', 'media');
    let cleanedPosts = 0;
    const missingFiles = [];

    for (const post of postsWithMedia.rows) {
      const mediaFiles = post.media_files;
      let hasValidMedia = false;

      for (const media of mediaFiles) {
        if (media.url) {
          // Extract filename from URL
          const filename = media.url.split('/').pop();
          const filePath = path.join(mediaDir, filename);

          if (fs.existsSync(filePath)) {
            hasValidMedia = true;
          } else {
            missingFiles.push({ postId: post.id, filename, url: media.url });
          }
        }
      }

      // If no valid media files exist, remove media_files from post
      if (!hasValidMedia && mediaFiles.length > 0) {
        await pool.query(
          'UPDATE posts SET media_files = $1 WHERE id = $2',
          [JSON.stringify([]), post.id]
        );
        cleanedPosts++;
        console.log(`Cleaned post ${post.id} with missing media files`);
      }
    }

    res.json({
      message: 'Cleanup completed',
      cleanedPosts: cleanedPosts,
      missingFiles: missingFiles.length,
      details: missingFiles.slice(0, 10) // Show first 10 missing files
    });

  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});





// Add API endpoint for friends (to avoid 404)
app.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    console.log('=== GET FRIENDS REQUEST (API) ===');
    console.log('Headers:', req.headers);
    console.log('User ID:', req.user.id);

    // Get friends from database
    const result = await pool.query(`
      SELECT u.id, u.username, u.avatar, u.verified, u.role, u.exp, u.level
      FROM users u
      JOIN user_follows uf ON u.id = uf.following_id
      WHERE uf.follower_id = $1
      ORDER BY u.username
    `, [req.user.id]);

    const friends = result.rows.map(user => ({
      id: user.id.toString(),
      name: user.username,
      username: user.username,
      status: 'online', // TODO: implement real status
      lastSeen: 'Active now', // TODO: implement real last seen
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified,
      role: user.role
    }));

    res.json(friends);
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add API endpoint for feed posts (to avoid 404)
app.get('/api/feed/posts', async (req, res) => {
  try {
    console.log('Fetching feed posts...');

    const result = await pool.query(`
      SELECT
        p.*,
        u.role,
        u.verified,
        u.avatar,
        u.level,
        COALESCE(
          (SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', pc.id,
              'user', pc.username,
              'content', pc.content,
              'timestamp', pc.created_at
            )
          ) FROM post_comments pc WHERE pc.post_id = p.id),
          '[]'::json
        ) as comments
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);

    const postsWithComments = result.rows.map(row => ({
      id: row.id.toString(),
      user: row.username,
      username: row.username,
      content: row.content,
      timestamp: row.created_at,
      likes: row.likes,
      comments: row.comments || [],
      shares: row.shares,
      level: row.level || 1,
      avatar: row.avatar || row.username?.charAt(0).toUpperCase(),
      role: row.role,
      verified: row.verified,
      mediaFiles: row.media_files || []
    }));

    res.json(postsWithComments);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Rankings endpoints
app.get('/api/rankings/games', async (req, res) => {
  try {
    console.log('Fetching games rankings...');

    // Get top players by gaming achievements
    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        u.level,
        u.verified,
        COALESCE(ua.count, 0) as game_score
      FROM users u
      LEFT JOIN user_achievements ua ON u.id = ua.user_id AND ua.achievement_type = 'gaming'
      ORDER BY game_score DESC, u.level DESC
      LIMIT 50
    `);

    const rankings = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id.toString(),
      username: user.username,
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified || false,
      score: user.game_score
    }));

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching games rankings:', error);
    res.status(500).json({ error: 'Failed to fetch games rankings' });
  }
});

app.get('/api/rankings/wealth', async (req, res) => {
  try {
    console.log('Fetching wealth rankings...');

    // Get top players by wealth (credits + achievements)
    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        u.level,
        u.verified,
        COALESCE(uc.balance, 0) as credits,
        COALESCE(ua.count, 0) as wealth_achievements
      FROM users u
      LEFT JOIN user_credits uc ON u.id = uc.user_id
      LEFT JOIN user_achievements ua ON u.id = ua.user_id AND ua.achievement_type = 'wealth'
      ORDER BY credits DESC, wealth_achievements DESC, u.level DESC
      LIMIT 50
    `);

    const rankings = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id.toString(),
      username: user.username,
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified || false,
      credits: user.credits,
      wealthScore: user.wealth_achievements
    }));

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching wealth rankings:', error);
    res.status(500).json({ error: 'Failed to fetch wealth rankings' });
  }
});

app.get('/api/rankings/gifts', async (req, res) => {
  try {
    console.log('Fetching gifts rankings...');

    // Get top players by gifts received
    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        u.level,
        u.verified,
        COUNT(ug.id) as total_gifts,
        COALESCE(ua.count, 0) as persona_score
      FROM users u
      LEFT JOIN user_gifts ug ON u.id = ug.user_id
      LEFT JOIN user_achievements ua ON u.id = ua.user_id AND ua.achievement_type = 'persona'
      GROUP BY u.id, u.username, u.avatar, u.level, u.verified, ua.count
      ORDER BY total_gifts DESC, persona_score DESC, u.level DESC
      LIMIT 50
    `);

    const rankings = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id.toString(),
      username: user.username,
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified || false,
      totalGifts: parseInt(user.total_gifts),
      personaScore: user.persona_score
    }));

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching gifts rankings:', error);
    res.status(500).json({ error: 'Failed to fetch gifts rankings' });
  }
});

// Rankings endpoints without /api prefix
app.get('/rankings/games', async (req, res) => {
  try {
    console.log('Fetching games rankings (no /api)...');

    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        u.level,
        u.verified,
        COALESCE(ua.count, 0) as game_score
      FROM users u
      LEFT JOIN user_achievements ua ON u.id = ua.user_id AND ua.achievement_type = 'gaming'
      ORDER BY game_score DESC, u.level DESC
      LIMIT 50
    `);

    const rankings = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id.toString(),
      username: user.username,
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified || false,
      score: user.game_score
    }));

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching games rankings:', error);
    res.status(500).json({ error: 'Failed to fetch games rankings' });
  }
});

app.get('/rankings/wealth', async (req, res) => {
  try {
    console.log('Fetching wealth rankings (no /api)...');

    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        u.level,
        u.verified,
        COALESCE(uc.balance, 0) as credits,
        COALESCE(ua.count, 0) as wealth_achievements
      FROM users u
      LEFT JOIN user_credits uc ON u.id = uc.user_id
      LEFT JOIN user_achievements ua ON u.id = ua.user_id AND ua.achievement_type = 'wealth'
      ORDER BY credits DESC, wealth_achievements DESC, u.level DESC
      LIMIT 50
    `);

    const rankings = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id.toString(),
      username: user.username,
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified || false,
      credits: user.credits,
      wealthScore: user.wealth_achievements
    }));

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching wealth rankings:', error);
    res.status(500).json({ error: 'Failed to fetch wealth rankings' });
  }
});

app.get('/rankings/gifts', async (req, res) => {
  try {
    console.log('Fetching gifts rankings (no /api)...');

    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        u.level,
        u.verified,
        COUNT(ug.id) as total_gifts,
        COALESCE(ua.count, 0) as persona_score
      FROM users u
      LEFT JOIN user_gifts ug ON u.id = ug.user_id
      LEFT JOIN user_achievements ua ON u.id = ua.user_id AND ua.achievement_type = 'persona'
      GROUP BY u.id, u.username, u.avatar, u.level, u.verified, ua.count
      ORDER BY total_gifts DESC, persona_score DESC, u.level DESC
      LIMIT 50
    `);

    const rankings = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id.toString(),
      username: user.username,
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified || false,
      totalGifts: parseInt(user.total_gifts),
      personaScore: user.persona_score
    }));

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching gifts rankings:', error);
    res.status(500).json({ error: 'Failed to fetch gifts rankings' });
  }
});

// Add backward compatibility endpoints without /api prefix

// Friends endpoint without /api prefix
app.get('/friends', authenticateToken, async (req, res) => {
  try {
    console.log('=== GET FRIENDS REQUEST (no /api) ===');
    console.log('Headers:', req.headers);
    console.log('User ID:', req.user.id);

    // Get friends from database
    const result = await pool.query(`
      SELECT u.id, u.username, u.avatar, u.verified, u.role, u.exp, u.level
      FROM users u
      JOIN user_follows uf ON u.id = uf.following_id
      WHERE uf.follower_id = $1
      ORDER BY u.username
    `, [req.user.id]);

    const friends = result.rows.map(user => ({
      id: user.id.toString(),
      name: user.username,
      username: user.username,
      status: 'online',
      lastSeen: 'Active now',
      avatar: user.avatar || user.username.charAt(0).toUpperCase(),
      level: user.level || 1,
      verified: user.verified,
      role: user.role
    }));

    res.json(friends);
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rooms endpoint without /api prefix
app.get('/rooms', (req, res) => {
  try {
    console.log('GET /rooms (no /api) -', new Date().toISOString());
    res.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Feed posts endpoint without /api prefix
app.get('/feed/posts', async (req, res) => {
  try {
    console.log('Fetching feed posts (no /api)...');

    const result = await pool.query(`
      SELECT
        p.*,
        u.role,
        u.verified,
        u.avatar,
        u.level,
        COALESCE(
          (SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', pc.id,
              'user', pc.username,
              'content', pc.content,
              'timestamp', pc.created_at
            )
          ) FROM post_comments pc WHERE pc.post_id = p.id),
          '[]'::json
        ) as comments
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);

    const postsWithComments = result.rows.map(row => ({
      id: row.id.toString(),
      user: row.username,
      username: row.username,
      content: row.content,
      timestamp: row.created_at,
      likes: row.likes,
      comments: row.comments || [],
      shares: row.shares,
      level: row.level || 1,
      avatar: row.avatar || row.username?.charAt(0).toUpperCase(),
      role: row.role,
      verified: row.verified,
      mediaFiles: row.media_files || []
    }));

    res.json(postsWithComments);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mentor endpoints without /api prefix
app.get('/mentor/merchants', authenticateToken, async (req, res) => {
  try {
    console.log('=== GET MENTOR MERCHANTS REQUEST (no /api) ===');
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.role);

    // Check if user is mentor or admin
    if (req.user.role !== 'mentor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Mentor role required.' });
    }

    // Get all merchant promotions
    const result = await pool.query(`
      SELECT 
        mp.*,
        u.username,
        promoted_by_user.username as promoted_by_username
      FROM merchant_promotions mp
      JOIN users u ON mp.user_id = u.id
      JOIN users promoted_by_user ON mp.promoted_by = promoted_by_user.id
      ORDER BY mp.promoted_at DESC
    `);

    const merchants = result.rows.map(row => ({
      id: row.id.toString(),
      username: row.username,
      promoted_by: row.promoted_by_username,
      promoted_at: row.promoted_at,
      expires_at: row.expires_at,
      status: row.status
    }));

    res.json({ merchants });
  } catch (error) {
    console.error('Error fetching merchants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/mentor/add-merchant', authenticateToken, async (req, res) => {
  try {
    console.log('=== ADD MERCHANT REQUEST (no /api) ===');
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.role);
    console.log('Request body:', req.body);

    const { username } = req.body;
    const mentorId = req.user.id;

    // Check if user is mentor or admin
    if (req.user.role !== 'mentor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Mentor role required.' });
    }

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Find target user
    const userResult = await pool.query('SELECT id, username, role FROM users WHERE username = $1', [username.trim()]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userResult.rows[0];

    // Check if user is already a merchant
    if (targetUser.role === 'merchant') {
      return res.status(400).json({ error: 'User is already a merchant' });
    }

    // Check if user has an active merchant promotion
    const existingPromotion = await pool.query(`
      SELECT * FROM merchant_promotions 
      WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
    `, [targetUser.id]);

    if (existingPromotion.rows.length > 0) {
      return res.status(400).json({ error: 'User already has an active merchant promotion' });
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Calculate expiration date (1 month from now)
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      // Create merchant promotion record
      await pool.query(`
        INSERT INTO merchant_promotions (user_id, promoted_by, expires_at, status)
        VALUES ($1, $2, $3, 'active')
      `, [targetUser.id, mentorId, expiresAt]);

      // Update user role to merchant
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['merchant', targetUser.id]);

      await pool.query('COMMIT');

      console.log(`User ${username} promoted to merchant by ${req.user.username}`);

      res.json({
        message: `User ${username} has been successfully promoted to merchant`,
        username: targetUser.username,
        expiresAt: expiresAt.toISOString()
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error adding merchant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auth endpoints without /api prefix
app.post('/auth/login', async (req, res) => {
  try {
    console.log('Login request received (no /api):', { username: req.body.username });

    const { username, password } = req.body;

    if (!username || !password) {
      console.log('Missing login credentials');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      console.log('User not found:', username);
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('Invalid password for user:', username);
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

    // Check for daily login reward
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const lastLogin = user.last_login ? new Date(user.last_login).toISOString().split('T')[0] : null;

    let dailyReward = null;
    if (lastLogin !== today) {
      try {
        // Check if user already got today's reward
        const todayReward = await pool.query(
          'SELECT * FROM daily_login_rewards WHERE user_id = $1 AND login_date = $2',
          [user.id, today]
        );

        if (todayReward.rows.length === 0) {
          // Calculate consecutive days
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];

          const yesterdayReward = await pool.query(
            'SELECT consecutive_days FROM daily_login_rewards WHERE user_id = $1 AND login_date = $2',
            [user.id, yesterdayStr]
          );

          const consecutiveDays = yesterdayReward.rows.length > 0 ? yesterdayReward.rows[0].consecutive_days + 1 : 1;
          const baseReward = 50;
          const bonusReward = Math.min(consecutiveDays * 10, 200); // Max bonus 200
          const totalReward = baseReward + bonusReward;

          // Add daily login reward
          await pool.query(`
            INSERT INTO daily_login_rewards (user_id, login_date, exp_reward, consecutive_days)
            VALUES ($1, $2, $3, $4)
          `, [user.id, today, totalReward, consecutiveDays]);

          // Add EXP to user
          const expResult = await addUserEXP(user.id, totalReward, 'daily_login');

          dailyReward = {
            exp: totalReward,
            consecutiveDays: consecutiveDays,
            leveledUp: expResult?.leveledUp || false,
            newLevel: expResult?.newLevel || user.level || 1
          };
        }

        // Update last login timestamp
        await pool.query(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
          [user.id]
        );
      } catch (error) {
        console.error('Error processing daily login reward:', error);
      }
    }

    // Get updated user data with level and EXP
    const updatedUserResult = await pool.query(
      'SELECT id, username, email, bio, phone, avatar, verified, role, exp, level FROM users WHERE id = $1',
      [user.id]
    );
    const updatedUser = updatedUserResult.rows[0];

    console.log('Login successful for user:', username);

    res.json({
      token,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        bio: updatedUser.bio,
        phone: updatedUser.phone,
        avatar: updatedUser.avatar,
        verified: updatedUser.verified,
        role: updatedUser.role,
        exp: updatedUser.exp || 0,
        level: updatedUser.level || 1
      },
      dailyReward: dailyReward
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Admin user management endpoints
app.get('/api/admin/users/search', authenticateToken, async (req, res) => {
  try {
    console.log('=== ADMIN USER SEARCH REQUEST ===');
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.role);

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const { username } = req.query;

    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters' });
    }

    const result = await pool.query(`
      SELECT id, username, role, email, verified, created_at
      FROM users 
      WHERE username ILIKE $1 
      ORDER BY username ASC 
      LIMIT 20
    `, [`%${username.trim()}%`]);

    const users = result.rows.map(row => ({
      id: row.id.toString(),
      username: row.username,
      role: row.role,
      email: row.email,
      verified: row.verified
    }));

    res.json({ users });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/users/promote', authenticateToken, async (req, res) => {
  try {
    console.log('=== ADMIN USER PROMOTION REQUEST ===');
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.role);
    console.log('Request body:', req.body);

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const { userId, newRole } = req.body;

    if (!userId || !newRole) {
      return res.status(400).json({ error: 'userId and newRole are required' });
    }

    if (!['admin', 'mentor'].includes(newRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or mentor' });
    }

    // Get target user
    const userResult = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userResult.rows[0];

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Update user role
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, userId]);

      // If promoting to mentor, add expiration record
      if (newRole === 'mentor') {
        // Remove any existing mentor promotion record
        await pool.query('DELETE FROM mentor_promotions WHERE user_id = $1', [userId]);

        // Calculate expiration date (1 month from now)
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        // Create new mentor promotion record
        await pool.query(`
          INSERT INTO mentor_promotions (user_id, promoted_by, expires_at, status)
          VALUES ($1, $2, $3, 'active')
        `, [userId, req.user.id, expiresAt]);
      }

      await pool.query('COMMIT');

      console.log(`User ${targetUser.username} promoted to ${newRole} by ${req.user.username}`);

      res.json({
        message: `User ${targetUser.username} has been successfully promoted to ${newRole}${newRole === 'mentor' ? ' (expires in 1 month)' : ''}`,
        username: targetUser.username,
        newRole: newRole
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error promoting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cleanup expired tokens periodically
const cleanupExpiredTokens = async () => {
  try {
    const result = await pool.query('DELETE FROM tokens WHERE expires_at < NOW()');
    console.log(`Cleaned up ${result.rowCount} expired tokens`);
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
  }
};

// Cleanup expired mentor roles
const cleanupExpiredMentors = async () => {
  try {
    // Find expired mentor promotions
    const expiredResult = await pool.query(`
      SELECT mp.user_id, u.username 
      FROM mentor_promotions mp
      JOIN users u ON mp.user_id = u.id
      WHERE mp.expires_at < NOW() AND mp.status = 'active' AND u.role = 'mentor'
    `);

    if (expiredResult.rows.length > 0) {
      console.log(`Found ${expiredResult.rows.length} expired mentor roles to cleanup`);

      // Start transaction
      await pool.query('BEGIN');

      try {
        // Update expired mentor promotions status
        await pool.query(`
          UPDATE mentor_promotions 
          SET status = 'expired' 
          WHERE expires_at < NOW() AND status = 'active'
        `);

        // Demote users back to regular user role
        await pool.query(`
          UPDATE users 
          SET role = 'user' 
          WHERE id IN (
            SELECT mp.user_id 
            FROM mentor_promotions mp
            WHERE mp.expires_at < NOW() AND mp.status = 'expired'
          ) AND role = 'mentor'
        `);

        await pool.query('COMMIT');

        const expiredUsernames = expiredResult.rows.map(row => row.username).join(', ');
        console.log(`Demoted expired mentors: ${expiredUsernames}`);

      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  } catch (error) {
    console.error('Error cleaning up expired mentor roles:', error);
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);
// Run mentor cleanup every 6 hours
setInterval(cleanupExpiredMentors, 6 * 60 * 60 * 1000);

// Run initial cleanup on server start
cleanupExpiredMentors();


server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Server accessible at: http://0.0.0.0:${PORT}`);
  console.log(`📋 API Endpoints:`);
  console.log(`   POST /api/auth/register - User registration`);
  console.log(`   POST /api/auth/login - User login`);
  console.log(`   POST /api/auth/forgot-password - Request password reset`);
  console.log(`   GET  /api/verify-email - Verify email address`);
  console.log(`   GET  /api/rooms - Get chat rooms`);
  console.log(`   POST /api/chat/private - Create private chat`);
  console.log(`   GET  /api/chat/private/:chatId/messages - Get private chat messages`);
  console.log(`   GET  /api/messages/:roomId - Get messages for a room (legacy)`);
  console.log(`   GET  /api/feed/posts - Get feed posts`);
  console.log(`   POST /api/feed/posts - Create a new post`);
  console.log(`   POST /api/feed/posts/with-media - Create a post with media`);
  console.log(`   POST /api/feed/upload - Upload media for posts`);
  console.log(`   GET  /api/friends - Get friends list`);
  console.log(`   GET  /api/users/search?query=<username> - Search for users`);
  console.log(`   GET  /api/support/tickets - Get support tickets`);
  console.log(`   POST /api/users/:userId/follow - Follow/Unfollow a user`);
  console.log(`   GET  /api/users/:userId/profile - Get user profile details`);
  console.log(`   GET  /api/users/:userId/followers - Get user followers`);
  console.log(`   GET  /api/users/:userId/following - Get users being followed`);
  console.log(`   POST /api/users/:userId/avatar - Upload user avatar`);
  console.log(`   GET  /api/users/:userId/album - Get user photo album`);
  console.log(`   POST /api/users/:userId/album - Upload photo to user album`);
  console.log(`   GET  /api/users/:userId/gifts - Get user gifts received`);
  console.log(`   GET  /api/credits/balance - Get user credits balance`);
  console.log(`   GET  /api/credits/history - Get user credits transaction history`);
  console.log(`   POST /api/credits/transfer - Transfer credits to another user`);
  console.log(`   POST /api/mentor/add-merchant - Promote user to merchant`);
  console.log(`   GET  /api/mentor/merchants - Get list of merchant promotions`);
  console.log(`   DELETE /api/messages/:messageId - Delete a chat message (admin only)`);
  console.log(`   GET  /api/lowcard/status/:roomId - Get LowCard bot status for room`);
  console.log(`   POST /api/lowcard/command - Send command to LowCard bot`);
  console.log(`   POST /api/lowcard/init/:roomId - Initialize LowCard bot in room`);
  console.log(`   POST /api/lowcard/shutdown/:roomId - Shutdown LowCard bot in room`);
  console.log(`   GET  /api/lowcard/games - Get all active LowCard games`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    console.log(`🔧 Trying to find and kill existing processes...`);

    // Try to kill existing processes
    const { exec } = require('child_process');
    exec(`lsof -ti:${PORT} | xargs kill -9`, (killErr) => {
      if (killErr) {
        console.error('Could not kill existing processes:', killErr.message);
        console.log('Please manually stop other processes using port', PORT);
        process.exit(1);
      } else {
        console.log('✅ Killed existing processes, restarting...');
        setTimeout(() => {
          server.listen(PORT, '0.0.0.0');
        }, 1000);
      }
    });
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});