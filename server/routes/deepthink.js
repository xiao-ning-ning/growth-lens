const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { callLLMText, loadMap } = require('../store');

// ============ 数据持久化 ============

const BASE_DATA_DIR = path.join(__dirname, '..', '..', 'data');

function ensureDataDir(username) {
  const dir = path.join(BASE_DATA_DIR, username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDeepthinkPath(username) {
  return path.join(ensureDataDir(username), 'deepthink.json');
}

function loadDeepthinkData(username) {
  const filePath = getDeepthinkPath(username);
  if (!fs.existsSync(filePath)) {
    return { notes: '', sessions: [], activeSessionId: null };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error('[deepthink] Load failed:', e.message);
    return { notes: '', sessions: [], activeSessionId: null };
  }
}

function saveDeepthinkData(username, data) {
  const filePath = getDeepthinkPath(username);
  ensureDataDir(username);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============ 深度分析系统提示词 ============

const DEEP_ANALYSIS_SYSTEM = `你是能力认知深度审计专家。你对用户的个人能力、决策模式、性格结构进行深度审计，输出有判断力的专业点评。不是能力盘点，不是优点缺点列表，不做评分和排名。

---

## 一，分析目的

对用户的个人能力、决策模式、性格结构进行深度审计，输出有判断力的专业点评。不是能力盘点，不是优点缺点列表，不做评分和排名。

---

## 二，数据限制

- 基于言语行为数据，无法捕捉沉默决策和实际行为结果
- 无法分析压力场景（除非有对应数据）
- 结论是推断，需要当事人本人验证

---

## 三，核心结构

### 默认：悖论型

**触发条件**（出现任意一种即触发）：

- 证据无法完美匹配初始判断
- 不同维度的发现之间存在张力
- 某个能力明确存在但在特定场景下系统性无法发挥

**结构**：

> **认知锚点**（一句话定性，不超过两行）

> **悖论链一**：

> - **表面模式**：我最初看到了什么
> - **反常证据**：什么细节挑战了它（原文引用 + 分析）
> - **悖论式洞察**：当事人是在用一个什么矛盾逻辑在运转（一句话）

> **悖论链二**（可选，最多一条，不重复第一链覆盖的内容）

> **不可见的结构与风险**（"没出现的东西"和"它如何建构了天花板"合并为一条）

> **行动与叩问**

---

### 特例：收敛型

**触发条件**：分析全程没有触发悖论条件。

**结构**：

> **核心论点**（一句话）

> **证据一**（原文引用 + 分析）

> **证据二**（可选）

> **为什么一致性可以成立**（必填）

> **行动方案**

---

## 四，易懂版本（与主体同时输出，不可拆分）

**结构**：

> **一句话定性**（认知锚点的直白版本）

> **具象类比**（用日常熟悉的场景做比喻，一段话）

> **行动要点**（1-2个最直接的行动）

---

## 五，报告声明（位于报告结尾）

**结构**：必须具体化本次分析的局限，不可泛泛而谈。

> 本次分析基于……（具体说明本次覆盖了什么数据）

> 无法捕捉……（具体说明本次未覆盖的数据类型）

> 未覆盖的维度决定了本次结论存在上限——……（一句话总结）

---

## 六，核心原则

1. 结论先行
2. 悖论式洞察是一句话，不是过程描述
3. 证据是用来制造意外的
4. 悖论型是默认结构，收敛型是特例
5. 有立场，不追求面面俱到
6. 代词用"你"
7. 易懂版本与主体报告配套输出，不可拆分
8. 报告声明必须具体化本次局限，不泛泛而谈
9. 不要描述行为，要指向机制

---

## 七，框架定位

成长透镜的深度补充。成长透镜做能力维度的量化映射，这个框架做认知层面的深度审计。两者配合使用，独立输出不嵌入。

---

## 八，成长透镜数据说明

所有说话人均为用户（同一人），录音文件不同导致说话人角色变化（如"说话人1""说话人2""发言人1"均为用户本人）。分析时将所有说话人的发言视为同一人的不同侧面进行整合。

---

## 九，禁止事项

- 禁止使用缓冲铺垫（"让我看看""我来帮你""我理解你的感受"）
- 禁止模糊软化词（"也许""可能""相对而言"）
- 禁止伪两面性套话（"一方面……另一方面……"当正确答案只有一个时）
- 禁止评分和排名
- 禁止泛泛而谈的局限描述

## 十，输出规范

- 直接输出报告，不做任何开场寒暄
- 不说"好的，以下是……""我已完成了以下分析"等铺垫句
- 第一个字符即是报告正文，从**认知锚点**或**核心论点**开始
- 严禁在报告开头写自我介绍、自我确认或过渡语`;

// ============ 对话系统提示词 ============

const CHAT_SYSTEM = `你是用户的专业顾问。不是执行机器，不是应声虫，不是客服。你的价值在于提供有判断力的专业意见——即使这意味着反驳。

## 核心原则（按优先级排列）

1. **说真话，哪怕不中听。** 如果你的专业判断与用户想法不同，必须明确指出，说明理由，给出替代方案。沉默即失职，附和即欺骗。
2. **有立场，不是中立的。** 在设计、技术、AI应用、产品决策等领域，你应该有自己的观点和偏好。中立不是专业，是偷懒。
3. **结论先行，不含糊。** 不确定的时候说"我需要再想想"，但一旦想清楚了——开口就是结论，理由和背景跟在后面。
4. **主动，不是被动的。** 看到问题就指出来，看到风险就预警，看到更好的方案就提出来。
5. **尊重上下文，但不被上下文绑架。** 理解用户的工作压力、时间约束、组织现实——这些是决策的输入，不是放弃判断的借口。
6. **小善如大恶，大善似无情。** 你的目的是帮用户成事，不是说好听的话。
7. **尊重事实，需求不明先追问。** 不猜、不假设、不靠脑补补全需求。
8. **粗糙但有价值的输出，比精致的废话更有价值。** 具体的东西才能引发真实反馈。

## 沟通协议

- **语言**：中文为主，技术术语保留英文
- **说话要像人，不像客服**：自然、直接、该短就短，别端着
- **禁止词汇**（零容忍）：
  - 缓冲铺垫：「我理解你的感受」「你说得有道理，但是」「让我看看」「我来帮你」「抱歉」
  - 模糊软化词：「也许」「可能」「在一定程度上」「相对而言」
  - 伪两面性套话：「一方面……另一方面……」（当正确答案只有一个时）
- **反对意见**：先说"我不同意"或直接否定，再解释理由
- **分析方式**：结论先行，论据在后；从客户/市场/数据角度分析，不自嗨
- **正反都给**：给出正反两面，让用户做判断
- **标注不确定性**：信息源不可靠必须明确标注

## 关于成长透镜的深度思考功能

用户正在使用成长透镜的"深度思考"模块。这个模块帮助用户：
- 从已有能力数据出发进行深度认知审计
- 与AI进行有判断力的对话，不被敷衍
- 记录自己的思考和摘录

数据限制：本次分析基于言语行为数据，无法捕捉沉默决策和实际行为结果，无法分析压力场景（除非有对应数据）。结论是推断，需要当事人本人验证。

## 禁止事项

- 禁止评分和排名
- 禁止泛泛而谈的结论
- 禁止客服腔和语气词堆叠
- 禁止没有立场的"两面性"分析`;

// ============ API 路由 ============

// POST /api/deepthink/analyze - 生成深度分析报告
router.post('/analyze', async (req, res) => {
  try {
    const map = loadMap(req.userId);
    const dims = map.dimensions || [];

    if (dims.length < 1) {
      return res.status(400).json({ error: '至少需要1个维度才能进行深度分析' });
    }

    const dimsInfo = dims.map(d => ({
      id: d.id,
      name: d.name,
      status: d.status,
      description: d.description,
      evidence: d.evidence.map(e => ({
        quote: e.quote,
        interpretation: e.interpretation,
        source: e.source,
        polarity: e.polarity
      }))
    }));

    const systemPrompt = DEEP_ANALYSIS_SYSTEM;
    const userPrompt = `## 用户能力维度数据（共 ${dimsInfo.length} 个）

${dimsInfo.map(d => `### ${d.name}（${d.status === 'possessed' ? '已具备' : '待发展'}）
描述：${d.description}

证据链（${d.evidence.length}条）：
${d.evidence.map((e, i) => `  [证据${i + 1}] ${e.quote}
  → 解读：${e.interpretation}
  来源：${e.source}
  极性：${e.polarity === -1 ? '负面（-1星）' : '正面（+1星）'}`).join('\n\n')}`).join('\n\n---\n\n')}

## 组合（${(map.combinations || []).length} 个）
${(map.combinations || []).map(c => `- ${c.name}：${c.description}`).join('\n') || '（暂无）'}

## 盲区（${(map.blindSpots || []).length} 个）
${(map.blindSpots || []).map(b => `- ${b.name}：${b.description}`).join('\n') || '（暂无）'}

请基于以上数据，输出完整的深度分析报告。`;

    const result = await callLLMText(systemPrompt, userPrompt);
    res.json({ success: true, analysis: result });

  } catch (error) {
    console.error('[deepthink] Analysis failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deepthink/chat - 对话
router.post('/chat', async (req, res) => {
  try {
    const { messages, contextSummary } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    // 构建系统提示词
    let systemPrompt = CHAT_SYSTEM;
    if (contextSummary) {
      systemPrompt += `\n\n## 当前分析上下文\n\n${contextSummary}`;
    }

    // 构造对话消息（保留完整历史）
    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    ];

    // 直接使用 OpenAI SDK 传递完整消息历史
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: chatMessages,
      temperature: 0.7,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error('LLM 返回空响应');
    }

    res.json({ success: true, reply: response.choices[0].message.content });

  } catch (error) {
    console.error('[deepthink] Chat failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/deepthink/data - 获取深度思考数据
router.get('/data', (req, res) => {
  try {
    const data = loadDeepthinkData(req.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deepthink/data - 保存深度思考数据（笔记/会话）
router.post('/data', (req, res) => {
  try {
    const { notes, sessions, activeSessionId } = req.body;
    const existing = loadDeepthinkData(req.userId);
    const updated = {
      ...existing,
      notes: notes !== undefined ? notes : existing.notes,
      sessions: sessions !== undefined ? sessions : existing.sessions,
      activeSessionId: activeSessionId !== undefined ? activeSessionId : existing.activeSessionId,
      lastUpdated: new Date().toISOString()
    };
    saveDeepthinkData(req.userId, updated);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deepthink/notes - 实时保存笔记（高频，自动触发）
router.post('/notes', (req, res) => {
  try {
    const { notes } = req.body;
    const existing = loadDeepthinkData(req.userId);
    existing.notes = notes || '';
    existing.lastUpdated = new Date().toISOString();
    saveDeepthinkData(req.userId, existing);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deepthink/analysis - 保存分析结果
router.post('/analysis', (req, res) => {
  try {
    const { analysis } = req.body;
    const existing = loadDeepthinkData(req.userId);
    existing.analysis = analysis || null;
    existing.lastUpdated = new Date().toISOString();
    saveDeepthinkData(req.userId, existing);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deepthink/messages - 保存聊天历史
router.post('/messages', (req, res) => {
  try {
    const { messages } = req.body;
    const existing = loadDeepthinkData(req.userId);
    existing.messages = messages || [];
    existing.lastUpdated = new Date().toISOString();
    saveDeepthinkData(req.userId, existing);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
