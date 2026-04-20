const express = require('express');
const multer = require('multer');
const router = express.Router();
const { callLLM, loadMap, saveMap, nextId, syncBlindSpotsToRadarAxes } = require('../store');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_FILE = path.join(__dirname, '../../data/schema.json');

// 加载自定义 schema（如果存在）
function loadSchema() {
  if (!fs.existsSync(SCHEMA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// 保存成长记录快照
function saveGrowthRecord(req, map, source) {
  const userId = req.userId || req.session?.user?.username;
  if (!userId) return;
  const DATA_DIR = path.join(__dirname, '../../data/growth-records');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, `${userId}.json`);
  let data = { userId, records: [], lastUpdated: null };
  if (fs.existsSync(filePath)) {
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch {}
  }

  // 获取用户显示名：优先用基本信息设置的姓名，其次用账户名
  const displayName = map.owner || userId;

  // 构建维度快照
  const dimensions = {};
  map.dimensions.forEach(d => {
    dimensions[d.id] = d.status;
  });

  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: source || '未知来源',
    speaker: displayName,
    dimensions,
    summary: map.summary || '',
    keyFindings: [],
    completedPaths: (map.developmentPaths || []).filter(p => p.completed).map(p => p.id),
    currentPaths: (map.developmentPaths || []).map(p => ({ id: p.id, name: p.targetName })),
  };

  data.records.push(record);
  data.lastUpdated = record.timestamp;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// 五大固定分类
const FIXED_CATEGORIES = [
  { name: '战略与诊断', icon: '🎯', description: '方向判断、问题定位、格局视野、风险预见' },
  { name: '管控与绩效', icon: '⚡', description: '目标管理、流程管控、结果导向、绩效追踪' },
  { name: '人心与温度', icon: '💚', description: '关系建立、共情理解、激励认可、团队凝聚' },
  { name: '知识与赋能', icon: '📚', description: '经验萃取、知识传递、辅导带教、能力复制' },
  { name: '制度与设计', icon: '⚙️', description: '机制建设、规则制定、流程设计、系统搭建' },
];

// 将 LLM 返回的分类名归一化到五大分类之一
function normalizeCategory(categoryName) {
  if (!categoryName) return FIXED_CATEGORIES[0];
  // 精确匹配
  const exact = FIXED_CATEGORIES.find(c => c.name === categoryName);
  if (exact) return exact;
  // 模糊匹配：看分类名中的关键词
  const lower = categoryName.toLowerCase();
  if (/战略|诊断|方向|判断|格局|风险/i.test(lower)) return FIXED_CATEGORIES[0];
  if (/管控|绩效|目标|流程|结果|追踪/i.test(lower)) return FIXED_CATEGORIES[1];
  if (/人心|温度|关系|共情|激励|团队|情感/i.test(lower)) return FIXED_CATEGORIES[2];
  if (/知识|赋能|经验|传递|辅导|带教|培训/i.test(lower)) return FIXED_CATEGORIES[3];
  if (/制度|设计|机制|规则|流程|系统|搭建/i.test(lower)) return FIXED_CATEGORIES[4];
  // 无法归类，默认归入"制度与设计（扩展）"
  return { name: categoryName, icon: '📌', description: categoryName };
}

// 配置 multer：内存存储，不写临时文件
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// POST /api/analyze - 分析录音文本（支持文件上传和文本两种方式）
router.post('/', upload.single('file'), async (req, res) => {
  try {
    let transcript = '';
    const { speakerName, sourceName, date } = req.body;

    if (req.file) {
      // 文件上传方式：直接从 buffer 读取，不经过 textarea
      transcript = req.file.buffer.toString('utf-8');
    } else if (req.body.transcript) {
      // 文本方式：兼容旧逻辑
      transcript = req.body.transcript;
    }

    if (!transcript || !speakerName) {
      return res.status(400).json({ error: '缺少必要参数: 文件或文本, speakerName' });
    }

    const map = loadMap(req.userId);
    const schema = loadSchema();
    const existingDimsSummary = map.dimensions.map(d => ({
      id: d.id, name: d.name, status: d.status, category: d.category,
      evidenceCount: d.evidence.length, description: d.description,
      starCount: d.starCount || 0,
    }));

    // ========== 分支：自定义 schema 模式 ==========
    if (schema && schema.categories && schema.categories.length > 0) {
      const schemaPrompt = buildSchemaPrompt(schema, transcript, speakerName, sourceName, date, existingDimsSummary, map);
      const result = await callLLM(schemaPrompt.system, schemaPrompt.user);
      const parsed = JSON.parse(result);
      const updates = processSchemaResult(map, parsed, speakerName, sourceName, date);
      await saveMap(req.userId, map);
      saveGrowthRecord(req, map, sourceName);
      return res.json({
        success: true,
        map,
        updates,
        summary: parsed.summary || '',
        mode: 'schema',
      });
    }

    // ========== 分支：AI 自由生成模式 ==========
    const systemPrompt = `你是"成长力场"的分析引擎，专门从录音转写文本中提取人的行为特征和能力维度。

核心信念：人对自己能力的认知往往存在盲区——有些能力每天都在用，但从未命名和显性化。

## 分析原则

1. **证据驱动，不预设维度**: 维度是从行为中长出来的，不是预设的框架
2. **原文引用必须有**: 每条证据必须附原文引用
3. **解读要有判断力**: 不是简单复述原话，而是点出原话背后展现的能力或能力缺口
4. **维度命名要精准**: 用"战略拆解力"而非"规划能力"，用"温和的残酷"而非"决策力"
5. **金字塔原则**: 不同维度之间必须有清晰边界，不能描述重叠。如果两个维度的核心内涵高度相似，必须只保留一个，或明确说明区分点
6. **去重校验**: 在输出前自检——逐对比较所有维度的 description 和核心内涵，去除描述雷同的维度，保留信息量最大的那个
7. **层次分明**: 高层次维度（如战略视野）与低层次维度（如具体操作技能）要区分清楚，不能混为一谈

## 星星评分机制（核心）

每条证据有极性：
- **+1星（正面）**：行为展现了正向能力，如成功解决问题、推动协作、主动承担责任、展现领导力等
- **-1星（负面）**：行为暴露了能力缺口或盲点，如沟通不畅、决策失误、回避责任、缺乏规划等

维度星级 = 该维度所有证据的极性之和：
- 星级 > 0 → **已具备（possessed）**
- 星级 < 0 → **待发展（developing）**
- 星级 = 0 → **该维度被移除**（正面负面相互抵消，不归类）

正负面证据都要找，两者都要有行为依据。

## 五大能力分类（必须且只能使用这 5 个分类）

分析维度时，将能力归入以下分类之一：
1. **战略与诊断**：方向判断、问题定位、格局视野、风险预见
2. **管控与绩效**：目标管理、流程管控、结果导向、绩效追踪
3. **人心与温度**：关系建立、共情理解、激励认可、团队凝聚
4. **知识与赋能**：经验萃取、知识传递、辅导带教、能力复制
5. **制度与设计**：机制建设、规则制定、流程设计、系统搭建

如果某个能力无法归入以上任何一类，在分类名称中补充说明，格式为"制度与设计（扩展）"这样的扩展形式。

## 输出格式

返回 JSON，格式如下：
{
  "owner": "说话人名称",
  "newDimensions": [
    {
      "name": "维度名称",
      "categoryName": "分类名称",
      "categoryIcon": "emoji图标",
      "description": "一句话定义该维度的核心内涵",
      "evidence": {
        "polarity": "+1|-1",
        "source": "来源名称",
        "speaker": "说话人",
        "quote": "原文引用",
        "interpretation": "AI对这段行为的解读"
      },
      "confidence": "强|中|弱",
      "relatedTo": ["已有维度id或新维度名称"]
    }
  ],
  "updatedDimensions": [
    {
      "dimensionId": "已有维度ID",
      "newEvidence": {
        "polarity": "+1|-1",
        "source": "来源名称",
        "speaker": "说话人",
        "quote": "原文引用",
        "interpretation": "AI对这段行为的解读"
      },
      "confidenceChange": "强|中|弱|不变"
    }
  ],
  "mergeSuggestions": [
    {
      "dimensionIds": ["dim_xxx", "dim_yyy"],
      "reason": "合并理由",
      "suggestedName": "合并后的维度名称"
    }
  ],
  "summary": "本次分析的摘要说明"
}`;

    const userPrompt = `## 待分析的录音转写文本

来源: ${sourceName || '未命名录音'}
日期: ${date || new Date().toISOString().split('T')[0]}
目标说话人: ${speakerName}

### 文本内容
${transcript}

## 已有维度（共 ${map.dimensions.length} 个）
${existingDimsSummary.length > 0 ? existingDimsSummary.map(d =>
  `- [${d.id}] ${d.name} (${d.status}, ${d.evidenceCount}条证据): ${d.description}`
).join('\n') : '（暂无已有维度，这是首次分析）'}

## 已有维度及星级（共 ${map.dimensions.length} 个，供去重和星级累加参考）
${existingDimsSummary.length > 0 ? existingDimsSummary.map(d =>
  `- [${d.id}] ${d.name} (星级: ${d.starCount}, ${d.evidenceCount}条证据): ${d.description}`
).join('\n') : '（暂无已有维度，这是首次分析）'}

请深度分析上述文本中"${speakerName}"的行为模式，提取能力维度。`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 处理分析结果，更新地图
    const updates = processAnalysisResult(map, result, speakerName, sourceName, date);

    await saveMap(req.userId, map);

    await saveMap(req.userId, map);

    // 自动保存成长记录快照
    saveGrowthRecord(req, map, sourceName);

    res.json({
      success: true,
      map,
      updates,
      summary: result.summary,
    });

  } catch (error) {
    console.error('分析失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 构建 schema 模式的 prompt
 */
function buildSchemaPrompt(schema, transcript, speakerName, sourceName, date, existingDimsSummary, map) {
  // 把 schema 的所有维度展开成 AI 可理解的列表
  const dimList = [];
  for (const cat of schema.categories) {
    for (const dim of (cat.dimensions || [])) {
      dimList.push({
        catName: cat.name,
        catIcon: cat.icon || '',
        catDesc: cat.description || '',
        dimId: dim.id,
        dimName: dim.name,
        dimDesc: dim.description || '',
        indicatorPossessed: dim.indicators?.possessed || '',
        indicatorDeveloping: dim.indicators?.developing || '',
      });
    }
  }

  const dimDescriptions = dimList.map(d =>
    `【${d.catName} / ${d.dimName}】
定义：${d.dimDesc}
判断标准-已具备：${d.indicatorPossessed}
判断标准-待发展：${d.indicatorDeveloping}`
  ).join('\n\n');

  const systemPrompt = `你是"成长力场"的能力分析引擎，严格按照给定的维度定义从文本中提取行为证据。

## 星星评分机制（核心）

每条证据有极性：
- **+1星（正面）**：行为展现了正向能力，如成功解决问题、推动协作、主动承担责任等
- **-1星（负面）**：行为暴露了能力缺口或盲点，如沟通不畅、决策失误、回避责任等

维度星级 = 该维度所有证据的极性之和：
- 星级 > 0 → **已具备（possessed）**
- 星级 < 0 → **待发展（developing）**
- 星级 = 0 → **移除该维度**（正面负面相互抵消，不归类）

## 核心原则

1. **严格匹配，不自由发挥**：只分析以下预定义维度，不得自行创造新维度
2. **无证据不输出**：某个维度在文本中没有对应行为证据时，直接跳过，不要虚构
3. **原文引用必须有**：每条证据必须附原文引用
4. **正负面都要找**：既找正面证据（+1），也找负面证据（-1），两者都要有行为依据
5. **解读要揭示原因**：解释为什么这段话是正面的或负面的

## 预定义能力维度

${dimDescriptions}

## 输出格式

只输出 JSON，不要其他内容：
{
  "matchedDimensions": [
    {
      "dimensionId": "维度ID",
      "dimensionName": "维度名称",
      "evidence": {
        "polarity": "+1|-1",
        "quote": "原文引用（完整原句）",
        "interpretation": "AI解读：这段话为什么是正面/负面的能力体现"
      },
      "confidence": "强|中|弱（基于证据来源数量，而非极性）"
    }
  ],
  "summary": "本次分析的简短摘要（说明各维度的星级变化）"
}`;

  const userPrompt = `## 待分析的录音转写文本

来源: ${sourceName || '未命名录音'}
日期: ${date || new Date().toISOString().split('T')[0]}
目标说话人: ${speakerName}

### 文本内容
${transcript}

## 已有维度及星级（共 ${map.dimensions.length} 个，供去重和星级累加参考）
${existingDimsSummary.length > 0 ? existingDimsSummary.map(d =>
  `- [${d.id}] ${d.name} (星级: ${d.starCount || 0}, ${d.evidenceCount}条证据): ${d.description}`
).join('\n') : '（暂无已有维度）'}

请严格按照预定义维度逐一判断，输出匹配的维度及其证据（含极性标注）。`;

  return { system: systemPrompt, user: userPrompt };
}

/**
 * 处理 schema 模式分析结果
 */
function processSchemaResult(map, result, speakerName, sourceName, date) {
  const updates = { newDims: [], updatedDims: [], removedDims: [], mergeSuggestions: [], radarAxesChanges: [] };
  const sourceDate = date || new Date().toISOString().split('T')[0];
  const sourceLabel = sourceName || '未命名录音';

  // 确保 speaker 存在
  let speaker = map.speakers.find(s => s.name === speakerName);
  if (!speaker) {
    speaker = { id: nextId('speaker'), name: speakerName };
    map.speakers.push(speaker);
  }

  const matchedDims = result.matchedDimensions || [];

  for (const matched of matchedDims) {
    const polarity = matched.evidence?.polarity === '-1' ? -1 : 1;

    // 在已有维度中查找雷同（同名）
    const existing = map.dimensions.find(d => d.name === matched.dimensionName);

    if (existing) {
      // 追加证据
      existing.evidence.push({
        source: sourceLabel,
        speaker: speakerName,
        quote: matched.evidence?.quote || '',
        corrected: false,
        interpretation: matched.evidence?.interpretation || '',
        date: sourceDate,
        polarity: polarity,
      });

      // 重新计算星级和状态
      recalcDimension(existing);

      // 星级归零则移除该维度
      if (existing.starCount === 0) {
        map.dimensions = map.dimensions.filter(d => d.id !== existing.id);
        updates.removedDims.push({ id: existing.id, name: existing.name });
        updates.updatedDims.push({ id: existing.id, name: existing.name, action: '星级归零，移除' });
      } else {
        updates.updatedDims.push({ id: existing.id, name: existing.name, action: '追加证据，星级' + existing.starCount });
      }
    } else {
      // 创建新维度
      const dimId = nextId('dim');
      const dim = {
        id: dimId,
        name: matched.dimensionName,
        status: polarity > 0 ? 'possessed' : 'developing',
        category: '',
        speakerId: speaker.id,
        description: '',
        evidence: [{
          source: sourceLabel,
          speaker: speakerName,
          quote: matched.evidence?.quote || '',
          corrected: false,
          interpretation: matched.evidence?.interpretation || '',
          date: sourceDate,
          polarity: polarity,
        }],
        relatedTo: [],
        confidence: matched.confidence || '弱',
        starCount: polarity,
      };

      // 星级为零则不创建
      if (dim.starCount === 0) {
        updates.removedDims.push({ id: dimId, name: matched.dimensionName, action: '星级归零，不创建' });
      } else {
        map.dimensions.push(dim);
        updates.newDims.push({ id: dimId, name: dim.name, status: dim.status, starCount: dim.starCount });
      }
    }
  }

  // 维护雷达轴
  maintainRadarAxes(map);

  // 记录 sourceLog
  map.sourceLog.push({
    date: sourceDate,
    source: sourceLabel,
    speaker: speakerName,
    dimensionsAffected: [...updates.newDims.map(d => d.id), ...updates.updatedDims.map(d => d.id)],
    summary: result.summary || `本次分析匹配 ${matchedDims.length} 个维度，新增 ${updates.newDims.length} 个，移除 ${updates.removedDims.length} 个`,
  });

  return updates;
}

/**
 * 计算维度的星级和状态
 */
function recalcDimension(dim) {
  dim.starCount = dim.evidence.reduce((sum, ev) => sum + (ev.polarity || 1), 0);
  if (dim.starCount > 0) {
    dim.status = 'possessed';
  } else if (dim.starCount < 0) {
    dim.status = 'developing';
  }
  // starCount === 0 时不设置 status，交给调用方处理移除
  const evidenceCount = dim.evidence.length;
  dim.confidence = evidenceCount >= 3 ? '强' : evidenceCount >= 2 ? '中' : '弱';
}

/**
 * 处理分析结果，将新维度和更新写入地图
 */
function processAnalysisResult(map, result, speakerName, sourceName, date) {
  const updates = { newDims: [], updatedDims: [], removedDims: [], mergeSuggestions: [], radarAxesChanges: [] };
  const sourceDate = date || new Date().toISOString().split('T')[0];
  const sourceLabel = sourceName || '未命名录音';

  // 确保 speaker 存在
  let speaker = map.speakers.find(s => s.name === speakerName);
  if (!speaker) {
    speaker = { id: nextId('speaker'), name: speakerName };
    map.speakers.push(speaker);
  }

  if (result.owner && !map.owner) {
    map.owner = result.owner;
  }

  // 处理新维度
  if (result.newDimensions) {
    for (const newDim of result.newDimensions) {
      // 极性：默认 +1
      const polarity = newDim.evidence?.polarity === '-1' ? -1 : 1;

      // 雷同检测：检查是否与已有维度雷同（同名 或 description 高度相似）
      const similarDim = map.dimensions.find(d => {
        if (d.name === newDim.name) return true;
        if (d.description && newDim.description) {
          return d.description.includes(newDim.description) || newDim.description.includes(d.description);
        }
        return false;
      });

      if (similarDim) {
        // 雷同：追加证据到已有维度
        similarDim.evidence.push({
          source: newDim.evidence?.source || sourceLabel,
          speaker: newDim.evidence?.speaker || speakerName,
          quote: newDim.evidence?.quote || '',
          corrected: false,
          interpretation: newDim.evidence?.interpretation || '',
          date: sourceDate,
          polarity: polarity,
        });
        recalcDimension(similarDim);

        // 星级归零则移除
        if (similarDim.starCount === 0) {
          map.dimensions = map.dimensions.filter(d => d.id !== similarDim.id);
          updates.removedDims.push({ id: similarDim.id, name: similarDim.name });
          updates.updatedDims.push({ id: similarDim.id, name: similarDim.name, action: '星级归零，移除' });
        } else {
          updates.updatedDims.push({ id: similarDim.id, name: similarDim.name, action: '追加证据，星级' + similarDim.starCount });
        }
        continue;
      }

      // 确保分类存在（归一化到五大分类）
      const normalized = normalizeCategory(newDim.categoryName);
      let category = map.categories.find(c => c.name === normalized.name);
      if (!category) {
        category = { id: nextId('cat'), name: normalized.name, description: normalized.description, icon: normalized.icon };
        map.categories.push(category);
      }

      // 处理 relatedTo - 将名称转为 ID
      const relatedIds = [];
      if (newDim.relatedTo) {
        for (const ref of newDim.relatedTo) {
          const refDim = map.dimensions.find(d => d.id === ref || d.name === ref);
          if (refDim) relatedIds.push(refDim.id);
        }
      }

      const dimId = nextId('dim');
      const dim = {
        id: dimId,
        name: newDim.name,
        status: polarity > 0 ? 'possessed' : 'developing',
        category: category ? category.id : '',
        speakerId: speaker.id,
        description: newDim.description || '',
        evidence: [{
          source: newDim.evidence?.source || sourceLabel,
          speaker: newDim.evidence?.speaker || speakerName,
          quote: newDim.evidence?.quote || '',
          corrected: false,
          interpretation: newDim.evidence?.interpretation || '',
          date: sourceDate,
          polarity: polarity,
        }],
        relatedTo: relatedIds,
        confidence: newDim.confidence || '弱',
        starCount: polarity,
      };

      // 星级为零则不创建
      if (dim.starCount === 0) {
        updates.removedDims.push({ id: dimId, name: newDim.name, action: '星级归零，不创建' });
        continue;
      }

      map.dimensions.push(dim);
      updates.newDims.push({ id: dimId, name: dim.name, status: dim.status, starCount: dim.starCount });

      // 更新关联维度的 relatedTo
      for (const rid of relatedIds) {
        const refDim = map.dimensions.find(d => d.id === rid);
        if (refDim && !refDim.relatedTo.includes(dimId)) {
          refDim.relatedTo.push(dimId);
        }
      }
    }
  }

  // 处理已更新维度
  if (result.updatedDimensions) {
    for (const upd of result.updatedDimensions) {
      const dim = map.dimensions.find(d => d.id === upd.dimensionId);
      if (!dim) continue;

      if (upd.newEvidence) {
        const polarity = upd.newEvidence.polarity === '-1' ? -1 : 1;
        dim.evidence.push({
          source: upd.newEvidence.source || sourceLabel,
          speaker: upd.newEvidence.speaker || speakerName,
          quote: upd.newEvidence.quote,
          corrected: false,
          interpretation: upd.newEvidence.interpretation || '',
          date: sourceDate,
          polarity: polarity,
        });
        recalcDimension(dim);

        // 星级归零则移除
        if (dim.starCount === 0) {
          map.dimensions = map.dimensions.filter(d => d.id !== dim.id);
          updates.removedDims.push({ id: dim.id, name: dim.name });
          updates.updatedDims.push({ id: dim.id, name: dim.name, action: '星级归零，移除' });
        } else {
          updates.updatedDims.push({ id: dim.id, name: dim.name, action: '追加证据，星级' + dim.starCount });
        }
      } else {
        updates.updatedDims.push({ id: dim.id, name: dim.name, action: '更新' });
      }
    }
  }

  // 处理合并建议
  if (result.mergeSuggestions) {
    updates.mergeSuggestions = result.mergeSuggestions;
  }

  // 维护雷达轴
  maintainRadarAxes(map);

  // 记录 sourceLog
  const affectedDimIds = [
    ...updates.newDims.map(d => d.id),
    ...updates.updatedDims.map(d => d.id),
  ];

  map.sourceLog.push({
    date: sourceDate,
    source: sourceLabel,
    speaker: speakerName,
    dimensionsAffected: affectedDimIds,
    summary: result.summary || `本次分析新增${updates.newDims.length}个维度，更新${updates.updatedDims.length}个维度，移除${updates.removedDims.length}个维度`,
  });

  return updates;
}

/**
 * 维护雷达轴
 */
function maintainRadarAxes(map) {
  const coveredDimIds = new Set();
  for (const axis of map.radarAxes) {
    for (const id of (axis.dimIds || [])) {
      coveredDimIds.add(id);
    }
  }

  // 检查未覆盖的维度
  const uncovered = map.dimensions.filter(d => !coveredDimIds.has(d.id));
  if (uncovered.length === 0) return;

  // 如果有分类，按分类归入雷达轴
  for (const dim of uncovered) {
    let axis = null;
    if (dim.category) {
      axis = map.radarAxes.find(a =>
        a.dimIds && a.dimIds.some(id => {
          const d = map.dimensions.find(dd => dd.id === id);
          return d && d.category === dim.category;
        })
      );
    }
    if (axis) {
      if (!axis.dimIds) axis.dimIds = [];
      axis.dimIds.push(dim.id);
    } else if (map.radarAxes.length < 8) {
      // 创建新轴
      const cat = map.categories.find(c => c.id === dim.category);
      const newAxis = {
        id: nextId('axis'),
        name: cat ? cat.name : dim.name,
        dimIds: [dim.id],
        blindIds: [],
        description: dim.description,
      };
      map.radarAxes.push(newAxis);
    }
  }

  // 如果雷达轴超过8个，合并相近的
  if (map.radarAxes.length > 8) {
    // 简单策略：合并维度最少的轴到最相近的轴
    map.radarAxes.sort((a, b) => (b.dimIds?.length || 0) - (a.dimIds?.length || 0));
    while (map.radarAxes.length > 8) {
      const smallest = map.radarAxes.pop();
      const target = map.radarAxes[map.radarAxes.length - 1];
      target.dimIds = [...(target.dimIds || []), ...(smallest.dimIds || [])];
      target.blindIds = [...(target.blindIds || []), ...(smallest.blindIds || [])];
    }
  }

  // 更新盲区引用
  syncBlindSpotsToRadarAxes(map);
}

module.exports = router;
