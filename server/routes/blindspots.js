const express = require('express');
const router = express.Router();
const { callLLM, loadMap, saveMap, nextId, syncBlindSpotsToRadarAxes } = require('../store');

// POST /api/blindspots - 生成/刷新盲区探测
router.post('/', async (req, res) => {
  try {
    const map = loadMap(req.userId);
    if (map.dimensions.length < 2) {
      return res.status(400).json({ error: '至少需要2个维度才能进行盲区探测' });
    }

    const dimsInfo = map.dimensions.map(d => ({
      id: d.id, name: d.name, status: d.status,
      description: d.description, category: d.category,
      evidenceSources: d.evidence.map(e => e.source),
      evidenceScenes: d.evidence.map(e => `${e.source}: ${e.interpretation?.substring(0, 60)}`),
    }));

    const existingBlinds = map.blindSpots.map(b => ({
      id: b.id, name: b.name, confidence: b.confidence,
    }));

    const systemPrompt = `你是能力盲区探测专家。分析已有维度的触发模式，识别"应该出现但没出现"的能力感知。

## 盲区探测原则

1. 盲区不是"你不行"，而是"你可能没意识到这个维度存在"
2. 必须有正面证据支撑：某个场景下，以已有能力水平"应该"会触发的感知却没有触发
3. confidence 要诚实：基于一个场景=弱，基于多个场景=中，跨场景且有正面支撑=强
4. 盲区探测不预设框架，是从已有维度的触发模式中推理出来的

## 探测维度

1. **跨维度对比**: 同一场景中，某些维度被触发了，但"应该"一起被触发的维度却没有出现
2. **场景覆盖分析**: 某个维度只在特定场景出现，可能意味着在其他场景中存在感知盲区
3. **关联维度断裂**: 如果维度 A 和 B 高度关联，但 A 频繁出现而 B 从未出现，B 可能是盲区

## 输出格式

返回 JSON：
{
  "blindSpots": [
    {
      "name": "主动感知团队情绪与心理状态",
      "description": "在推动变革或管理团队时，主动评估和应对员工心理状态变化的能力。补足后能提前识别团队情绪波动，在问题爆发前主动介入，增强团队的归属感和信任积累。",
      "relatedDimensionIds": ["dim_xxx"],
      "evidence": [
        {
          "context": "在什么场景下，这个盲区应该被触发但没有",
          "gap": "具体的能力缺口描述"
        }
      ],
      "confidence": "强|中|弱"
    }
  ]
}

说明：
- name 是能力陈述（能做什么）
- description 是能力的精确定义 + 补足后会带来的具体优势
- 不要用"应该出现但没出现的能力感知"这种描述性语言作为 description`;

    const userPrompt = `## 所有维度（共 ${dimsInfo.length} 个）

${dimsInfo.map(d => `- [${d.id}] ${d.name} (${d.status}):
  描述: ${d.description}
  出现场景: ${d.evidenceSources.join(', ')}
  ${d.evidenceScenes.length > 0 ? '行为证据: ' + d.evidenceScenes.join('; ') : ''}`).join('\n\n')}

## 已有盲区（共 ${existingBlinds.length} 个）
${existingBlinds.length > 0 ? existingBlinds.map(b => `- [${b.id}] ${b.name} (置信度: ${b.confidence})`).join('\n') : '（暂无）'}

请分析已有维度的触发模式，识别盲区。已有盲区如果有新证据则更新，新发现的盲区则新增。`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 先清空所有旧盲区，再生成新数据
    map.blindSpots = [];
    const validDimIds = new Set(map.dimensions.map(d => d.id));
    const updates = [];
    for (const blind of (result.blindSpots || [])) {
      // 校验 LLM 返回的维度 ID，过滤掉不存在的
      const validRelatedDims = (blind.relatedDimensionIds || []).filter(id => validDimIds.has(id));
      if (validRelatedDims.length === 0) continue; // 盲区至少需要关联1个有效维度
      const id = nextId('blind');
      map.blindSpots.push({
        id,
        name: blind.name,
        description: blind.description,
        relatedDimensions: validRelatedDims,
        evidence: blind.evidence,
        confidence: blind.confidence,
      });
      updates.push({ id, name: blind.name, action: '新增' });
    }

    // 更新 radarAxes 的 blindIds
    syncBlindSpotsToRadarAxes(map);

    await saveMap(req.userId, map);
    res.json({ success: true, map, blindSpots: updates });

  } catch (error) {
    console.error('盲区探测失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/blindspots/delete - 删除盲区
router.post('/delete', async (req, res) => {
  try {
    const { blindIds } = req.body;
    if (!blindIds || blindIds.length === 0) {
      return res.status(400).json({ error: '请指定要删除的盲区 ID' });
    }

    const map = loadMap(req.userId);
    map.blindSpots = map.blindSpots.filter(b => !blindIds.includes(b.id));
    // 同步删除对应的修炼路径
    map.developmentPaths = map.developmentPaths.filter(p => !blindIds.includes(p.targetDimension));
    syncBlindSpotsToRadarAxes(map);
    await saveMap(req.userId, map);
    res.json({ success: true, map });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
