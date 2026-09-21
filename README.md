# DailyAI Pulse (每日 AI 热点聚合与智能提炼系统)

> 🤖 全自动追踪全球 AI 前沿动态，借助大模型（LLM）进行智能去重、分类与摘要归纳，并通过现代化 Web 看板与每日早报邮件双端分发。

---

## 📑 目录

- [一、项目定位与核心特性](#一项目定位与核心特性)
- [二、系统架构与数据流](#二系统架构与数据流)
- [三、技术选型与依赖](#三技术选型与依赖)
- [四、项目目录结构](#四项目目录结构)
- [五、快速开始与本地开发](#五快速开始与本地开发)
- [六、环境变量配置详解 (.env)](#六环境变量配置详解-env)
- [七、核心功能模块实现](#七核心功能模块实现)
  - [1. 多源数据采集与反垃圾机制](#1-多源数据采集与反垃圾机制)
  - [2. 大模型提炼与成本优化 (Prefix Caching & Pruning)](#2-大模型提炼与成本优化-prefix-caching--pruning)
  - [3. 邮件排版与自适应投递系统](#3-邮件排版与自适应投递系统)
  - [4. 现代化 React 看板与 API 端点](#4-现代化-react-看板与-api-端点)
  - [5. Windows 定时自动化调度](#5-windows-定时自动化调度)
- [八、后端 API 规范](#八后端-api-规范)
- [九、常见问题与排查指南 (FAQ)](#九常见问题与排查指南-faq)

---

## 一、项目定位与核心特性

**DailyAI Pulse** 旨在解决 AI 时代信息过载与资讯分散的问题。通过自动化采集、AI 去噪提炼与定时推送，为开发者、研究员及科技爱好者提供每日最具参考价值的科技早报。

### 🌟 核心亮点

1. **定向聚焦头部实验室与核心发布**
   - **国内阵营**：DeepSeek（深度求索）、月之暗面（Kimi）、智谱 AI（GLM）、阿里（通义千问 Qwen）、腾讯（混元）、字节跳动（豆包）、MiniMax、阶跃星辰（StepFun）等；
   - **国际前沿**：OpenAI、Anthropic（Claude）、Google（Gemini）、Meta（Llama）、xAI（Grok）、Mistral、Cursor、Perplexity 等；
   - 优先捕获：新模型发布、权重开源、多模态与推理突破、AI Agent 框架及重大商业动态。
2. **多维度全网信号捕获**
   - 整合 **Google News（中/英前沿定向）**、**OpenAI 官方博客**、**IT之家国内快讯**、**Hacker News（24h 高分讨论）** 和 **GitHub Trending（AI 开源飙升榜）**。
3. **高效成本与 Prompt 缓存优化**
   - **上下文剪枝（Pruning）**：去除原始网页多余冗余参数与 HTML 标签，降低 70%+ 的 Token 输入成本；
   - **前缀缓存（Prefix Cache）**：设计高确定性的静态 System Prompt，完美契合 DeepSeek、SiliconFlow 等服务的前缀缓存机制，大幅降低调用费用并加快响应速度。
4. **高可用容错与网络韧性**
   - **自适应本地代理探测**：自动嗅探本地 Clash/v2ray 常见端口（7897、7890、10809 等），可连通则启用代理，遇阻自动无缝切换直连；
   - **多阶重试机制**：LLM 阶梯式延时重试，清晨自动化任务支持网络抖动延时 5 分钟后全流程重试（最多重试 3 次）。
5. **双端高质量呈现**
   - **交互式 Web 看板**：支持日历按日归档、亮/暗色模式、实时全文搜索、四大板块分类筛选及手动一键更新；
   - **精美早报邮件**：响应式 HTML 邮件模板，涵盖今日 3 大速览（Core Takeaways）、分类彩色标签与火焰热度指数。

---

## 二、系统架构与数据流

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        1. 多源数据采集 (Scrapers)                      │
│   • Google News (重点实验室定向)       • OpenAI Blog RSS (官方发布)     │
│   • Google News (通用 AI 产业趋势)    • IT之家 (国内科技要闻)          │
│   • Hacker News (Algolia API 24h)     • GitHub Trending (AI Stars 榜) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 严格按 36 小时时效过滤、反查视频新闻文字版
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      2. 数据清洗与字段剪枝 (Pruning)                   │
│   • 提取 ID、标题、来源、前80字摘要，去除冗余长 URL / HTML 标记 (省 Token) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   3. 大模型分析提炼 (LLM Engine)                       │
│   • 静态确定性 Prompt 触发 Prefix Caching                              │
│   • 支持 OpenAI 兼容接口 (DeepSeek/SiliconFlow/Zhipu) & Gemini         │
│   • 思考模式 (Thinking Mode) 深度提炼、热度评估 (1-100) 与去重归类    │
│   • 强一致性约束 (Core Takeaways 必须在分类列表中具备实体卡片)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 结构化 JSON 落盘至 data/YYYY-MM-DD.json
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│     4. 响应式早报邮件 (Mailer)    │ │    5. Web 交互式看板 (React 18)   │
│ • 智能自适应 SMTP 端口 (587/465)   │ │ • Vite + React 单页仪表盘         │
│ • DNS 解析容错，多层重试投递       │ │ • 往期归档、多主题、搜索与分类     │
│ • 定时 8:00 AM 自动直达邮箱       │ │ • 手动触发同步与补发邮件          │
└───────────────────────────────────┘ └───────────────────────────────────┘
```

---

## 三、技术选型与依赖

| 领域 | 技术栈 / 依赖 | 说明 |
| :--- | :--- | :--- |
| **运行时** | Node.js (>= 18.0.0, ES Modules) | 采用纯原生 ESM 规范 (`"type": "module"`) |
| **后端服务** | Express 4, CORS, dotenv | 轻量级 RESTful API 服务与前端静态资产托管 |
| **数据采集** | Axios, xml2js, https-proxy-agent | HTTP 请求与代理适配、RSS/XML 快速解析 |
| **大语言模型** | OpenAI-compatible API / @google/generative-ai | 支持 DeepSeek-V3/R1、SiliconFlow、Gemini 等 |
| **邮件推送** | Nodemailer | SMTP 邮件组装与 HTML 模板渲染 |
| **前端应用** | React 18, Vite 5, Lucide React | 现代极客风仪表盘、响应式排版、深浅主题 |
| **自动化调度**| Windows Task Scheduler, PowerShell, Bat | 每天清晨自动唤醒执行 |

---

## 四、项目目录结构

```text
periodic/
├── data/                       # 历史每日简报 JSON 存储库 (格式: YYYY-MM-DD.json)
├── design-system/              # 界面设计规范与 UI Token 定义
├── dist/                       # Vite 前端打包输出产物 (由 Express 统一托管)
├── logs/                       # 自动化脚本执行日志 (如 cron.log)
├── scripts/
│   ├── aggregate.js            # 核心数据采集、剪枝、LLM 提炼与持久化管道
│   └── mailer.js               # 邮件模板生成与 SMTP 自适应发送引擎
├── src/
│   ├── App.jsx                 # 前端核心看板组件 (日历侧栏、分类 Tab、热度卡片)
│   ├── App.css                 # 看板样式与深浅主题 CSS Variables
│   ├── index.css               # 全局重置样式与字体导入
│   └── main.jsx                # React 挂载入口
├── .env.example                # 环境变量范例文件
├── index.html                  # 前端 HTML 入口模板
├── package.json                # 项目依赖与运行脚本
├── run-daily.bat               # 定时任务批处理入口
├── schedule-task.ps1           # Windows 计划任务一键注册 PowerShell 脚本
├── server.js                   # Express 生产服务入口
└── vite.config.js              # Vite 打包配置
```

---

## 五、快速开始与本地开发

### 1. 环境准备
确保本机已安装 Node.js (建议 v18+)。

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
复制配置文件并填入相关密钥：
```bash
cp .env.example .env
```
*(详细配置请参考 [第六节：环境变量配置详解](#六环境变量配置详解-env))*

### 4. 运行与调试

- **前端单独开发调试**：
  ```bash
  npm run dev
  # 启动 Vite 开发服务器 (默认端口 http://localhost:5173)
  ```

- **全栈服务运行 (推荐日常使用)**：
  ```bash
  # 1. 构建前端
  npm run build
  
  # 2. 启动 Express 托管服务 (默认端口 http://localhost:3000)
  npm start
  ```

- **手动运行一次数据抓取与邮件推送**：
  ```bash
  # 完整管道：抓取 -> AI 提炼 -> 落盘 -> 发送邮件
  npm run aggregate

  # 仅抓取并保存 JSON，跳过邮件发送：
  node scripts/aggregate.js --no-email --once
  ```

---

## 六、环境变量配置详解 (`.env`)

```ini
# 服务端口
PORT=3000
SUMMARY_LANGUAGE=zh-CN

# LLM 服务商选择: openai (推荐国内/SiliconFlow/DeepSeek) 或 gemini
LLM_PROVIDER=openai

# ===================================================================
# 方案 A: OpenAI 兼容接口 (推荐配置，如 SiliconFlow / DeepSeek 官方)
# ===================================================================
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
OPENAI_MODEL_NAME=deepseek-ai/DeepSeek-V3

# 思考模式 (Thinking Mode)，如模型不支持思考可设为 false
ENABLE_THINKING=false
THINKING_EFFORT=low

# ===================================================================
# 方案 B: Google Gemini 接口 (需国外网络/海外服务器支持)
# ===================================================================
# LLM_PROVIDER=gemini
# GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ===================================================================
# SMTP 邮件发送配置 (以 Outlook / Hotmail 为例)
# ===================================================================
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@outlook.com
SMTP_PASS=your_outlook_app_password

# 接收简报的邮箱地址
RECEIVER_EMAIL=your_receive_email@outlook.com
```

> **注意**：
> - 若使用 Outlook，请确保使用微软账户生成的**应用专用密码 (App Password)**。
> - 系统已内置本地代理端口嗅探逻辑，如果本地运行了 Clash/v2ray（端口 7897/7890/10809），系统会自动优先走代理加速海外新闻抓取；若无可用代理会自动回退到直连模式。

---

## 七、核心功能模块实现

### 1. 多源数据采集与反垃圾机制
- **36 小时严格时效过滤**：在抓取 Google News、OpenAI 博客或 IT 之家时，解析并比对 `pubDate`，剔除 36 小时之前的旧闻，保证资讯新鲜度。
- **视频新闻自动替换**：检测到标题或链接含有 `[视频]`、`youtube.com`、`bilibili.com` 等多媒体资讯时，自动以标题作为关键词在 Google News 重新检索纯文本报道，避免因无法阅览视频而导致信息缺失。
- **Google 重定向延迟解码**：Google News RSS 输出的均为加密跳转链接（`news.google.com/rss/articles/...`），为节省网络开销，仅在模型最终评选出的卡片条目上执行 `batchexecute` 逆向解析，获取原始网站超链接。

### 2. 大模型提炼与成本优化 (Prefix Caching & Pruning)
- **数据裁剪 (Pruning)**：海量新闻直接送入模型会导致上下文溢出且费用高昂。系统在请求模型前，将抓取的数据清洗压缩为精炼结构：
  ```json
  [
    { "id": 0, "title": "...", "source": "...", "snippet": "..." }
  ]
  ```
- **前缀缓存 (Prefix Caching)**：System Prompt 采用固定模板结构，确保每次请求的头部指令完全一致，最大化命中模型供应商的 Prompt Cache，显著降低调用延迟与计费。
- **四大维度分类**：
  1. `industry`（行业巨头 & 产业动态）：投融资、商业合作、收购、算力基础设施。
  2. `research`（前沿研究 & 核心模型）：模型发布、算法论文突破、架构与基准测试。
  3. `opensource`（开源生态 & 开发工具）：GitHub 热门项目、开源权重、Agent 工具链。
  4. `ethics`（社会伦理 & 热点讨论）：安全伦理、监管政策、版权争议与社区讨论。
- **强一致性校验**：Prompt 严格约束 `overview`（今日速览 Top 3）中提及的核心事件，必须在下方的分类卡片中有相对应的项目，避免模型出现幻觉。

### 3. 邮件排版与自适应投递系统
- 位于 [scripts/mailer.js](file:///d:/Antigravity/Projects/periodic/scripts/mailer.js)。
- **现代美观模板**：采用卡片化布局，为四大分类赋予定制色彩，为每条新闻打上火焰热度徽章（85+ 分为红色高热，60-85 分为黄色中热）。
- **投递容错能力**：
  - 发送前通过 OS DNS 解析优先解析 IP，避免特定内网环境下 DNS 响应超时；
  - 内置 587 (STARTTLS) 与 465 (SSL) 端口自适应轮换与阶梯重试机制。

### 4. 现代化 React 看板与 API 端点
- 位于 [src/App.jsx](file:///d:/Antigravity/Projects/periodic/src/App.jsx)。
- **日历归档**：读取 `data/` 目录中的全部历史数据，按时间降序展示，支持自由回溯。
- **交互功能**：支持全文关键词检索、分类 Tab 过滤、深色模式（Dark Mode）与浅色模式切换。
- **交互式手动更新**：页面右上角提供“仅更新数据”、“仅发送邮件”、“更新 & 发送邮件”三个快捷按钮，并在前端建立 3 秒轮询机制，实时反馈后台聚合进度。

### 5. Windows 定时自动化调度
- **启动批处理**：[run-daily.bat](file:///d:/Antigravity/Projects/periodic/run-daily.bat) 将执行日志输出至 `logs/cron.log`。
- **一键注册计划任务**：以管理员身份运行 PowerShell 脚本 [schedule-task.ps1](file:///d:/Antigravity/Projects/periodic/schedule-task.ps1)：
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\schedule-task.ps1
  ```
  该脚本将在 Windows 任务计划程序中注册名为 `DailyAI-Pulse` 的计划任务，设定为**每天早晨 8:00 自动执行**。
- **开机网络容错**：脚本内置 5 分钟延时管道级重试（最多重试 3 次），避免早上电脑刚开机、网络尚未连通时执行失败。

---

## 八、后端 API 规范

服务端由 [server.js](file:///d:/Antigravity/Projects/periodic/server.js) 提供，主要接口如下：

### 1. 获取所有归档日期
- **URL**：`GET /api/summaries`
- **响应示例**：
  ```json
  {
    "success": true,
    "dates": ["2026-09-21", "2026-09-20", "2026-09-19", "..."]
  }
  ```

### 2. 获取指定日期摘要数据
- **URL**：`GET /api/summary/:date` (例如 `/api/summary/2026-09-21`)
- **响应示例**：
  ```json
  {
    "success": true,
    "data": {
      "overview": [
        "阿里 Qwen 团队发布 Qwen3.8-LiveTranslate 实时口译模型...",
        "..."
      ],
      "categories": {
        "industry": {
          "title": "行业巨头 & 产业动态",
          "items": [
            {
              "title": "Meta 的 AI Agent Muse 登顶 App Store...",
              "summary": "...",
              "hotness": 94,
              "link": "https://..."
            }
          ]
        },
        "research": { ... },
        "opensource": { ... },
        "ethics": { ... }
      }
    }
  }
  ```

### 3. 手动触发聚合或邮件发送
- **URL**：`POST /api/trigger`
- **请求体**：
  ```json
  {
    "action": "all" // 可选: "all" (抓取+发邮件) | "update" (仅抓取) | "email" (仅补发今日邮件)
  }
  ```
- **响应示例**：
  ```json
  {
    "success": true,
    "message": "更新与发送任务已启动，大约需要 10-30 秒，完成后将自动发送邮件..."
  }
  ```

---

## 九、常见问题与排查指南 (FAQ)

### Q1: 邮件发送失败（SMTP Timeout 或 Connection Refused）？
1. 检查 `.env` 中的 `SMTP_HOST`、`SMTP_USER` 与 `SMTP_PASS`。
2. 若使用微软 Outlook/Hotmail，登录密码往往无效，必须在微软安全中心生成**应用专用密码**。
3. 检查本地防火墙或代理软件是否拦截了 `587` / `465` 端口流量。

### Q2: 抓取 Google News 时提示网络超时或无法访问？
- 系统会自动检测 Clash/v2ray 等常见代理端口（如 `http://127.0.0.1:7897`）。
- 请确认本机代理客户端处于开启状态且开放了 LAN 或本地 HTTP 代理。

### Q3: LLM 提炼报错或提示超时？
- 默认单次请求超时设定为 180 秒，并配有 4 次阶梯延时重试；
- 若使用 SiliconFlow 或 DeepSeek，请检查 `OPENAI_API_KEY` 是否有效、账户余额是否充足；
- 若出现特定格式报错，可在 `.env` 中调低 `THINKING_EFFORT` 或将 `ENABLE_THINKING` 设置为 `false`。

### Q4: 如何修改每天早上的推送时间？
打开 [schedule-task.ps1](file:///d:/Antigravity/Projects/periodic/schedule-task.ps1) 第 21 行：
```powershell
$Trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
```
修改为你需要的时间（如 `9:00AM`），然后以管理员身份重新运行该 PowerShell 脚本即可覆盖注册。

---

## 📄 License
MIT License. Feel free to use and customize!
