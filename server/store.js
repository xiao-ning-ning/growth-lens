const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-key-here') {
    throw new Error('请在 .env 文件中配置 OPENAI_API_KEY');
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    timeout: parseInt(process.env.OPENAI_TIMEOUT || '300000', 10), // 默认 5 分钟
  });
}

/**
 * 调用 LLM，返回 JSON 格式的结果
 */
async function callLLM(systemPrompt, userPrompt) {
  const client = getClient();
  // MiniMax 模型需要 reasoning_split=true 来分离思考过程
  const isMinimax = (process.env.OPENAI_BASE_URL || '').includes('minimax');
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
    ...(isMinimax ? { extra_body: { reasoning_split: true } } : {}),
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error('LLM 返回空响应（可能触发了安全过滤），请修改输入后重试');
  }

  const raw = response.choices[0].message.content;
  // 尝试直接解析
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 推理模型（如 DeepSeek-R1/MiniMax）可能先输出思考过程（<think>...</think> 或<think>...</think>），需要剥离
    let cleaned = raw
      .replace(/\s*<think>[\s\S]*?<\/think>/gi, '\n')
      .replace(/\s*<think>[\s\S]*?<\/think>/gi, '\n');
    // 尝试从代码块中提取
    const codeBlockMatch = cleaned.match(/```(?:json)?[\s\S]*?```/);
    if (codeBlockMatch) {
      try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e2) {}
    }
    // 尝试找第一个 { 到最后一个 } 的完整 JSON 对象
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch (e3) {}
    }
    throw new Error('LLM 返回的 JSON 解析失败: ' + raw.substring(0, 200));
  }
}

/**
 * 调用 LLM，返回纯文本结果
 */
async function callLLMText(systemPrompt, userPrompt) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
  });
  if (!response.choices || response.choices.length === 0) {
    throw new Error('LLM 返回空响应（可能触发了安全过滤），请修改输入后重试');
  }
  return response.choices[0].message.content;
}

// ============ 数据管理 ============

const BASE_DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir(username) {
  const dir = username
    ? path.join(BASE_DATA_DIR, username)
    : BASE_DATA_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getMapPath(username) {
  return path.join(ensureDataDir(username), 'cognition-map.json');
}

function getBackupPath(username) {
  return path.join(ensureDataDir(username), 'cognition-map.backup.json');
}

function loadMap(username) {
  const filePath = getMapPath(username);
  if (!fs.existsSync(filePath)) return createEmptyMap();
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    // Basic validation: must have dimensions array
    if (!parsed || !Array.isArray(parsed.dimensions)) {
      throw new Error('Invalid map structure');
    }
    // Sync category from categories[].dimIds → dimensions[].category
    syncCategoryToDimensions(parsed);

    // 数据迁移：v3 → v4，补 starCount 和 evidence.polarity，并按 starCount 重算 status
    if ((parsed.version || 0) < 4) {
      console.log('[store] Migrating map to v4: adding starCount and recalculating status');
      parsed.dimensions = parsed.dimensions.filter(dim => {
        // 补 polarity
        for (const ev of dim.evidence) {
          if (ev.polarity === undefined) ev.polarity = 1;
        }
        dim.starCount = dim.evidence.reduce((sum, ev) => sum + (ev.polarity || 1), 0);
        // 按 starCount 重算 status
        if (dim.starCount > 0) dim.status = 'possessed';
        else if (dim.starCount < 0) dim.status = 'developing';
        // starCount === 0 → 移除该维度
        return dim.starCount !== 0;
      });
      parsed.version = 4;
    }

    return parsed;
  } catch (e) {
    console.error(`[store] Failed to load map: ${e.message}`);
    // If file exists but is corrupted, try to restore from backup
    const backupPath = getBackupPath(username);
    if (fs.existsSync(backupPath)) {
      try {
        const backupData = fs.readFileSync(backupPath, 'utf-8');
        const parsed = JSON.parse(backupData);
        if (parsed && Array.isArray(parsed.dimensions)) {
          console.warn('[store] Restored from backup');
          // Save the restored backup as the main file
          fs.writeFileSync(filePath, backupData, 'utf-8');
          return parsed;
        }
      } catch (backupErr) {
        console.error(`[store] Backup also corrupted: ${backupErr.message}`);
      }
    }
    // No valid backup, rename corrupted file and return empty
    const corruptPath = filePath + '.corrupt';
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, corruptPath);
      console.warn(`[store] Corrupted file moved to ${corruptPath}`);
    }
    return createEmptyMap();
  }
}

