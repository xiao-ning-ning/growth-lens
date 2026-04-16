const express = require('express');
const router = express.Router();
const { callLLM, loadMap, saveMap, nextId } = require('../store');

// POST /api/paths - 生成/刷新修炼路径
router.post('/', async (req, res) => {
  try {
    const map = loadMap(req.userId);

    const developingDims = map.dimensions.filter(d => d.status === 'developing');
    const blindSpots = map.blindSpots;
    const possessedDims = map.dimensions.filter(d => d.status === 'possessed');

    if (developingDims.length === 0 && blindSpots.length === 0) {
      return res.json({ success: true, message: '没有待发展维度或盲区，无需生成修炼路径', paths: [] });
    }

    const targets = [
      ...developingDims.map(d => ({
        type: 'developing',
        id: d.id,
        name: d.name,
        description: d.description,
        relatedTo: d.relatedTo,
      })),
      ...blindSpots.map(b => ({
        type: 'blindSpot',
        id: b.id,
        name: b.name,
        description: b.description,
        relatedDimensions: b.relatedDimensions,
      })),
    ];

    // 精简数据量：描述截断到 100 字，减少 token 加快响应
    const levers = possessedDims.map(d => ({
      id: d.id, name: d.name,
      description: d.description,
    }));

    const systemPrompt = `你是能力发展教练。为待发展的能力和感知盲区设计可落地的修炼路径。

## 修炼路径设计原则

1. 每个待发展维度/盲区，找出"已具备"维度中能帮助修炼的能力
2. 每个修炼路径包含 2-3 个具体步骤
3. 每个步骤必须明确"做什么"和"怎么做"
4. 每个步骤必须标注利用哪个已具备维度，说明为什么这个已有能力能帮上忙
5. 步骤设计原则：最小改变最大效果——在已有习惯上加一个动作，而非从零建立新习惯

## 输出格式

返回 JSON：
{
  "paths": [
    {
      "targetId": "dim_xxx 或 blind_xxx",
      "targetName": "待发展维度/盲区名称",
      "targetType": "developing|blindSpot",
      "leveragedFrom": ["dim_yyy"],
      "currentGap": "当前缺口的精确描述",
      "steps": [
        {
          "action": "具体行动",
          "detail": "行动的详细说明和操作方式",
          "leverage": "dim_yyy 如何利用已有能力来执行这个行动"
        }
      ],
      "expectedOutcome": "修炼后的预期变化"
    }
  ]
}`;

    const userPrompt = `## 待发展维度（${developingDims.length} 个）

${developingDims.map(d => `- [${d.id}] ${d.name}: ${d.description}
  关联维度: ${d.relatedTo.join(', ') || '无'}`).join('\n\n')}

## 盲区（${blindSpots.length} 个）

${blindSpots.map(b => `- [${b.id}] ${b.name}: ${b.description}
  关联维度: ${b.relatedDimensions.join(', ') || '无'}
  证据: ${b.evidence.map(e => e.gap).join('; ')}`).join('\n\n')}

## 可用杠杆 - 已具备维度（${levers.length} 个）

${levers.map(d => `- [${d.id}] ${d.name}: ${d.description}`).join('\n')}

请为每个待发展维度和盲区设计修炼路径。`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 更新修炼路径
    const validDimIds = new Set(map.dimensions.map(d => d.id));
    const validBlindIds = new Set(map.blindSpots.map(b => b.id));
    const updates = [];
    for (const path of (result.paths || [])) {
      // 校验 targetId 存在
      if (path.targetType === 'developing' && !validDimIds.has(path.targetId)) continue;
      if (path.targetType === 'blindSpot' && !validBlindIds.has(path.targetId)) continue;
      // 校验 leveragedFrom 中的 ID
      const validLevers = (path.leveragedFrom || []).filter(id => validDimIds.has(id));

      const existing = map.developmentPaths.find(p => p.targetDimension === path.targetId);
      const pathData = {
        targetDimension: path.targetId,
        targetName: path.targetName,
        leveragedFrom: validLevers,
        currentGap: path.currentGap,
        steps: path.steps,
        expectedOutcome: path.expectedOutcome,
      };

      if (existing) {
        Object.assign(existing, pathData);
        updates.push({ id: existing.id, name: existing.targetName, action: '更新' });
      } else {
        const id = nextId('devpath');
        map.developmentPaths.push({ id, ...pathData });
        updates.push({ id, name: path.targetName, action: '新增' });
      }
    }

    await saveMap(req.userId, map);
    res.json({ success: true, map, paths: updates });

  } catch (error) {
    console.error('修炼路径生成失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
