const session = require('express-session');
const MongoStore = require('connect-mongo');
require('dotenv').config();

// Cấu hình session
const sessionSecret = process.env.SESSION_SECRET || 'default-secret-key';

const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/philosophy',
    collectionName: 'sessions',
  }),
  cookie: {
    secure: false,
    maxAge: 30 * 60 * 1000, // 30 phút
  },
});

module.exports = sessionMiddleware;
