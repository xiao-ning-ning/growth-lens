const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const USERS_FILE = path.join(__dirname, '..', '..', 'data', 'users.json');

function getUsers() {
  if (!fs.existsSync(USERS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function saveUsers(users) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function hashWithUserSalt(password, user) {
  return hashPassword(password, user.salt || 'growth-force-field-salt');
}

/**
 * Ensure admin account exists on first run
 */
function ensureAdmin() {
  let users = getUsers();
  if (!users) {
    users = {
      admin: (() => {
        const salt = genSalt();
        return { salt, password: hashPassword('admin123456', salt), role: 'admin', createdAt: new Date().toISOString() };
      })()
    };
    saveUsers(users);
    console.log('\n  [auth] Default admin account created: admin / admin123456');
    console.log('  [auth] Please change the password after first login!\n');
  }
  return users;
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }
  const users = getUsers();
  if (!users || !users[username]) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const user = users[username];
  if (user.password !== hashWithUserSalt(password, user)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  // Set session
  req.session.user = { username, role: user.role };
  res.json({ success: true, user: { username, role: user.role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// GET /api/auth/me - get current user info
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  res.json({ user: req.session.user });
});

// POST /api/auth/change-password - change own password
router.post('/change-password', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请输入旧密码和新密码' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: '新密码不能少于8位' });
  }
  const users = getUsers();
  const user = users[req.session.user.username];
  if (user.password !== hashWithUserSalt(oldPassword, user)) {
    return res.status(401).json({ error: '旧密码错误' });
  }
  user.salt = genSalt();
  user.password = hashPassword(newPassword, user.salt);
  saveUsers(users);
  res.json({ success: true });
});

// ============ Admin-only routes ============

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// GET /api/auth/users - list all users
router.get('/users', requireAdmin, (req, res) => {
  const users = getUsers();
  const list = Object.entries(users).map(([username, info]) => ({
    username,
    role: info.role,
    createdAt: info.createdAt
  }));
  res.json({ users: list });
});

// POST /api/auth/users - create a new user
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: '密码不能少于8位' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: '用户名只能包含字母、数字和下划线' });
  }
  const users = getUsers();
  if (users[username]) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const salt = genSalt();
  users[username] = {
    salt,
    password: hashPassword(password, salt),
    role: role || 'user',
    createdAt: new Date().toISOString()
  };
  saveUsers(users);
  res.json({ success: true, username });
});

// POST /api/auth/users/delete - delete a user

// PUT /api/auth/users - update a user's username or password (admin)
router.put('/users', requireAdmin, (req, res) => {
  const { username, newUsername, newPassword } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });

  const users = getUsers();
  if (!users[username]) return res.status(404).json({ error: '用户不存在' });

  // Cannot modify admin username
  if (username === 'admin' && newUsername && newUsername !== 'admin') {
    return res.status(400).json({ error: '不能修改管理员用户名' });
  }

  // Update username if provided and different
  if (newUsername && newUsername !== username) {
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      return res.status(400).json({ error: '用户名只能包含字母、数字和下划线' });
    }
    if (users[newUsername]) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    // Rename user key
    users[newUsername] = users[username];
    delete users[username];
    // Update session if the admin is editing themselves
    if (req.session.user.username === username) {
      req.session.user.username = newUsername;
    }
  }

  // Update password if provided
  if (newPassword) {
    if (newPassword.length < 8) {
      return res.status(400).json({ error: '密码不能少于8位' });
    }
    const targetKey = (newUsername && newUsername !== username) ? newUsername : username;
    users[targetKey].salt = genSalt();
    users[targetKey].password = hashPassword(newPassword, users[targetKey].salt);
  }

  saveUsers(users);
  res.json({ success: true });
});
router.post('/users/delete', requireAdmin, (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: '请指定用户名' });
  }
  if (username === 'admin') {
    return res.status(400).json({ error: '不能删除管理员账号' });
  }
  if (username === req.session.user.username) {
    return res.status(400).json({ error: '不能删除当前登录的账号' });
  }
  const users = getUsers();
  if (!users[username]) {
    return res.status(404).json({ error: '用户不存在' });
  }
  delete users[username];
  saveUsers(users);
  // Optionally delete user data directory
  const userDir = path.join(__dirname, '..', '..', 'data', username);
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  res.json({ success: true });
});

// POST /api/auth/users/reset-password - reset a user's password (admin)
router.post('/users/reset-password', requireAdmin, (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({ error: '请输入用户名和新密码' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: '密码不能少于8位' });
  }
  const users = getUsers();
  if (!users[username]) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const salt = genSalt();
  users[username].salt = salt;
  users[username].password = hashPassword(newPassword, salt);
  saveUsers(users);
  res.json({ success: true });
});

module.exports = { router, ensureAdmin };
