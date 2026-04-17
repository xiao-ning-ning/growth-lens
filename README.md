# 成长力场

> 知是行之始，行是知之成。先知己之所能，方知己之所向。

## 缘起

老板问："我们请人培训了两年，到底有什么变化？"

软性能力看不见、说不清，无法量化，更无法对比。成长力场因此而生——从真实行为中提取能力维度，让成长有迹可循。

---

## 这个工具解决什么问题

管理者每天都在面对三大困境：

**述职季** — 下属洋洋洒洒写了 20 页 PPT，但哪些是真正具备的能力，哪些只是背了话术？

**晋升决策** — 凭印象打分，靠上级推荐信。两个候选人业绩相当，软性能力谁更强？说不清。

**培训资源** — 花了大价钱送管理层上课，但培训内容有没有内化？学了和没学有什么区别？

成长力场从一段真实的文字（会议记录、述职自评、访谈等）出发，AI 自动提取行为模式，生成能力图谱，让软性能力评估有据可依、可追溯、可行动。

---

## 核心价值

- **看见盲区** — 识别"应该出现但你没意识到"的能力空白，附原文证据，而非只靠直觉
- **核心组合识别** — 不是罗列能力点，而是识别"1+1>2"的化学反应，让优势可传播、可命名
- **修炼路径设计** — 以已有能力为杠杆，在现有习惯上加一个动作，最小改变最大效果
- **数据隐私自主** — 本地 JSON 存储，支持局域网部署，数据不出公司
- **成长轨迹可视化** — 五维能力折线图，hover 即可查看任意日期所有分类的已具备能力数量，直观对比成长趋势
- **团队管理视角** — 管理员可查看团队成员的成长轨迹折线图，无需切换账号，一个页面掌握团队成长动态

---

## 快速使用

上传录音文本 → AI 行为分析 → 生成能力图谱 → 设计修炼路径

---

## 快速开始

### 0. 安装 Node.js

本程序需要 Node.js 运行环境。打开 CMD（命令提示符），执行以下命令检查是否已安装：

```bash
node -v
```

如果提示"不是内部或外部命令"，执行以下命令安装（任选其一）：

**方式一（推荐）**：使用 Windows 包管理器，自动安装最新 LTS 版本：
```bash
winget install OpenJS.NodeJS.LTS
```

**方式二**：直接下载安装包静默安装（winget 不可用时使用）：
```bash
curl -L "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi" -o node.msi && node.msi /passive
```

安装完成后**关闭 CMD 重新打开**，再执行 `node -v` 确认显示版本号即可。

### 1. 安装依赖

```bash
git clone https://github.com/xiao-ning-ning/growth-force-field.git
cd growth-force-field
npm install
```

### 2. 配置 API

复制 `.env.example` 为 `.env`，填入你的 OpenAI 兼容接口配置：

```env
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
PORT=3000
HOST=0.0.0.0
OPENAI_TIMEOUT=300000
```

支持的 OpenAI 兼容接口：
- OpenAI 官方（默认）
- DeepSeek：`https://api.deepseek.com/v1`，模型 `deepseek-chat`
- 月之暗面：`https://api.moonshot.cn/v1`，模型 `moonshot-v1-8k`
- 本地 Ollama：`http://localhost:11434/v1`，模型如 `qwen2.5:14b`（建议 7B 以上）
- 其他兼容接口均可

### 3. 启动服务

双击 `start.bat` 即可运行，自动打开浏览器。首次运行需要配置 `.env` 中的 API 信息。

### 更新程序

有新版发布后，双击 `update.bat` 即可自动下载最新版本并重启。你的数据（data/ 目录）会在更新前自动备份，更新后自动还原。

---

## 功能

### 仪表盘
<img width="1918" height="1992" alt="PixPin_2026-04-15_15-32-18" src="https://github.com/user-attachments/assets/d5774426-76d6-4af3-9464-014bb5cc42e8" />

### 分析录音
上传录音文本文件（.txt），支持拖拽上传。AI 自动提取行为特征和能力维度。每次分析在已有地图基础上增量生长。
<img width="1190" height="540" alt="分析录音" src="https://github.com/user-attachments/assets/ee175c23-8502-432c-a3bd-2b22f97b1e4a" />

### 能力图谱
按五大分类（战略与诊断、管控与绩效、人心与温度、知识与赋能、制度与设计）左右分栏展示已具备和待发展维度。点击维度查看详情、证据链、关联维度，支持内联编辑证据引用。
<img width="1918" height="1992" alt="能力图谱" src="https://github.com/user-attachments/assets/6211fedf-e3be-436b-b27e-10e90ac9f7f8" />

### 核心组合
识别维度之间的协同关系，命名组合（如"手术刀式管理""温度护城河"），分析适用场景和稀缺性。动态门槛：只有证据数达到一定量的维度才能参与组合，确保组合质量。
<img width="1918" height="1173" alt="核心组合" src="https://github.com/user-attachments/assets/f591a948-9e0a-4199-b30d-67fed97b5c15" />

### 盲区探测
分析"应该出现但没出现"的能力感知，基于已有维度的触发模式推理盲区。
<img width="1918" height="1077" alt="盲区探测" src="https://github.com/user-attachments/assets/706dc596-33dc-4a79-9368-e0070eba5deb" />

### 修炼路径
针对待发展维度和盲区，设计可落地的修炼步骤，每步标注利用哪个已具备维度作为杠杆。
<img width="1918" height="1992" alt="修炼路径" src="https://github.com/user-attachments/assets/d674f017-282d-4316-a3af-c70280bd9466" />

### 成长轨迹
五维能力折线图，展示已具备能力累计数量的变化趋势。鼠标悬停可查看该日期所有分类的能力数量，直观对比成长。管理员可在成长轨迹页面查看团队成员的成长折线图，无需切换账号。

---

## 技术架构

- **前端**：单 HTML 文件，深色主题，零构建
- **后端**：Node.js + Express
- **AI**：OpenAI 兼容接口（JSON mode）
- **数据**：本地 JSON 文件，按用户分目录存储
- **认证**：多用户 session + cookie，管理员可增删用户

---

## 项目介绍 PPT

启动后在「设置」页面可查看完整项目介绍 PPT，包含产品流程、部署步骤等详细说明。

---

## License

[Apache 2.0](LICENSE)