const writeLocks = {};

function saveMap(username, map) {
  // Per-user write lock
  if (!writeLocks[username]) writeLocks[username] = Promise.resolve();
  writeLocks[username] = writeLocks[username].then(() => {
    ensureDataDir(username);
    const filePath = getMapPath(username);
    // Always keep a backup before writing
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, getBackupPath(username));
      } catch (e) {
        console.error(`[store] Failed to create backup: ${e.message}`);
      }
    }
    map.lastUpdated = new Date().toISOString().split('T')[0];
    fs.writeFileSync(filePath, JSON.stringify(map, null, 2), 'utf-8');
    return map;
  });
  return writeLocks[username];
}

function createEmptyMap() {
  return {
    version: 4,
    owner: '',
    lastUpdated: new Date().toISOString().split('T')[0],
    speakers: [],
    categories: [],
    dimensions: [],
    sourceLog: [],
    combinations: [],
    blindSpots: [],
    developmentPaths: [],
    radarAxes: [],
  };
}

// ============ ID 生成 ============

const ID_COUNTER_FILE = path.join(BASE_DATA_DIR, '.id_counter');
let idCounter = (() => {
  try {
    if (fs.existsSync(ID_COUNTER_FILE)) {
      const n = parseInt(fs.readFileSync(ID_COUNTER_FILE, 'utf-8').trim(), 10);
      if (!isNaN(n)) return n;
    }
  } catch (e) {}
  return Date.now();
})();
function persistIdCounter() {
  try { fs.writeFileSync(ID_COUNTER_FILE, String(idCounter), 'utf-8'); } catch (e) {}
}
function nextId(prefix) {
  idCounter++;
  persistIdCounter();
  return `${prefix}_${idCounter.toString(36)}`;
}

// ============ 维度分类同步 ============

/**
 * 从 categories[].dimIds 反向同步到 dimensions[].category
 * 确保每个维度的 category 字段与分类关系一致
 */
function syncCategoryToDimensions(map) {
  if (!map.categories || !map.dimensions) return;
  // Build dimId → catId mapping from categories
  const dimCatMap = {};
  for (const cat of map.categories) {
    for (const dimId of (cat.dimIds || [])) {
      dimCatMap[dimId] = cat.id;
    }
  }
  // Apply to dimensions
  for (const dim of map.dimensions) {
    if (dimCatMap[dim.id]) {
      dim.category = dimCatMap[dim.id];
    }
  }
}

// ============ 雷达轴盲区同步 ============

/**
 * 将盲区引用同步到雷达轴 blindIds
 * 在 blindspots.js 和 analyze.js 中共用，避免重复代码
 */
function syncBlindSpotsToRadarAxes(map) {
  // First, clear all existing blindIds
  for (const axis of map.radarAxes) {
    axis.blindIds = [];
  }
  // Then, re-assign based on current blindSpots
  for (const blind of map.blindSpots) {
    for (const axis of map.radarAxes) {
      if (blind.relatedDimensions && blind.relatedDimensions.some(rid =>
        axis.dimIds && axis.dimIds.includes(rid)
      )) {
        if (!axis.blindIds.includes(blind.id)) axis.blindIds.push(blind.id);
      }
    }
  }
}

module.exports = {
  callLLM,
  callLLMText,
  loadMap,
  saveMap,
  createEmptyMap,
  nextId,
  MODEL,
  syncBlindSpotsToRadarAxes,
};
