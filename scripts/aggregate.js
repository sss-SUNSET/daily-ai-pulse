import axios from 'axios';
import https from 'https';
import { parseStringPromise } from 'xml2js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { sendSummaryEmail } from './mailer.js';

dotenv.config();

// Allow internal/corporate TLS inspection certificates if present
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Configure local proxy with smart detection and graceful fallback
async function setupProxy() {
  const candidateProxies = [];
  if (process.env.HTTPS_PROXY) candidateProxies.push(process.env.HTTPS_PROXY);
  if (process.env.HTTP_PROXY && !candidateProxies.includes(process.env.HTTP_PROXY)) candidateProxies.push(process.env.HTTP_PROXY);
  
  // Common local proxy ports (Clash Verge 7897, Clash 7890, v2rayN 10809, etc.)
  const defaultProxies = ['http://127.0.0.1:7897', 'http://127.0.0.1:7890', 'http://127.0.0.1:10809', 'http://127.0.0.1:10808'];
  for (const p of defaultProxies) {
    if (!candidateProxies.includes(p)) candidateProxies.push(p);
  }

  let workingAgent = null;
  let workingProxy = null;

  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    for (const proxyUrl of candidateProxies) {
      try {
        const agent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
        // Quick test proxy connectivity to external site
        await axios.get('https://news.google.com/generate_204', {
          httpsAgent: agent,
          proxy: false,
          timeout: 4000,
          validateStatus: status => status < 400
        });
        workingAgent = agent;
        workingProxy = proxyUrl;
        break;
      } catch {
        // Try next candidate
      }
    }
  } catch (err) {
    console.warn('[Proxy] Failed to load HttpsProxyAgent:', err.message);
  }

  if (workingAgent) {
    axios.defaults.httpsAgent = workingAgent;
    axios.defaults.proxy = false;
    console.log(`[Proxy] Global HTTPS proxy verified and enabled: ${workingProxy}`);
  } else {
    // Explicitly delete all proxy env variables and set axios proxy to false
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    axios.defaults.proxy = false;
    console.warn('[Proxy] No reachable proxy found. Falling back to direct connection!');
  }
}

await setupProxy();

// Ensure data folder exists
const DATA_DIR = path.resolve('data');
await fs.mkdir(DATA_DIR, { recursive: true });

// Simple HTML entity decoder
function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Decodes Google News RSS redirect URLs using batchexecute endpoint
 */
