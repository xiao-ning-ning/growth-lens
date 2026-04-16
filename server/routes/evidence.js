const express = require('express');
const router = express.Router();
const { loadMap, saveMap } = require('../store');

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

    await saveMap(req.userId, map);
    res.json({ success: true });
  } catch (error) {
    console.error('编辑证据失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
