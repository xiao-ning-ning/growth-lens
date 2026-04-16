const express = require('express');
const router = express.Router();
const { callLLM, loadMap, saveMap } = require('../store');

// POST /api/correct - 纠错引用
router.post('/', async (req, res) => {
  try {
    const map = loadMap(req.userId);

    // 收集所有未纠错的证据
    const uncorrected = [];
    for (const dim of map.dimensions) {
      for (const ev of dim.evidence) {
        if (ev.corrected !== true) {
          uncorrected.push({
            dimensionId: dim.id,
            dimensionName: dim.name,
            quote: ev.quote,
            interpretation: ev.interpretation,
            source: ev.source,
          });
        }
      }
    }

    if (uncorrected.length === 0) {
      return res.json({ success: true, message: '没有需要纠错的引用', corrections: [] });
    }

    const systemPrompt = `你是录音转写文本纠错专家。录音转写常有同音字、漏字、乱断句等问题。

## 纠错原则

1. **宁可漏纠不可错纠**: 不确定的不改，标注"存疑"
2. **只改转写错误，不改口语化表达**: 口癖、重复、停顿词保留原样
3. **语义优先**: 如果整句话语义明确，个别字的转写错误优先修正
4. **专业术语优先**: 行业术语、人名、技术名词的转写错误必须修正

## 输出格式

返回 JSON：
{
  "corrections": [
    {
      "index": 0,
      "original": "原文",
      "corrected": "修正后文本",
      "changes": ["修改点1", "修改点2"],
      "uncertain": false
    }
  ]
}`;

    const userPrompt = `请对以下 ${uncorrected.length} 条引用进行纠错：

${uncorrected.map((item, i) => `
[${i}] 维度: ${item.dimensionName}
来源: ${item.source}
原文: ${item.quote}
解读: ${item.interpretation}
`).join('\n')}`;

    const result = await callLLM(systemPrompt, userPrompt);

    // 应用纠错
    const corrections = [];
    for (const correction of (result.corrections || [])) {
      const idx = correction.index;
      if (idx < 0 || idx >= uncorrected.length) continue;

      const item = uncorrected[idx];
      const dim = map.dimensions.find(d => d.id === item.dimensionId);
      if (!dim) continue;

      const ev = dim.evidence.find(e =>
        e.quote === item.quote && e.corrected !== true
      ) || dim.evidence.find(e =>
        e.quote.includes(item.quote.substring(0, 20)) && e.corrected !== true
      );
      if (!ev) continue;

      // 保留原始，更新为修正后
      ev.rawQuote = ev.quote;
      ev.quote = correction.corrected;
      ev.corrected = true;

      corrections.push({
        dimensionName: dim.name,
        original: item.quote,
        corrected: correction.corrected,
        changes: correction.changes,
        uncertain: correction.uncertain,
      });
    }

    await saveMap(req.userId, map);

    res.json({
      success: true,
      corrections,
      totalUncorrected: uncorrected.length,
      totalCorrected: corrections.length,
    });

  } catch (error) {
    console.error('纠错失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/correct/revert - 恢复某条纠错
router.post('/revert', async (req, res) => {
  try {
    const { dimensionId, quote, evidenceIndex } = req.body;
    const map = loadMap(req.userId);

    const dim = map.dimensions.find(d => d.id === dimensionId);
    if (!dim) return res.status(404).json({ error: '维度不存在' });

    // Try evidenceIndex first (more reliable), fall back to quote match
    let ev = null;
    if (evidenceIndex !== undefined && evidenceIndex >= 0 && evidenceIndex < dim.evidence.length) {
      const candidate = dim.evidence[evidenceIndex];
      if (candidate.corrected === true) ev = candidate;
    }
    if (!ev) {
      ev = dim.evidence.find(e => e.quote === quote && e.corrected === true);
    }
    if (!ev) return res.status(404).json({ error: '证据不存在或未纠错' });

    if (ev.rawQuote) {
      ev.quote = ev.rawQuote;
      delete ev.rawQuote;
    }
    ev.corrected = false;

    await saveMap(req.userId, map);
    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
