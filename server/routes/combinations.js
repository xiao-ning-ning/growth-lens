const express = require('express');
const router = express.Router();
const { callLLM, loadMap, saveMap, nextId } = require('../store');

// POST /api/combinations - 生成/刷新组合分析
router.post('/', async (req, res) => {
  try {
    const map = loadMap(req.userId);
    if (map.dimensions.length < 2) {
      return res.status(400).json({ error: '至少需要2个维度才能生成组合' });
    }

    const dimsInfo = map.dimensions.map(d => ({
      id: d.id, name: d.name, status: d.status,
      description: d.description, evidenceCount: d.evidence.length,
      relatedTo: d.relatedTo,
    }));

    const existingCombos = map.combinations.map(c => ({
      id: c.id, name: c.name, dimensions: c.dimensions,
    }));

    const systemPrompt = `你是能力组合分析专家。分析多个能力维度之间的协同关系，识别"1+1>2"的化学反应。

## 组合识别原则

1. 一个维度能补足另一个维度的短板
2. 多个维度共同作用于同一类场景
3. 一个维度的输出是另一个维度的输入
4. 组合名称要精准有力，如"手术刀式管理""温度护城河"——命名本身就是洞察

## 输出格式

返回 JSON：
{
  "combinations": [
    {
      "name": "组合名称",
      "dimensionIds": ["dim_xxx", "dim_yyy"],
      "description": "维度之间如何产生化学反应，1+1>2的原因",
      "scenarios": ["适用场景1", "适用场景2"],
      "whyPowerful": "为什么这个组合比单独使用每个维度更有价值"
    }
  ]
}`;

    const userPrompt = `## 所有维度（共 ${dimsInfo.length} 个）

${dimsInfo.map(d => `- [${d.id}] ${d.name} (${d.status}, ${d.evidenceCount}条证据): ${d.description}`).join('\n')}

${dimsInfo.some(d => d.relatedTo && d.relatedTo.length > 0) ? `
### 维度关联关系
${dimsInfo.filter(d => d.relatedTo && d.relatedTo.length > 0).map(d =>
  `- ${d.name} → ${d.relatedTo.map(id => dimsInfo.find(dd => dd.id === id)?.name || id).join(', ')}`
).join('\n')}
` : ''}

## 已有组合（共 ${existingCombos.length} 个）
${existingCombos.length > 0 ? existingCombos.map(c => `- [${c.id}] ${c.name}: ${c.dimensions.join(', ')}`).join('\n') : '（暂无）'}

请分析所有维度之间的协同关系，生成组合。已有的组合如果仍然成立则保留（用相同 name），新的协同关系则新增。`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 更新地图中的组合
    const validDimIds = new Set(map.dimensions.map(d => d.id));
    const newCombos = [];
    for (const combo of (result.combinations || [])) {
      // 校验 LLM 返回的维度 ID，过滤掉不存在的
      const validDims = (combo.dimensionIds || []).filter(id => validDimIds.has(id));
      if (validDims.length < 2) continue; // 组合至少需要2个有效维度

      const existing = map.combinations.find(c => c.name === combo.name);
      if (existing) {
        // 更新已有组合
        existing.dimensions = validDims;
        existing.description = combo.description;
        existing.scenarios = combo.scenarios;
        existing.whyPowerful = combo.whyPowerful;
        newCombos.push({ id: existing.id, name: existing.name, action: '更新' });
      } else {
        // 新增组合
        const id = nextId('combo');
        map.combinations.push({
          id,
          name: combo.name,
          dimensions: validDims,
          description: combo.description,
          scenarios: combo.scenarios,
          whyPowerful: combo.whyPowerful,
        });
        newCombos.push({ id, name: combo.name, action: '新增' });
      }
    }

    await saveMap(req.userId, map);
    res.json({ success: true, map, combinations: newCombos });

  } catch (error) {
    console.error('组合分析失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
