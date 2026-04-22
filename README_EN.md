# Growth Force Field

### AI-Powered Capability Analysis for Managers

> "Action is the starting point of knowledge; knowledge is the completion of action. Know your capabilities first, and you will know your direction."

**Turn managers' soft skills from "gut feel" into evidence.**

Upload a meeting transcript → AI analyzes behavioral patterns → Quantifies capability dimensions → Designs actionable growth paths.

Open-source & free · Local data storage · No registration required

[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

> 中文 README：[README.md](README.md)

---

## What Problem Does It Solve?

Three common dilemmas managers face:

| Scenario | Pain Point |
|:---------|:-----------|
| Performance Review | Your direct report wrote 20 slides. Which are genuine capabilities and which are just rehearsed talking points? |
| Promotion Decisions | Scoring based on impressions — who's stronger in soft skills? Can't articulate why. |
| Training ROI | Spent money on management training. What exactly changed? No evidence. |

**Growth Force Field's approach**: Soft skills aren't assessed by asking — they're inferred by observing behavior. What you do and say is more truthful than what you claim about yourself.

---

## Core Features

### 1. AI Behavioral Analysis
Identify real behavioral patterns from meeting notes, self-assessments, and interview transcripts. Quantify possessed, developing, and blind-spot dimensions. Every conclusion includes **original quotes** — traceable and auditable.

**Star Rating**: Each piece of evidence is rated +1 (positive) or -1 (negative). Stars accumulate to determine capability status — positive → Possessed, negative → Developing, zero → Dimension removed. Dynamic, bidirectional flow.

**Transcript Preprocessing**: Automatically corrects ASR errors, removes filler words, and fixes sentence boundaries before analysis — significantly improving evidence readability.

### 2. Capability Map
Five-dimension overview showing the full capability landscape and relationships between dimensions.

### 3. Core Combinations
Bundle related capability fragments into a single explainable whole. Know how they work together, where you're strongest, and when to apply them.

### 4. Blind Spot Detection
AI infers capabilities you "should have but aren't aware of" based on behavioral patterns — not extracted directly from transcripts, but identified through cross-dimensional comparison and scenario coverage analysis.

### 5. Growth Paths
For each developing dimension or blind spot, AI designs concrete action steps — each annotated with which existing capability to leverage as a fulcrum.

Minimum change, maximum leverage. No need to rebuild from scratch.

### 6. Growth Trajectory
Five-dimension line chart tracking capability growth over time. Hover over any data point to see detailed breakdown.

### 7. Custom Capability Dimensions (Admin)
Upload an Excel file to define your own dimension framework. AI analyzes strictly against your definitions, unconstrained by generic models.

### 8. Team Management View (Admin)
Heatmap overview of team capability distribution. Multi-user comparison charts — no account switching needed to design personalized coaching strategies.

---

## Differentiation

| Dimension | Growth Force Field | Traditional Assessment | Online AI Platforms |
|:----------|:------------------|:--------------------|:-------------------|
| Evidence Chain | **Original quotes for every conclusion** | None | None |
| Data Storage | **Local**, stays within your company | Cloud or paper | Cloud |
| Continuous Growth | **Incremental accumulation** | One-time | One-time |
| Multi-user Management | **Supported** — admin views all team members | Not supported | Not supported |

---

## Quick Start

### Prerequisites

| Dependency | Notes |
|:-----------|:------|
| **Node.js** | Download from [nodejs.org](https://nodejs.org) (LTS); Windows: `winget install OpenJS.NodeJS.LTS`; macOS: `brew install node` |
| **.env config** | Auto-generated on first launch — no manual setup needed |

> `start.bat` automatically checks for `node_modules`. If missing, it runs `npm install` for you. `git clone` includes `node_modules`; ZIP downloads don't, but `start.bat` handles it automatically.

### Launch

**Windows**:
```bash
git clone https://github.com/xiao-ning-ning/growth-force-field.git
cd growth-force-field
start.bat
```

**macOS / Linux**:
```bash
git clone https://github.com/xiao-ning-ning/growth-force-field.git
cd growth-force-field
chmod +x start.sh && ./start.sh
```

> Automatically detects port occupancy, kills stale processes, starts the server, and opens your browser.

### Optional Configuration

Create/edit `.env` in the project root:

```env
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
ADMIN_PASSWORD=your-password   # Optional, defaults to admin/admin123456
```

**Recommended model**: **DeepSeek** (best cost-performance, excellent Chinese understanding, stable JSON output). Supports OpenAI / DeepSeek / Moonshot / local Ollama (any OpenAI-compatible API).

---

## License

[Apache 2.0](LICENSE)