async function decodeGoogleNewsUrl(googleRssUrl) {
  if (!googleRssUrl || !googleRssUrl.includes('news.google.com/rss/articles/')) {
    return googleRssUrl;
  }
  try {
    const response = await axios.get(googleRssUrl, {
      timeout: 4000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const match = response.data.match(/<c-wiz[^>]+data-p="([^"]+)"/);
    if (!match) {
      return googleRssUrl;
    }
    
    let dataP = decodeHtmlEntities(match[1]);
    const obj = JSON.parse(dataP.replace('%.@.', '["garturlreq",'));
    const payload = {
      'f.req': JSON.stringify([[
        ['Fbv4je', JSON.stringify([...obj.slice(0, -6), ...obj.slice(-2)]), 'null', 'generic']
      ]])
    };

    const postResponse = await axios.post(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute',
      new URLSearchParams(payload).toString(),
      {
        timeout: 4000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    const cleanData = postResponse.data.replace(")]}'\n", "");
    const parsedBatch = JSON.parse(cleanData);
    const arrayString = parsedBatch[0][2];
    const articleUrl = JSON.parse(arrayString)[1];
    
    return articleUrl || googleRssUrl;
  } catch (error) {
    console.warn(`[Scraper] Failed to decode Google News URL: ${googleRssUrl}. Error: ${error.message}`);
    return googleRssUrl;
  }
}

// Clean title of video indicators
function cleanVideoTitle(title) {
  if (!title) return '';
  return title
    .replace(/（视频）/g, '')
    .replace(/\[视频\]/g, '')
    .replace(/【视频】/g, '')
    .replace(/\(视频\)/g, '')
    .replace(/\(Video\)/g, '')
    .replace(/\[Video\]/g, '')
    .replace(/视频：/g, '')
    .replace(/视频\|/g, '')
    .trim();
}

// Detect if a title or link is a video
function isVideoNews(title, link) {
  const urlLower = (link || '').toLowerCase();
  const titleLower = (title || '').toLowerCase();
  
  const videoKeywords = [
    'video', '视频', 'tv', 'youtube.com', 'bilibili.com', 'v.news.cn',
    'v.xinhuanet.com', 'v.qq.com', 'youku.com', 'iqiyi.com', '/video/', '/v/'
  ];
  
  if (videoKeywords.some(kw => urlLower.includes(kw))) {
    return true;
  }
  
  const videoPatterns = ['（视频）', '[视频]', '【视频】', '(视频)', '(video)', '[video]', '视频：'];
  if (videoPatterns.some(p => titleLower.includes(p))) {
    return true;
  }
  
  return false;
}

// Search for a text alternative for a video news item
async function findTextAlternativeForVideo(title, lang = 'zh-CN') {
  const query = cleanVideoTitle(title);
  const ceid = lang === 'zh-CN' ? 'CN:zh-Hans' : 'US:en';
  const gl = lang === 'zh-CN' ? 'CN' : 'US';
  const hl = lang === 'zh-CN' ? 'zh-CN' : 'en-US';
  
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const result = await parseStringPromise(response.data);
    const items = result.rss.channel[0].item || [];
    
    for (const item of items) {
      const itemTitle = item.title[0];
      const itemLink = item.link[0];
      
      if (!isVideoNews(itemTitle, itemLink)) {
        const decoded = await decodeGoogleNewsUrl(itemLink);
        return {
          title: itemTitle,
          link: decoded,
          pubDate: item.pubDate[0],
          source: item.source[0]._ || item.source[0],
          description: item.description ? item.description[0].replace(/<[^>]*>/g, '') : '',
          origin: 'Google News',
          type: 'news'
        };
      }
    }
    return null;
  } catch (error) {
    console.warn(`[Scraper] Search alternative failed for "${title}": ${error.message}`);
    return null;
  }
}

/**
 * Helper to fetch and parse Google News RSS for a specific query
 */
async function fetchGoogleNewsQuery(queryStr, lang = 'zh-CN', maxItems = 25, channelLabel = 'Google News') {
  const query = encodeURIComponent(queryStr);
  const ceid = lang === 'zh-CN' ? 'CN:zh-Hans' : 'US:en';
  const gl = lang === 'zh-CN' ? 'CN' : 'US';
  const hl = lang === 'zh-CN' ? 'zh-CN' : 'en-US';
  
  const url = `https://news.google.com/rss/search?q=${query}+when:1d&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  
  try {
    console.log(`[Scraper] Fetching ${channelLabel} (${lang})...`);
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const result = await parseStringPromise(response.data);
    const items = result?.rss?.channel?.[0]?.item || [];
    
    const topItems = items.slice(0, maxItems);
    console.log(`[Scraper] Processing ${topItems.length} items from ${channelLabel} (${lang})...`);
    
    const mappedItems = [];
    for (let i = 0; i < topItems.length; i++) {
      const item = topItems[i];
      const originalLink = item.link[0];
      const originalTitle = item.title[0];
      
      if (isVideoNews(originalTitle, originalLink)) {
        console.log(`[Scraper] Detected video news: "${originalTitle}". Searching for text alternative...`);
        const textAlt = await findTextAlternativeForVideo(originalTitle, lang);
        if (textAlt) {
          console.log(`[Scraper] Successfully replaced video news with text alternative: "${textAlt.title}"`);
          mappedItems.push({ ...textAlt, isFocusedLab: channelLabel.includes('Focused') });
          continue;
        }
      }
      
      mappedItems.push({
        title: originalTitle,
        link: originalLink,
        pubDate: item.pubDate[0],
        source: item.source?.[0]?._ || item.source?.[0] || 'Google News',
        description: item.description ? item.description[0].replace(/<[^>]*>/g, '') : '',
        origin: 'Google News',
        type: 'news',
        isFocusedLab: channelLabel.includes('Focused')
      });
    }
    return mappedItems;
  } catch (error) {
    console.error(`[Scraper] Error fetching ${channelLabel} (${lang}):`, error.message);
    return [];
  }
}

/**
 * Fetch focused news specifically tracking top domestic and foreign AI labs & companies
 */
async function fetchFocusedLabsNews(lang = 'zh-CN') {
  if (lang === 'zh-CN') {
    // 聚焦国内顶尖阵营 (DeepSeek/Kimi/MiniMax/智谱GLM/阿里通义Qwen/腾讯混元/字节豆包/阶跃星辰/百川/文心) 与 国外核心 (OpenAI/Anthropic/Google/Meta/Grok/Mistral)
    const queryZh = '("DeepSeek" OR "深度求索" OR "Kimi" OR "月之暗面" OR "智谱" OR "GLM" OR "通义千问" OR "Qwen" OR "MiniMax" OR "Mimo" OR "混元" OR "豆包" OR "阶跃星辰" OR "百川" OR "文心" OR "OpenAI" OR "Anthropic" OR "Claude" OR "Gemini" OR "Meta Llama" OR "Grok" OR "xAI" OR "Mistral") AND ("发布" OR "多模态" OR "API" OR "上线" OR "大模型" OR "开源" OR "Agent" OR "智能体" OR "推理" OR "新版本" OR "权重" OR "更新")';
    return fetchGoogleNewsQuery(queryZh, 'zh-CN', 25, 'Google News [Focused Labs]');
  } else {
    // 聚焦国际前沿机构 (OpenAI, Anthropic Claude, Google Gemini, Meta Llama, xAI Grok, Mistral, Cursor, Perplexity)
    const queryEn = '(DeepSeek OR OpenAI OR Anthropic OR Claude OR Google OR Gemini OR Meta OR Llama OR Grok OR xAI OR Mistral OR Qwen OR MiniMax OR Kimi OR Perplexity OR Cursor) AND ("release" OR "launch" OR "model" OR "API" OR "multimodal" OR "Agent" OR "weights" OR "open source" OR "announces" OR "reasoning")';
    return fetchGoogleNewsQuery(queryEn, 'en-US', 25, 'Google News [Focused Labs]');
  }
}

/**
 * Fetch general AI industry trends and infrastructure
 */
async function fetchGeneralAINews(lang = 'zh-CN') {
  if (lang === 'zh-CN') {
    const queryZh = '("人工智能" OR "大模型" OR "AI Agent" OR "具身智能" OR "算力") -展会 -大赛 -嘉年华 -选拔赛';
    return fetchGoogleNewsQuery(queryZh, 'zh-CN', 20, 'Google News [General AI]');
  } else {
    const queryEn = '("Artificial Intelligence" OR "Generative AI" OR "Large Language Model" OR "AI Agent" OR "AI infrastructure" OR "AI Safety")';
    return fetchGoogleNewsQuery(queryEn, 'en-US', 20, 'Google News [General AI]');
  }
}

/**
 * Fetch OpenAI official news blog RSS
 */
async function fetchOpenAINews() {
  const url = 'https://openai.com/news/rss.xml';
  try {
    console.log('[Scraper] Fetching OpenAI official news RSS...');
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const result = await parseStringPromise(response.data);
    const items = result.rss.channel[0].item || [];
    
    return items.map(item => ({
      title: item.title[0],
      link: item.link[0],
      pubDate: item.pubDate[0],
      source: 'OpenAI Blog',
      description: item.description ? item.description[0].replace(/<[^>]*>/g, '').trim() : '',
      origin: 'OpenAI Official',
      type: 'news'
    }));
  } catch (error) {
    console.warn('[Scraper] Error fetching OpenAI official news:', error.message);
    return [];
  }
}

/**
 * Fetch Hacker News AI stories from past 24 hours via Algolia Search API
 */
async function fetchHackerNews() {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  const url = `https://hn.algolia.com/api/v1/search?query=AI%20OR%20LLM%20OR%20GPT%20OR%20Claude%20OR%20"Artificial%20Intelligence"&tags=story&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=15`;
  
  try {
    console.log('[Scraper] Fetching Hacker News AI stories...');
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const hits = response.data?.hits || [];
    
    return hits.map(hit => ({
      title: hit.title,
      link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      pubDate: new Date(hit.created_at_i * 1000).toUTCString(),
      source: hit.author,
      description: `HN Upvotes: ${hit.points} | Comments: ${hit.num_comments}`,
      points: hit.points || 0,
      comments: hit.num_comments || 0,
      origin: 'Hacker News',
      type: 'hacker_news'
    }));
  } catch (error) {
    console.error('[Scraper] Error fetching Hacker News:', error.message);
    return [];
  }
}

/**
 * Fetch Github trending AI repos using Search API
 */
async function fetchGithubTrends() {
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const url = `https://api.github.com/search/repositories?q=(topic:llm+OR+topic:artificial-intelligence)+pushed:>${oneDayAgo}&sort=stars&order=desc&per_page=10`;
  
  try {
    console.log('[Scraper] Fetching Github trending AI repositories...');
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const items = response.data?.items || [];
    
    return items.map(repo => ({
      title: repo.name,
      link: repo.html_url,
      pubDate: repo.updated_at,
      source: repo.owner.login,
      description: `Stars: ${repo.stargazers_count} | Forks: ${repo.forks_count} | Description: ${repo.description || 'No description'}`,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      origin: 'GitHub',
      type: 'github'
    }));
  } catch (error) {
    console.error('[Scraper] Error fetching Github Trends:', error.message);
    return [];
  }
}

/**
 * Fetch ITHome AI news RSS (Domestic fallback source)
 */
async function fetchITHomeNews() {
  const url = 'https://www.ithome.com/rss/';
  try {
    console.log('[Scraper] Fetching ITHome AI news RSS...');
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (typeof response.data !== 'string' || !response.data.includes('<rss')) {
      return [];
    }

    const result = await parseStringPromise(response.data);
    const items = result?.rss?.channel?.[0]?.item || [];
    
    const aiKeywords = /AI|大模型|人工智能|GPT|DeepSeek|深度求索|Janus|智能体|Agent|算力|英伟达|Nvidia|OpenAI|Claude|Anthropic|Gemini|Gemma|Google|Kimi|月之暗面|智谱|GLM|CogVideo|豆包|通义|Qwen|混元|MiniMax|Mimo|阶跃星辰|StepFun|百川|文心|Grok|xAI|Mistral|Llama|Perplexity|Cursor|多模态|Multimodal|推理模型/i;
    const aiItems = items.filter(item => {
      const title = item.title?.[0] || '';
      const desc = item.description?.[0] || '';
      return aiKeywords.test(title) || aiKeywords.test(desc);
    }).slice(0, 20);

    return aiItems.map(item => ({
      title: item.title[0],
      link: item.link[0],
      pubDate: item.pubDate[0],
      source: 'IT之家',
      description: item.description ? item.description[0].replace(/<[^>]*>/g, '').trim() : '',
      origin: 'IT之家',
      type: 'news'
    }));
  } catch (error) {
    console.warn('[Scraper] Error fetching ITHome news:', error.message);
    return [];
  }
}

/**
 * Run the summary through LLM (Gemini or OpenAI compatible)
 */
/**
 * Restore original links and metadata into AI summary results using ID mapping or fuzzy title match
 */
function hydrateParsedSummary(parsedData, rawData) {
  if (!parsedData || !parsedData.categories) return parsedData;

  const titleMap = new Map();
  rawData.forEach((raw) => {
    if (raw && raw.title) {
      titleMap.set(raw.title.toLowerCase().replace(/[\s\-_—|]+/g, ''), raw);
    }
  });

  Object.keys(parsedData.categories).forEach(catKey => {
    const cat = parsedData.categories[catKey];
    if (cat && Array.isArray(cat.items)) {
      cat.items.forEach(item => {
        let original = null;
        if (typeof item.id === 'number' && rawData[item.id]) {
          original = rawData[item.id];
        } else if (item.title) {
          const normTitle = item.title.toLowerCase().replace(/[\s\-_—|]+/g, '');
          original = titleMap.get(normTitle);
          if (!original) {
            for (const [t, raw] of titleMap.entries()) {
              if (t.includes(normTitle) || normTitle.includes(t)) {
                original = raw;
                break;
              }
            }
          }
        }

        if (original) {
          item.link = original.link;
          if (!item.source) {
            item.source = original.source || original.origin || 'AI News';
          }
        } else if (!item.link || item.link.startsWith('#')) {
          item.link = rawData[0]?.link || 'https://news.google.com';
        }
      });
    }
  });

  return parsedData;
}

/**
 * Run the summary through LLM (Gemini or OpenAI compatible) with Prefix Caching & ID Pruning
 */
async function summarizeWithAI(rawData) {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  
  // 1. Prune input fields to save 70%+ tokens (strip raw long URLs, timestamps, html blobs)
  const prunedData = rawData.map((item, idx) => ({
    id: idx,
    title: item.title,
    source: item.source || item.origin || '',
    snippet: (item.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  }));

  // 2. Deterministic, static System Prompt (100% hits DeepSeek Prefix Cache)
  const systemPrompt = `你是一个专业的 AI 领域资深科技分析师和主编。请对提供的新闻候选数据进行提炼分析：
1. **去重与合并**：将多份报道的同一个事件合并为一个，并在 item 中标注对应源新闻的 "id"（整数数字）。
2. **分类**：将新闻分别归入四个板块：
   - \`industry\` (行业巨头 & 产业动态)：包括微软、OpenAI、Google、Meta、Nvidia、阿里、腾讯、字节跳动等巨头动态，商业合作，收购与投融资，算力基础设施。
   - \`research\` (前沿研究 & 核心模型)：最新的大语言模型、多模态模型、推理模型发布，核心算法论文，架构突破与基准测试。
   - \`opensource\` (开源生态 & 开发工具)：GitHub 热门 AI 项目，开源权重与代码，开发框架，Agent 工具链。
   - \`ethics\` (社会伦理 & 热点讨论)：AI 安全性，伦理争议，版权与政策监管，社区深度话题。
3. **翻译与摘要**：全部输出为中文。为每个条目编写 1-2 句极其精炼、易懂、突出核心要点的中文摘要。
4. **热度评估 (1-100)**：综合考量曝光度与突破性，给出一个 1-100 的热度指数。
5. **最高优先级跟踪偏好（国内外核心大模型与前沿实验室）**：
   - **国外核心阵营**：OpenAI (GPT/Sora/o1/Canvas)、Google (Gemini/Gemma)、Anthropic (Claude/Artifacts)、Meta (Llama)、xAI (Grok)、Mistral、Cursor、Perplexity 等；
   - **国内核心阵营**：DeepSeek (深度求索/Janus)、月之暗面 (Kimi)、MiniMax (Mimo/稀宇科技)、智谱 AI (GLM/CogVideo)、阿里 (通义千问/Qwen)、腾讯 (混元)、字节跳动 (豆包)、百度 (文心)、阶跃星辰 (StepFun)、百川智能等；
   - **核心重点事件**：只要出现上述国内外重点厂商/实验室的**新模型发布、多模态（视觉/语音/视频/端到端）API/功能上线、推理模型突破、开源模型权重、AI Agent（智能体）重磅更新**，必须**优先保留并大幅提升热度值（90-100）**，且确保在 \`overview\` (今日速览) 中第一条或置顶呈现！
6. **强一致性要求**：在 \`overview\` (今日最值得关注的 top 3 核心洞察或趋势) 中提到的所有事件，**必须且只能**在下方 \`categories\` 对应的某个分类 items 中有相对应的具体卡片。绝不允许在速览中提及但下方卡片缺失！

请严格返回符合以下 Schema 的标准 JSON 格式：
{
  "overview": [
    "今日最值得关注的 top 3 核心洞察或趋势（中文，每条一行）"
  ],
  "categories": {
    "industry": {
      "title": "行业巨头 & 产业动态",
      "items": [
        { "id": 0, "title": "合并提炼后的新闻标题", "summary": "1-2句的核心中文摘要", "hotness": 95 }
      ]
    },
    "research": {
      "title": "前沿研究 & 核心模型",
      "items": []
    },
    "opensource": {
      "title": "开源生态 & 开发工具",
      "items": []
    },
    "ethics": {
      "title": "社会伦理 & 热点讨论",
      "items": []
    }
  }
}`;

  // 3. User Prompt with static instruction followed by pruned dynamic items at the end
  const userPrompt = `请对以下新闻候选集进行去重、归类和提炼，必须严格输出纯 JSON：

\`\`\`json
${JSON.stringify(prunedData, null, 2)}
\`\`\``;

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';

    if (!apiKey) {
      console.warn('\n⚠️ [AI Summarizer] LLM_PROVIDER is set to "openai" but OPENAI_API_KEY is not configured in .env.');
      console.warn('Running in fallback mode with simulated AI summarization.\n');
      return generateFallbackSummary(rawData);
    }

    const enableThinking = process.env.ENABLE_THINKING === 'true';
    const thinkingEffort = (process.env.THINKING_EFFORT || 'low').toLowerCase();
    console.log(`[AI Summarizer] Calling OpenAI-compatible API (${baseUrl}) using model ${modelName} (Thinking Mode: ${enableThinking ? `Enabled [Effort: ${thinkingEffort}]` : 'Disabled'})...`);
    
    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };

    if (enableThinking) {
      payload.thinking = { type: 'enabled' };
      payload.reasoning_effort = thinkingEffort;
    } else {
      payload.temperature = 0.3;
    }

    const isDomesticOrLocal = /deepseek\.com|siliconflow\.cn|bigmodel\.cn|localhost|127\.0\.0\.1|192\.168\./i.test(baseUrl);
    const requestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 180000
    };

    if (isDomesticOrLocal) {
      requestConfig.httpsAgent = new https.Agent({ rejectUnauthorized: false });
      requestConfig.proxy = false;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${baseUrl}/chat/completions`,
          payload,
          requestConfig
        );

        let text = response.data?.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error(`Invalid response structure from LLM: ${JSON.stringify(response.data)}`);
        }
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        try {
          const parsedData = JSON.parse(text);
          // Hydrate real links and metadata back into parsed summary
          return hydrateParsedSummary(parsedData, rawData);
        } catch (parseError) {
          console.error('[AI Summarizer] JSON parsing error. Raw content returned by LLM was:');
          console.error(text);
          throw parseError;
        }
      } catch (error) {
        console.warn(`[AI Summarizer] Attempt ${attempt}/${maxRetries} failed: ${error.response?.data || error.message}`);
        if (attempt < maxRetries) {
          const delayMs = attempt * 3000;
          console.log(`[AI Summarizer] Retrying in ${delayMs / 1000}s...`);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          console.error('[AI Summarizer] All retry attempts failed. Falling back to simulated summarization.');
          return generateFallbackSummary(rawData);
        }
      }
    }
  } else if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('\n⚠️ [AI Summarizer] LLM_PROVIDER is set to "gemini" but GEMINI_API_KEY is not configured in .env.');
      console.warn('Running in fallback mode with simulated AI summarization.\n');
      return generateFallbackSummary(rawData);
    }

    console.log('[AI Summarizer] Calling Gemini API for deduplication, hotness analysis, and summarization...');
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const result = await model.generateContent(fullPrompt);
      let text = result.response.text();
      
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(text);
      return hydrateParsedSummary(parsedData, rawData);
    } catch (error) {
      console.error('[AI Summarizer] Error calling Gemini API:', error.message);
      console.log('[AI Summarizer] Falling back to simulated summarization.');
      return generateFallbackSummary(rawData);
    }
  } else {
    console.warn('\n⚠️ [AI Summarizer] No valid LLM_PROVIDER configured in .env (expected "openai" or "gemini").');
    console.warn('Running in fallback mode with simulated AI summarization.\n');
    return generateFallbackSummary(rawData);
  }
}

/**
 * Generate a simulated summary for trial run without API key
 */
function generateFallbackSummary(rawData) {
  console.log('[AI Summarizer] Generating mock/simulated summaries for testing...');
  
  const result = {
    overview: [
      "今日 AI 新闻热点涵盖了 Google News、GitHub Trending 和 Hacker News 等多方渠道。",
      "由于未检测到有效的 LLM 配置，系统已自动切换至试运行模拟汇总模式。",
      "目前已成功接入联网数据源，可正常解析文章标题、链接，并依据点赞和收藏数智能计算了初始热度。"
    ],
    categories: {
      industry: {
        title: "行业巨头 & 产业动态",
        items: []
      },
      research: {
        title: "前沿研究 & 核心模型",
        items: []
      },
      opensource: {
        title: "开源生态 & 开发工具",
        items: []
      },
      ethics: {
        title: "社会伦理 & 热点讨论",
        items: []
      }
    }
  };

  // Process raw data and distribute to mock categories based on keyword rules
  rawData.forEach(item => {
    let cat = 'industry';
    const text = (item.title + ' ' + (item.description || '')).toLowerCase();
    
    if (text.includes('paper') || text.includes('research') || text.includes('study') || text.includes('dataset') || text.includes('math') || text.includes('science')) {
      cat = 'research';
    } else if (item.origin === 'GitHub' || text.includes('github') || text.includes('open source') || text.includes('code') || text.includes('tool') || text.includes('sdk')) {
      cat = 'opensource';
    } else if (text.includes('law') || text.includes('ethics') || text.includes('copyright') || text.includes('regulate') || text.includes('safety') || text.includes('policy')) {
      cat = 'ethics';
    }

    // Estimate hotness score
    let hotness = 50;
    if (item.origin === 'GitHub') {
      hotness = Math.min(100, Math.floor(50 + (item.stars || 0) / 100));
    } else if (item.origin === 'Hacker News') {
      hotness = Math.min(100, Math.floor(40 + (item.points || 0) / 5));
    } else {
      hotness = Math.floor(60 + Math.random() * 30);
    }

    let summaryText = item.description || '无详细描述。';
    if (summaryText.length > 150) {
      summaryText = summaryText.substring(0, 150) + '...';
    }

    result.categories[cat].items.push({
      title: item.title,
      summary: `[源自: ${item.origin}] ${summaryText}`,
      link: item.link,
      hotness: hotness
    });
  });

  // Sort items in each category by hotness descending
  Object.keys(result.categories).forEach(key => {
    result.categories[key].items.sort((a, b) => b.hotness - a.hotness);
    result.categories[key].items = result.categories[key].items.slice(0, 5);
  });

  return result;
}

/**
 * Main function
 */
async function run(options = {}) {
  const dateStr = new Date().toISOString().split('T')[0];
  console.log(`\n========================================`);
  console.log(`🤖 DailyAI Pulse | Task Starting for: ${dateStr}`);
  console.log(`========================================`);

  try {
    // 1. Gather news from all dedicated channels
    const [focusedZh, focusedEn, generalZh, generalEn, hnStories, githubRepos, openAiNews, itHomeNews] = await Promise.all([
      fetchFocusedLabsNews('zh-CN'),
      fetchFocusedLabsNews('en-US'),
      fetchGeneralAINews('zh-CN'),
      fetchGeneralAINews('en-US'),
      fetchHackerNews(),
      fetchGithubTrends(),
      fetchOpenAINews(),
      fetchITHomeNews()
    ]);

    // Priority ordering: Top labs and official feeds first, then general news & community
    const allRaw = [
      ...focusedZh,
      ...focusedEn,
      ...openAiNews,
      ...(itHomeNews || []),
      ...generalZh,
      ...generalEn,
      ...hnStories,
      ...githubRepos
    ];

    // Deduplicate by title similarity
    const seenTitles = new Set();
    const rawData = [];
    for (const item of allRaw) {
      if (!item || !item.title) continue;
      const norm = item.title.toLowerCase().replace(/[\s\-_—|]+/g, '').slice(0, 35);
      if (!seenTitles.has(norm)) {
        seenTitles.add(norm);
        rawData.push(item);
      }
    }

    // Limit to top 65 items to prevent LLM context overflow while retaining all critical releases
    const cappedRawData = rawData.slice(0, 65);
    console.log(`[Scraper] Aggregated ${cappedRawData.length} unique raw items (from ${allRaw.length} total fetched across all channels).`);

    if (cappedRawData.length === 0) {
      console.warn('[Warning] No raw news fetched. Exiting task.');
      return;
    }

    // 2. Perform AI summary & deduplication & hotness evaluation
    const summaryData = await summarizeWithAI(cappedRawData);

    // 2.5 Decode Google News redirect URLs only for the final selected items to save network requests and avoid timeouts!
    console.log('[Scraper] Decoding Google News links for final selected items...');
    if (summaryData && summaryData.categories) {
      for (const catKey of Object.keys(summaryData.categories)) {
        const cat = summaryData.categories[catKey];
        if (cat && cat.items) {
          for (const item of cat.items) {
            if (item.link && item.link.includes('news.google.com/rss/articles/')) {
              console.log(`[Scraper] Decoding final link: "${item.title}"`);
              item.link = await decodeGoogleNewsUrl(item.link);
              // Small stagger delay of 100ms
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }
      }
    }

    // 3. Save to JSON file
    const filePath = path.join(DATA_DIR, `${dateStr}.json`);
    await fs.writeFile(filePath, JSON.stringify(summaryData, null, 2), 'utf-8');
    console.log(`[Success] Saved summarized output to: ${filePath}`);

    // 4. Send email newsletter
    if (options.email !== false) {
      await sendSummaryEmail(summaryData, dateStr);
    } else {
      console.log('[Mailer] Email delivery skipped as per options.');
    }

    console.log(`========================================`);
    console.log(`🤖 DailyAI Pulse | Task Completed Successfully!`);
    console.log(`========================================\n`);
    
    return summaryData;
  } catch (error) {
    console.error('[Error] Critical aggregation task failure:', error);
  }
}

// Check if run directly from CLI
if (process.argv[1] && process.argv[1].endsWith('aggregate.js')) {
  const skipEmail = process.argv.includes('--no-email');
  run({ email: !skipEmail });
}

export { run };
