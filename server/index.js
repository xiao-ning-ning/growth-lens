const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// SESSION_SECRET 自动生成（仅 .env 缺失时）
if (!process.env.SESSION_SECRET) {
  const secret = crypto.randomBytes(32).toString('hex');
  const line = 'SESSION_SECRET=' + secret;
  const envLine = '\n' + line + '\n';
  if (fs.existsSync(envPath)) {
    const current = fs.readFileSync(envPath, 'utf-8');
    if (!current.includes('SESSION_SECRET')) {
      fs.appendFileSync(envPath, envLine);
      console.log('[info] SESSION_SECRET 已自动生成并写入 .env');
    }
  }
  process.env.SESSION_SECRET = secret;
}

// Session middleware (memory store, simple for local use)
app.use(require('express-session')({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Ensure admin account exists
const { router: authRouter } = require('./routes/auth');

// Boot: create admin if needed
setTimeout(() => {
  const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
  const usersDir = path.dirname(USERS_FILE);
  if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true });

  if (!fs.existsSync(USERS_FILE)) {
    const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PWD = process.env.ADMIN_PASSWORD || 'admin123456';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(ADMIN_PWD, salt, 64).toString('hex');
    const users = {
      [ADMIN_USER]: {
        salt,
        password: hash,
        role: 'admin',
        createdAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    console.log(`\n  [auth] 管理员账号已创建: ${ADMIN_USER} / ${ADMIN_PWD}`);
    console.log('  [auth] 请妥善保管密码并定期更换\n');
  }
}, 0);

// Auth routes (no authentication required)
app.use('/api/auth', authRouter);

// Authentication middleware for all other /api/* routes
app.use('/api', (req, res, next) => {
  if (req.session.user) {
    req.userId = req.session.user.username;
    next();
  } else {
    res.status(401).json({ error: '请先登录' });
  }
});

// API status check (needs auth now)
app.get('/api/status', (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const configured = apiKey && apiKey !== 'sk-your-key-here';
  res.json({
    configured,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  });
});

app.get('/api/open-env', (req, res) => {
  const { exec } = require('child_process');
  const envPath = path.join(__dirname, '..', '.env');
  exec(`notepad "${envPath}"`, (err) => {
    if (err) {
      res.status(500).json({ error: '无法打开配置文件' });
    } else {
      res.json({ success: true });
    }
  });
});

// Protected API routes
app.use('/api/map', require('./routes/map'));
app.use('/api/analyze', require('./routes/analyze'));

app.use('/api/evidence', require('./routes/evidence'));
app.use('/api/merge', require('./routes/merge'));
app.use('/api/dimensions', require('./routes/dimensions'));
app.use('/api/combinations', require('./routes/combinations'));
app.use('/api/blindspots', require('./routes/blindspots'));
app.use('/api/paths', require('./routes/paths'));
app.use('/api/growth-records', require('./routes/growth-records'));
app.use('/api/schema', require('./routes/schema'));

// 里程碑API
app.get('/api/milestones', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: '请先登录' });
  // 按用户分目录存储里程碑
  const userDir = path.join(__dirname, '..', 'data', 'milestones', req.userId);
  const userMilestonesFile = path.join(userDir, 'milestones.json');
  if (fs.existsSync(userMilestonesFile)) {
    const data = fs.readFileSync(userMilestonesFile, 'utf-8');
    res.json(JSON.parse(data));
  } else {
    res.json([]);
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  成长力场已启动: http://${HOST}:${PORT}`);
  console.log(`  局域网访问: http://<你的IP>:${PORT}\n`);
  // Auto-open browser when launched via bat
  if (process.argv.includes('--open')) {
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}`;
    exec(`start "" "${url}"`, (err) => {
      if (err) console.log(`  请手动打开浏览器访问: ${url}`);
    });
  }
});
