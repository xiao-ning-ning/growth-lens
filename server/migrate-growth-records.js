/**
 * 迁移脚本：从 cognition-map.json 提取历史分析，生成成长轨迹记录
 * 运行方式：node server/migrate-growth-records.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RECORDS_DIR = path.join(DATA_DIR, 'growth-records');

// 固定五大分类（用于推断 category）
const FIXED_CATEGORIES = [
  { name: '战略与诊断', icon: '🎯', dimIds: [] },
  { name: '管控与绩效', icon: '⚡', dimIds: [] },
  { name: '人心与温度', icon: '💚', dimIds: [] },
  { name: '知识与赋能', icon: '📚', dimIds: [] },
  { name: '制度与设计', icon: '⚙️', dimIds: [] },
];

function loadMap(username) {
  const filePath = path.join(DATA_DIR, username, 'cognition-map.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveGrowthRecord(username, records) {
  if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
  const filePath = path.join(RECORDS_DIR, `${username}.json`);
  const data = { userId: username, records, lastUpdated: records.length > 0 ? records[records.length - 1].timestamp : null };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

function parseSourceDate(source) {
  // 尝试从 source 名称中提取日期，如 "2026-04-03 部门规划讨论录音"
  const match = source.match(/^(\d{4}-\d{2}-\d{2})\s/);
  if (match) return match[1];
  // 尝试 YYYY/MM/DD
  const match2 = source.match(/^(\d{4}\/\d{2}\/\d{2})\s/);
  if (match2) return match2[1].replace(/\//g, '-');
  return null;
}

function buildRecordsFromMap(map, username) {
  if (!map || !map.dimensions) return [];

  // 获取用户显示名（基本信息中设置的姓名）
  const displayName = map.owner || username;

  // 收集所有唯一的 source → dimensions 映射
  const sourceMap = {}; // sourceName → { date, dimensions: { dimId: status }, speakers: Set }

  for (const dim of map.dimensions) {
    const status = dim.status || 'no_data';

    for (const ev of (dim.evidence || [])) {
      const source = ev.source || '未知来源';
      const date = parseSourceDate(source) || map.lastUpdated || new Date().toISOString().split('T')[0];

      if (!sourceMap[source]) {
        sourceMap[source] = { date, source, dimensions: {} };
      }
      sourceMap[source].dimensions[dim.id] = status;
    }

    // 如果没有 evidence，至少记录这个维度的状态
    if (!dim.evidence || dim.evidence.length === 0) {
      const defaultSource = '初始状态（' + (map.lastUpdated || '未知') + '）';
      if (!sourceMap[defaultSource]) {
        sourceMap[defaultSource] = {
          date: map.lastUpdated || new Date().toISOString().split('T')[0],
          source: defaultSource,
          dimensions: {}
        };
      }
      sourceMap[defaultSource].dimensions[dim.id] = status;
    }
  }

  // 转换为记录数组，按日期排序
  const entries = Object.values(sourceMap).map(entry => ({
    id: crypto.randomUUID(),
    timestamp: entry.date + 'T00:00:00.000Z',
    source: entry.source,
    speaker: displayName,
    dimensions: entry.dimensions,
    summary: buildSummary(map, entry.dimensions),
    keyFindings: buildKeyFindings(map, entry.dimensions),
    completedPaths: [],
    currentPaths: (map.developmentPaths || []).map(p => ({ id: p.id, name: p.targetName })),
  }));

  // 按日期排序
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return entries;
}

function getCategoryName(map, dim) {
  if (!map.categories || !dim.category) return '';
  const cat = map.categories.find(c => c.id === dim.category);
  return cat ? cat.name : '';
}

function buildSummary(map, dimensions) {
  const possessed = Object.entries(dimensions).filter(([, s]) => s === 'possessed').length;
  const developing = Object.entries(dimensions).filter(([, s]) => s === 'developing').length;
  const blind = Object.entries(dimensions).filter(([, s]) => s === 'blind').length;
  const total = Object.keys(dimensions).length;
  return `当前能力图谱含 ${total} 个维度：已具备 ${possessed}，待发展 ${developing}，盲区 ${blind}`;
}

function buildKeyFindings(map, dimensions) {
  const findings = [];
  for (const [dimId, status] of Object.entries(dimensions)) {
    if (status === 'blind') {
      const dim = map.dimensions?.find(d => d.id === dimId);
      if (dim) findings.push(`${dim.name}（盲区）：${dim.description || '存在行为模式盲区'}`);
    }
    if (status === 'possessed') {
      const dim = map.dimensions?.find(d => d.id === dimId);
      if (dim && (dim.evidence?.length || 0) > 0) {
        findings.push(`${dim.name}（已具备）：${dim.description || '展现出成熟的行为模式'}`);
      }
    }
  }
  return findings.slice(0, 5);
}

function main() {
  const force = process.argv.includes('--force');
  console.log('\n========== 成长轨迹迁移脚本 ==========\n');

  // 获取所有用户目录
  if (!fs.existsSync(DATA_DIR)) {
    console.log('[!] data 目录不存在');
    return;
  }

  const entries = fs.readdirSync(DATA_DIR);
  const users = entries.filter(e => {
    const p = path.join(DATA_DIR, e);
    return fs.statSync(p).isDirectory() && !e.startsWith('.') && e !== 'growth-records';
  });

  console.log(`发现 ${users.length} 个用户：${users.join(', ')}\n`);

  for (const user of users) {
    const map = loadMap(user);
    if (!map) {
      console.log(`[跳过] ${user}：未找到 cognition-map.json`);
      continue;
    }

    // 检查是否已有成长记录
    const recordFile = path.join(RECORDS_DIR, `${user}.json`);
    const existingRecords = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf-8')).records || [] : [];
    if (existingRecords.length > 0 && !force) {
      console.log(`[跳过] ${user}：已有 ${existingRecords.length} 条成长记录（加 --force 重新生成）`);
      continue;
    }

    const records = buildRecordsFromMap(map, user);
    if (records.length === 0) {
      console.log(`[跳过] ${user}：无法提取历史记录`);
      continue;
    }

    saveGrowthRecord(user, records);
    console.log(`[OK] ${user}：生成 ${records.length} 条成长记录`);
    for (const r of records) {
      console.log(`     - ${r.source}（${r.speaker}）`);
    }
  }

  console.log('\n========== 迁移完成 ==========\n');
}

main();
