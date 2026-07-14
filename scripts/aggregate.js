import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { sendSummaryEmail } from './mailer.js';

dotenv.config();

// Configure local proxy if specified in .env
if (process.env.HTTPS_PROXY) {
  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    axios.defaults.httpsAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    console.log(`[Proxy] Global HTTPS agent configured using proxy: ${process.env.HTTPS_PROXY}`);
  } catch (err) {
    console.warn('[Proxy] Failed to load HttpsProxyAgent:', err.message);
  }
}

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
      timeout: 30000,
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
        timeout: 30000,
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
 * Fetch Google News RSS for AI topics
 * @param {string} lang 'zh-CN' or 'en-US'
 */
async function fetchGoogleNews(lang = 'zh-CN') {
  const query = encodeURIComponent(lang === 'zh-CN' ? '人工智能 OR AI OR 大模型 OR "智能体" OR "Agent" OR "新模型"' : 'AI OR LLM OR "Generative AI" OR "AI Agent" OR "new model"');
  const ceid = lang === 'zh-CN' ? 'CN:zh-Hans' : 'US:en';
  const gl = lang === 'zh-CN' ? 'CN' : 'US';
  const hl = lang === 'zh-CN' ? 'zh-CN' : 'en-US';
  
  const url = `https://news.google.com/rss/search?q=${query}+when:1d&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  
  try {
    console.log(`[Scraper] Fetching Google News RSS (${lang})...`);
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const result = await parseStringPromise(response.data);
    const items = result.rss.channel[0].item || [];
    
    // We only keep the top 25 items to optimize performance and tokens
    const topItems = items.slice(0, 25);
    
    console.log(`[Scraper] Processing ${topItems.length} Google News URLs (${lang})...`);
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
          mappedItems.push(textAlt);
          continue;
        }
      }
      
      mappedItems.push({
        title: originalTitle,
        link: originalLink,
        pubDate: item.pubDate[0],
        source: item.source[0]._ || item.source[0],
        description: item.description ? item.description[0].replace(/<[^>]*>/g, '') : '',
        origin: 'Google News',
        type: 'news'
      });
    }
    return mappedItems;
  } catch (error) {
    console.error(`[Scraper] Error fetching Google News RSS (${lang}):`, error.message);
    return [];
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
    const response = await axios.get(url);
    const hits = response.data.hits || [];
    
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
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    const items = response.data.items || [];
    
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
 * Run the summary through LLM (Gemini or OpenAI compatible)
 */
async function summarizeWithAI(rawData) {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  
  const systemPrompt = `你是一个专业的 AI 领域科技分析师和编辑。请对以下收集到的新闻和项目数据进行：
1. **去重与合并**：将多份媒体报道的同一个新闻事件合并为一个。
2. **分类**：将所有新闻/项目分类到以下四个板块：
   - \`industry\` (行业巨头 & 产业动态)：包括微软、OpenAI、Google、Meta、Nvidia等公司的动态，商业合作，行业收购，市场动态。
   - \`research\` (前沿研究 & 核心模型)：最新的学术论文，新发布的模型，算法突破，前沿研究发现。
   - \`opensource\` (开源生态 & 开发工具)：GitHub热门项目，开源框架，开发辅助工具，开发者社群动向。
   - \`ethics\` (社会伦理 & 热点讨论)：AI安全性，伦理争议，版权诉讼，政策监管，以及社区和学术界的热点话题讨论。
3. **翻译与摘要**：全部翻译为中文。为合并后的每个条目写 1-2 句极其精炼、易懂的中文摘要，突出要点。
4. **热度评估 (1-100)**：综合考量其在各平台曝光度（如HN Upvotes, GitHub Stars, 媒体转载量等）以及该新闻自身的突破性程度，给出一个 1-100 之间的热度指数。
5. **重点偏好（新模型与智能体）**：
   - 我们重点关注：**国内外各家 AI 巨头/初创公司（如 OpenAI, Google, Anthropic, DeepSeek, 智谱 AI, 月之暗面, 字节跳动等）动态、AI Agent（智能体）技术和应用开发、以及任何新模型发布（如大语言模型、多模态模型、推理模型等）的消息**。
   - 对符合上述重点的新闻，应**优先予以保留并大幅提升其热度值 (Hotness)**。如果当天有重大新模型发布或突出的 Agent 动态，确保它们在 \`overview\` (今日速览) 中置顶，且其 \`hotness\` 评分应偏高（例如 90-100）。
6. **强一致性要求**：在 \`overview\` (今日最值得关注的 top 3 核心洞察或趋势) 中提到的所有事件或新闻，**必须且只能**在下面 \`categories\` 对应的某个分类 items 中有相对应的具体卡片（包含匹配的 title 和 link）。绝不允许出现“今日速览”里提到了该新闻，但下方详情卡片里完全找不到该卡片的情况！`;

  const userPrompt = `输入数据 (JSON 格式):
${JSON.stringify(rawData, null, 2)}

请严格返回以下 JSON 格式（不要包含 markdown 代码块包裹，直接输出 JSON 字符串。如果你必须使用 markdown，确保可以直接解析为 JSON。请保持返回类型为 Content-Type: application/json 对应的标准 JSON 对象）：
{
  "overview": [
    "今日最值得关注的 top 3 核心洞察或趋势（中文，每条一行）"
  ],
  "categories": {
    "industry": {
      "title": "行业巨头 & 产业动态",
      "items": [
        { "title": "合并后的新闻标题", "summary": "1-2句的核心中文摘要", "link": "最相关的原始来源链接", "hotness": 95 }
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

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';

    if (!apiKey) {
      console.warn('\n⚠️ [AI Summarizer] LLM_PROVIDER is set to "openai" but OPENAI_API_KEY is not configured in .env.');
      console.warn('Running in fallback mode with simulated AI summarization.\n');
      return generateFallbackSummary(rawData);
    }

    console.log(`[AI Summarizer] Calling OpenAI-compatible API (${baseUrl}) using model ${modelName}...`);
    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 120000
        }
      );

      let text = response.data.choices[0].message.content;
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      try {
        const parsedData = JSON.parse(text);
        return parsedData;
      } catch (parseError) {
        console.error('[AI Summarizer] JSON parsing error. Raw content returned by LLM was:');
        console.error(text);
        throw parseError;
      }
    } catch (error) {
      console.error('[AI Summarizer] Error calling OpenAI-compatible API:', error.response?.data || error.message);
      console.log('[AI Summarizer] Falling back to simulated summarization.');
      return generateFallbackSummary(rawData);
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
      return parsedData;
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
    // 1. Gather news from all sources
    const [gNewsZh, gNewsEn, hnStories, githubRepos, openAiNews] = await Promise.all([
      fetchGoogleNews('zh-CN'),
      fetchGoogleNews('en-US'),
      fetchHackerNews(),
      fetchGithubTrends(),
      fetchOpenAINews()
    ]);

    // Slice raw inputs to avoid sending too many tokens, preventing API timeouts
    const slicedGNewsZh = gNewsZh.slice(0, 25);
    const slicedGNewsEn = gNewsEn.slice(0, 25);
    const slicedHn = hnStories.slice(0, 15);
    const slicedGithub = githubRepos.slice(0, 15);
    const slicedOpenAI = openAiNews.slice(0, 5);

    const rawData = [
      ...slicedGNewsZh,
      ...slicedGNewsEn,
      ...slicedHn,
      ...slicedGithub,
      ...slicedOpenAI
    ];
    console.log(`[Scraper] Aggregated ${rawData.length} raw news items from all sources.`);

    if (rawData.length === 0) {
      console.warn('[Warning] No raw news fetched. Exiting task.');
      return;
    }

    // 2. Perform AI summary & deduplication & hotness evaluation
    const summaryData = await summarizeWithAI(rawData);

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
