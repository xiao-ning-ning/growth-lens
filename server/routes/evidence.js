const express = require('express');
const router = express.Router();
const { loadMap, saveMap } = require('../store');

/**
 * 重新计算维度的星级和状态
 */
function recalcDimension(dim) {
  dim.starCount = dim.evidence.reduce((sum, ev) => sum + (ev.polarity || 1), 0);
  if (dim.starCount > 0) {
    dim.status = 'possessed';
  } else if (dim.starCount < 0) {
    dim.status = 'developing';
  }
  const evidenceCount = dim.evidence.length;
  dim.confidence = evidenceCount >= 3 ? '强' : evidenceCount >= 2 ? '中' : '弱';
}

// POST /api/evidence/edit - 编辑证据引用文本
router.post('/edit', async (req, res) => {
  try {
    const { dimensionId, evidenceIndex, quote } = req.body;

    if (!dimensionId || evidenceIndex === undefined || !quote) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const map = loadMap(req.userId);
    const dim = map.dimensions.find(d => d.id === dimensionId);
    if (!dim) return res.status(404).json({ error: '维度不存在' });

    const idx = parseInt(evidenceIndex, 10);
    if (idx < 0 || idx >= dim.evidence.length) {
      return res.status(404).json({ error: '证据索引无效' });
    }

    const ev = dim.evidence[idx];

    // 保留原始引用（如果还没保留过）
    if (!ev.rawQuote) {
      ev.rawQuote = ev.quote;
    }

    ev.quote = quote;
    ev.corrected = true;

    // 重新计算星级和状态
    recalcDimension(dim);

    // 星级归零则移除该维度
    if (dim.starCount === 0) {
      map.dimensions = map.dimensions.filter(d => d.id !== dimensionId);
    }

    await saveMap(req.userId, map);
    res.json({ success: true });
  } catch (error) {
    console.error('编辑证据失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
