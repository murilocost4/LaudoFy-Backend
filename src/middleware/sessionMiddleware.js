// Add this after cookieParser but before csrfProtection
const session = require('express-session');
const MongoStore = require('connect-mongo');

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-strong-secret-here',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60 // 14 days
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
  }
}));