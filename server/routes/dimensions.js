const express = require('express');
const router = express.Router();
const { loadMap, saveMap } = require('../store');

// DELETE /api/dimensions - 删除维度（使用 POST 以兼容更多客户端）
router.post('/delete', async (req, res) => {
  try {
    const { dimensionIds } = req.body;
    if (!dimensionIds || dimensionIds.length === 0) {
      return res.status(400).json({ error: '请指定要删除的维度 ID' });
    }

    const map = loadMap(req.userId);
    const deleted = [];

    for (const dimId of dimensionIds) {
      const dim = map.dimensions.find(d => d.id === dimId);
      if (dim) deleted.push({ id: dim.id, name: dim.name });
    }

    // 移除维度
    map.dimensions = map.dimensions.filter(d => !dimensionIds.includes(d.id));

    // 清理其他维度 relatedTo 中的引用
    for (const dim of map.dimensions) {
      dim.relatedTo = dim.relatedTo.filter(id => !dimensionIds.includes(id));
    }

    // 清理 sourceLog
    for (const log of map.sourceLog) {
      log.dimensionsAffected = log.dimensionsAffected.filter(id => !dimensionIds.includes(id));
    }

    // 清理 combinations - 如果组合只剩一个维度则删除
    map.combinations = map.combinations.filter(combo => {
      combo.dimensions = combo.dimensions.filter(id => !dimensionIds.includes(id));
      return combo.dimensions.length > 1;
    });

    // 清理 blindSpots
    for (const blind of map.blindSpots) {
      blind.relatedDimensions = blind.relatedDimensions.filter(id => !dimensionIds.includes(id));
    }

    // 清理 developmentPaths - 如果目标是删除的维度则删除路径
    map.developmentPaths = map.developmentPaths.filter(path => {
      if (dimensionIds.includes(path.targetDimension)) return false;
      path.leveragedFrom = path.leveragedFrom.filter(id => !dimensionIds.includes(id));
      return true;
    });

    // 清理 radarAxes
    for (const axis of map.radarAxes) {
      axis.dimIds = (axis.dimIds || []).filter(id => !dimensionIds.includes(id));
    }
    // Delete axes that became empty
    map.radarAxes = map.radarAxes.filter(axis => (axis.dimIds || []).length > 0);

    await saveMap(req.userId, map);
    res.json({ success: true, map, deleted });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/dimensions/:id - 更新单个维度
router.put('/:id', async (req, res) => {
  try {
    const map = loadMap(req.userId);
    const dim = map.dimensions.find(d => d.id === req.params.id);
    if (!dim) return res.status(404).json({ error: '维度不存在' });

    const { name, status, description, category, confidence, relatedTo } = req.body;
    if (name !== undefined) dim.name = name;
    if (status !== undefined) dim.status = status;
    if (description !== undefined) dim.description = description;
    if (category !== undefined) dim.category = category;
    if (confidence !== undefined) dim.confidence = confidence;
    if (relatedTo !== undefined) dim.relatedTo = relatedTo;

    await saveMap(req.userId, map);
    res.json({ success: true, dimension: dim });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
