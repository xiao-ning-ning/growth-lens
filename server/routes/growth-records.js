const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function genId() {
  return crypto.randomUUID();
}

const DATA_DIR = path.join(__dirname, '../../data/growth-records');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getUserRecordsPath(userId) {
  return path.join(DATA_DIR, `${userId}.json`);
}

function readUserRecords(userId) {
  const filePath = getUserRecordsPath(userId);
  if (!fs.existsSync(filePath)) return { userId, records: [], lastUpdated: null };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { userId, records: [], lastUpdated: null };
  }
}

function writeUserRecords(data) {
  const filePath = getUserRecordsPath(data.userId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/growth-records - current user's records
router.get('/', (req, res) => {
  const userId = req.session.user?.id || req.session.user?.username;
  if (!userId) return res.status(401).json({ error: '未登录' });
  const data = readUserRecords(userId);
  res.json(data);
});

// POST /api/growth-records - add a new growth record snapshot
router.post('/', (req, res) => {
  const userId = req.session.user?.id || req.session.user?.username;
  if (!userId) return res.status(401).json({ error: '未登录' });

  const { source, speaker, dimensions, summary, keyFindings, completedPaths, currentPaths } = req.body;
  if (!dimensions) return res.status(400).json({ error: '缺少维度数据' });

  const data = readUserRecords(userId);

  const record = {
    id: genId(),
    timestamp: new Date().toISOString(),
    source: source || '未知来源',
    speaker: speaker || '未知',
    dimensions,
    summary: summary || '',
    keyFindings: keyFindings || [],
    completedPaths: completedPaths || [],
    currentPaths: currentPaths || [],
  };

  data.records.push(record);
  data.lastUpdated = record.timestamp;

  writeUserRecords(data);
  res.json({ success: true, record });
});

// GET /api/growth-records/all - admin: all users' records summary
router.get('/all', (req, res) => {
  if (req.session.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });

  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const users = files.map(file => {
    const userId = file.replace('.json', '');
    const data = readUserRecords(userId);
    // Load user info from users.json
    const usersPath = path.join(__dirname, '../../data/users.json');
    let username = userId;
    let role = 'user';
    if (fs.existsSync(usersPath)) {
      try {
        const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
        const userEntry = Object.entries(usersData).find(([k]) => k === userId);
        if (userEntry) { username = userEntry[0]; role = userEntry[1].role || 'user'; }
      } catch {}
    }
    return {
      userId,
      username,
      role,
      recordCount: data.records.length,
      firstRecord: data.records[0]?.timestamp || null,
      lastRecord: data.records[data.records.length - 1]?.timestamp || null,
      lastUpdated: data.lastUpdated,
    };
  });

  res.json(users);
});

// GET /api/growth-records/user/:userId - admin: specific user's records
router.get('/user/:userId', (req, res) => {
  if (req.session.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  const userId = req.params.userId;
  const data = readUserRecords(userId);
  res.json(data);
});

module.exports = router;
