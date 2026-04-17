const express = require('express');
const multer = require('multer');
const router = express.Router();
const { callLLM, loadMap, saveMap, nextId, syncBlindSpotsToRadarAxes } = require('../store');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

  // 获取用户显示名（基本信息中设置的姓名，而非录音说话人）
  const profile = map.profile || {};
  const displayName = profile.name || userId;

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
    const existingDimsSummary = map.dimensions.map(d => ({
      id: d.id, name: d.name, status: d.status, category: d.category,
      evidenceCount: d.evidence.length, description: d.description,
    }));

    const systemPrompt = `你是"成长力场"的分析引擎，专门从录音转写文本中提取人的行为特征和能力维度。

核心信念：人对自己能力的认知往往存在盲区——有些能力每天都在用，但从未命名和显性化。

## 分析原则

1. **证据驱动，不预设维度**: 维度是从行为中长出来的，不是预设的框架
2. **已具备和待发展都要有证据**: 待发展不是主观评价，而是从行为中观察到的信号
3. **原文引用必须有**: 每条证据必须附原文引用
4. **解读要有判断力**: 不是简单复述原话，而是点出原话背后展现的能力或能力缺口
5. **confidence 要诚实**: 单次证据="弱"，两次以上="中"，三次以上且跨场景="强"
6. **维度命名要精准**: 用"战略拆解力"而非"规划能力"，用"温和的残酷"而非"决策力"
7. **待发展不是否定**: 待发展维度是用来看见潜力和缺口

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
      "status": "possessed|developing",
      "categoryName": "分类名称",
      "categoryIcon": "emoji图标",
      "description": "一句话定义该维度的核心内涵",
      "evidence": {
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
        "source": "来源名称",
        "speaker": "说话人",
        "quote": "原文引用",
        "interpretation": "AI对这段行为的解读"
      },
      "confidenceChange": "强|中|弱|不变",
      "statusChange": "possessed|developing|不变"
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

请深度分析上述文本中"${speakerName}"的行为模式，提取能力维度。`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 处理分析结果，更新地图
    const updates = processAnalysisResult(map, result, speakerName, sourceName, date);

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
 * 处理分析结果，将新维度和更新写入地图
 */
function processAnalysisResult(map, result, speakerName, sourceName, date) {
  const updates = { newDims: [], updatedDims: [], mergeSuggestions: [], radarAxesChanges: [] };
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
      // 检查是否真的不存在同名维度
      const existing = map.dimensions.find(d => d.name === newDim.name);
      if (existing) {
        // 追加证据到已有维度
        const ev = newDim.evidence;
        existing.evidence.push({
          source: ev.source || sourceLabel,
          speaker: ev.speaker || speakerName,
          quote: ev.quote,
          corrected: false,
          interpretation: ev.interpretation,
          date: sourceDate,
        });
        if (newDim.confidence && newDim.confidence !== '不变') {
          existing.confidence = newDim.confidence;
        }
        updates.updatedDims.push({ id: existing.id, name: existing.name, action: '追加证据(匹配到同名)' });
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
        status: newDim.status || 'possessed',
        category: category ? category.id : '',
        speakerId: speaker.id,
        description: newDim.description,
    evidence: [{
      source: newDim.evidence.source || sourceLabel,
      speaker: newDim.evidence.speaker || speakerName,
      quote: newDim.evidence.quote,
      corrected: false,
      interpretation: newDim.evidence.interpretation,
      date: sourceDate,
    }],
        relatedTo: relatedIds,
        confidence: newDim.confidence || '弱',
      };

      map.dimensions.push(dim);
      updates.newDims.push({ id: dimId, name: dim.name, status: dim.status });

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
        dim.evidence.push({
          source: upd.newEvidence.source || sourceLabel,
          speaker: upd.newEvidence.speaker || speakerName,
          quote: upd.newEvidence.quote,
          corrected: false,
          interpretation: upd.newEvidence.interpretation,
          date: sourceDate,
        });
      }

      if (upd.confidenceChange && upd.confidenceChange !== '不变') {
        dim.confidence = upd.confidenceChange;
      }

      if (upd.statusChange && upd.statusChange !== '不变') {
        dim.status = upd.statusChange;
      }

      updates.updatedDims.push({ id: dim.id, name: dim.name, action: '更新' });
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
    summary: result.summary || `本次分析新增${updates.newDims.length}个维度，更新${updates.updatedDims.length}个维度`,
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
