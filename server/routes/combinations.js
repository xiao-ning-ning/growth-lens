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

    const dimsInfo = map.dimensions
      .map(d => ({
        id: d.id, name: d.name, status: d.status,
        description: d.description, evidenceCount: d.evidence.length,
        relatedTo: d.relatedTo,
      }));

    // 动态阈值：60% 分位数，证据数分布越高阈值越高
    const evidenceCounts = map.dimensions.map(d => d.evidence.length).sort((a, b) => a - b);
    const thresholdIndex = Math.max(0, Math.floor(evidenceCounts.length * 0.6) - 1);
    const evidenceThreshold = evidenceCounts[thresholdIndex];

    const dimMap = Object.fromEntries(dimsInfo.map(d => [d.id, d]));

    // 筛选证据数达到动态阈值的维度
    const eligibleDims = dimsInfo.filter(d => d.evidenceCount >= evidenceThreshold);

    if (eligibleDims.length < 2) {
      return res.json({ success: true, message: '达到组合门槛的维度不足（需要至少2个），请先增加更多录音分析以丰富证据', combinations: [] });
    }

    const existingCombos = map.combinations.map(c => ({
      id: c.id, name: c.name, dimensions: c.dimensions,
    }));

    const systemPrompt = `你是能力组合分析专家。分析多个能力维度之间的协同关系，识别"1+1>2"的化学反应。

## 组合识别原则

1. **有深度才有组合**：只有证据数达到 ${evidenceThreshold} 条以上的维度才算"成熟"，才具备形成组合的资格。证据不足的维度不考虑。
2. **组合要有名字**：如"手术刀式管理""温度护城河"——命名本身就是洞察，没想好名字的组合说明还不够精准。
3. **不追求数量**：只输出真正有化学反应的组合，宁少勿多。

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

    const userPrompt = `## 具备资格的维度（共 ${eligibleDims.length} 个，门槛：≥${evidenceThreshold}条证据）

${eligibleDims.map(d => `- [${d.id}] ${d.name} (${d.status}, ${d.evidenceCount}条证据): ${d.description}`).join('\n')}

${dimsInfo.some(d => d.relatedTo && d.relatedTo.length > 0) ? `
### 维度关联关系
${dimsInfo.filter(d => d.relatedTo && d.relatedTo.length > 0).map(d =>
  `- ${d.name} → ${d.relatedTo.map(id => dimsInfo.find(dd => dd.id === id)?.name || id).join(', ')}`
).join('\n')}
` : ''}

## 已有组合（共 ${existingCombos.length} 个）
${existingCombos.length > 0 ? existingCombos.map(c => `- [${c.id}] ${c.name}: ${c.dimensions.join(', ')}`).join('\n') : '（暂无）'}

请分析最有价值的组合，已有组合若仍成立则保留。`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 更新地图中的组合
    const validDimIds = new Set(eligibleDims.map(d => d.id));

    // 过滤并附加证据数
    let parsedCombos = (result.combinations || [])
      .map(combo => {
        const validDims = (combo.dimensionIds || []).filter(id => validDimIds.has(id));
        if (validDims.length < 2) return null;
        const totalEvidence = validDims.reduce((sum, id) => sum + (dimMap[id]?.evidenceCount || 0), 0);
        return { ...combo, _dims: validDims, _totalEvidence: totalEvidence };
      })
      .filter(Boolean);

    // 贪心不重叠选择：按总证据数降序，依次选不重叠的组合
    const usedDims = new Set();
    const selectedCombos = [];
    parsedCombos
      .sort((a, b) => b._totalEvidence - a._totalEvidence)
      .forEach(combo => {
        const dims = combo._dims.filter(id => !usedDims.has(id));
        if (dims.length >= 2) {
          selectedCombos.push({ ...combo, _dims: dims });
          dims.forEach(id => usedDims.add(id));
        }
      });

    // 清空旧组合，全部重新写入
    map.combinations = selectedCombos.map(combo => ({
      id: nextId('combo'),
      name: combo.name,
      dimensions: combo._dims,
      description: combo.description,
      scenarios: combo.scenarios,
      whyPowerful: combo.whyPowerful,
    }));

    await saveMap(req.userId, map);
    res.json({ success: true, map, combinations: map.combinations.map(c => ({ id: c.id, name: c.name, action: '新增' })) });

  } catch (error) {
    console.error('组合分析失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
