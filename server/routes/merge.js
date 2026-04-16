const express = require('express');
const router = express.Router();
const { loadMap, saveMap } = require('../store');

// POST /api/merge - 合并维度
router.post('/', async (req, res) => {
  try {
    const { dimensionIds, newName, newDescription } = req.body;
    if (!dimensionIds || dimensionIds.length < 2) {
      return res.status(400).json({ error: '至少需要2个维度才能合并' });
    }

    const map = loadMap(req.userId);
    const dimsToMerge = dimensionIds.map(id => map.dimensions.find(d => d.id === id)).filter(Boolean);

    if (dimsToMerge.length < 2) {
      return res.status(400).json({ error: '找到的维度不足2个' });
    }

    // 创建合并后的维度
    const mergedDim = {
      id: dimsToMerge[0].id, // 保留第一个的 ID
      name: newName || dimsToMerge.sort((a, b) => b.evidence.length - a.evidence.length)[0].name,
      status: dimsToMerge.some(d => d.status === 'developing')
        ? (dimsToMerge.reduce((sum, d) => sum + d.evidence.length, 0) >= 3 ? 'possessed' : 'developing')
        : 'possessed',
      category: dimsToMerge[0].category,
      speakerId: dimsToMerge[0].speakerId,
      description: newDescription || dimsToMerge.sort((a, b) => b.evidence.length - a.evidence.length)[0].description,
      evidence: dimsToMerge.flatMap(d => d.evidence),
      relatedTo: [...new Set(dimsToMerge.flatMap(d => d.relatedTo).filter(id => !dimensionIds.includes(id)))],
      confidence: dimsToMerge.sort((a, b) => {
        const order = { '强': 3, '中': 2, '弱': 1 };
        return (order[b.confidence] || 0) - (order[a.confidence] || 0);
      })[0].confidence,
    };

    // 移除被合并的维度（保留第一个作为合并结果）
    const removeIds = dimensionIds.slice(1);
    map.dimensions = map.dimensions.filter(d => !removeIds.includes(d.id));

    // 替换第一个维度为合并结果
    const idx = map.dimensions.findIndex(d => d.id === mergedDim.id);
    if (idx >= 0) map.dimensions[idx] = mergedDim;

    // 清理其他引用
    for (const dim of map.dimensions) {
      dim.relatedTo = dim.relatedTo
        .map(id => removeIds.includes(id) ? mergedDim.id : id)
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    // 清理 combinations
    for (const combo of map.combinations) {
      combo.dimensions = combo.dimensions
        .map(id => removeIds.includes(id) ? mergedDim.id : id)
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    // 清理 blindSpots
    for (const blind of map.blindSpots) {
      blind.relatedDimensions = blind.relatedDimensions
        .map(id => removeIds.includes(id) ? mergedDim.id : id)
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    // 清理 developmentPaths
    for (const devPath of map.developmentPaths) {
      devPath.leveragedFrom = devPath.leveragedFrom
        .map(id => removeIds.includes(id) ? mergedDim.id : id)
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    // 清理 sourceLog
    for (const log of map.sourceLog) {
      log.dimensionsAffected = log.dimensionsAffected
        .map(id => removeIds.includes(id) ? mergedDim.id : id)
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    // 清理 radarAxes
    for (const axis of map.radarAxes) {
      axis.dimIds = axis.dimIds
        .map(id => removeIds.includes(id) ? mergedDim.id : id)
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    await saveMap(req.userId, map);
    res.json({ success: true, map, mergedDimension: mergedDim });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
