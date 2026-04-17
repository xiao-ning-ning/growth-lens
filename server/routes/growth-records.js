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
  
  const { userId } = req.params;
  const data = readUserRecords(userId);
  
  // Get username from users.json
  const usersPath = path.join(__dirname, '../../data/users.json');
  let username = userId;
  if (fs.existsSync(usersPath)) {
    try {
      const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
      if (usersData[userId]) {
        username = userId;
      }
    } catch {}
  }
  
  res.json({
    userId,
    username,
    records: data.records || [],
    lastUpdated: data.lastUpdated,
  });
});

// GET /api/growth-records/user/:userId - admin: specific user's records
router.get('/user/:userId', (req, res) => {
  if (req.session.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  const userId = req.params.userId;
  const data = readUserRecords(userId);
  res.json(data);
});

// DELETE /api/growth-records/:recordId - delete a specific record
router.delete('/:recordId', (req, res) => {
  const userId = req.session.user?.id || req.session.user?.username;
  if (!userId) return res.status(401).json({ error: '未登录' });

  const data = readUserRecords(userId);
  const recordIndex = data.records.findIndex(r => r.id === req.params.recordId);
  
  if (recordIndex === -1) {
    return res.status(404).json({ error: '记录不存在' });
  }

  // 获取要删除的记录中的 possessed 维度
  const deletedRecord = data.records[recordIndex];
  const deletedPossessedDims = Object.entries(deletedRecord.dimensions || {})
    .filter(([, status]) => status === 'possessed')
    .map(([dimId]) => dimId);

  // 删除记录
  data.records.splice(recordIndex, 1);
  data.lastUpdated = data.records.length > 0 ? data.records[data.records.length - 1].timestamp : null;
  
  writeUserRecords(data);

  // 同步更新 cognition-map
  if (deletedPossessedDims.length > 0) {
    const mapPath = path.join(__dirname, '..', '..', 'data', 'admin', 'cognition-map.json');
    const userMapPath = path.join(__dirname, '..', '..', 'data', userId, 'cognition-map.json');
    let finalMapPath = null;
    
    if (fs.existsSync(userMapPath)) {
      finalMapPath = userMapPath;
    } else if (userId === 'admin' && fs.existsSync(mapPath)) {
      finalMapPath = mapPath;
    }
    
    if (finalMapPath) {
      try {
        const mapData = JSON.parse(fs.readFileSync(finalMapPath, 'utf-8'));
        
        // 检查每个被删除的 possessed 维度是否还被其他记录支持
        deletedPossessedDims.forEach(dimId => {
          const stillPossessed = data.records.some(r => 
            r.dimensions && r.dimensions[dimId] === 'possessed'
          );
          
          if (!stillPossessed) {
            // 没有其他记录支持 possessed，降级为 no_data
            const dim = mapData.dimensions?.find(d => d.id === dimId);
            if (dim && dim.status === 'possessed') {
              dim.status = 'no_data';
              // 移除证据
              dim.evidence = [];
            }
          }
        });
        
        fs.writeFileSync(finalMapPath, JSON.stringify(mapData, null, 2), 'utf-8');
      } catch (e) {
        console.error('更新cognition-map失败:', e);
      }
    } else {
      console.log('[delete-record] 未找到map文件，userMapPath:', userMapPath, 'mapPath:', mapPath);
    }
  }
  
  res.json({ success: true });
});

module.exports = router;
