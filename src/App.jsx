import React, { useState, useEffect } from 'react';
import { 
  Flame, Calendar, Search, RefreshCw, BookOpen, 
  Terminal, ShieldAlert, ExternalLink, Sparkles, Check, Mail,
  Sun, Moon, Cloud, Database
} from 'lucide-react';
import './App.css';

function getBeijingDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function isJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  return response.ok && contentType.includes('application/json');
}

export default function App() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isStaticMode, setIsStaticMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [theme, setTheme] = useState('light');

  // Load theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // Fetch dates on mount
  useEffect(() => {
    fetchDates();
  }, []);

  // Fetch summary when selected date changes
  useEffect(() => {
    if (selectedDate) {
      fetchSummary(selectedDate);
    } else {
      setSummaryData(null);
    }
  }, [selectedDate]);

  const fetchDates = async (selectLatest = true) => {
    setLoading(true);
    try {
      let data = null;
      let staticFallback = isStaticMode;

      if (!staticFallback) {
        try {
          const response = await fetch('./api/summaries');
          if (isJsonResponse(response)) {
            data = await response.json();
            setIsStaticMode(false);
          } else {
            staticFallback = true;
          }
        } catch {
          staticFallback = true;
        }
      }

      if (staticFallback) {
        const staticRes = await fetch(`./data/index.json?t=${Date.now()}`);
        if (isJsonResponse(staticRes)) {
          data = await staticRes.json();
          setIsStaticMode(true);
        }
      }

      if (data && data.success && data.dates && data.dates.length > 0) {
        setDates(data.dates);
        if (selectLatest) {
          setSelectedDate(data.dates[0]);
        }
      } else {
        setDates([]);
        setSelectedDate('');
      }
    } catch (err) {
      showMsg('获取日期列表失败，请检查数据服务是否正常', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async (date) => {
    setLoading(true);
    try {
      let data = null;

      if (!isStaticMode) {
        try {
          const response = await fetch(`./api/summary/${date}`);
          if (isJsonResponse(response)) {
            data = await response.json();
          }
        } catch {
          // Fall back to static JSON archive
        }
      }

      if (!data) {
        const staticRes = await fetch(`./data/${date}.json`);
        if (isJsonResponse(staticRes)) {
          const rawJson = await staticRes.json();
          data = { success: true, data: rawJson };
          setIsStaticMode(true);
        } else {
          data = { success: false, error: 'Archive file not found' };
        }
      }

      if (data.success) {
        setSummaryData(data.data);
      } else {
        showMsg(`获取 ${date} 数据失败: ${data.error}`, 'error');
        setSummaryData(null);
      }
    } catch (err) {
      showMsg('加载简报数据失败', 'error');
      setSummaryData(null);
    } finally {
      setLoading(false);
    }
  };

  const triggerSync = async (action = 'all') => {
    if (syncing) return;
    setSyncing(true);
    
    let infoMsg = '正在获取最新 AI 热点并进行 AI 摘要，请稍候...';
    if (action === 'update') {
      infoMsg = '正在更新今日 AI 数据，请稍候...';
    } else if (action === 'email') {
      infoMsg = '正在准备发送今日简报邮件，请稍候...';
    }
    
    showMsg(infoMsg, 'info');
    
    try {
      const response = await fetch('/api/trigger', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await response.json();
      
      if (data.success) {
        if (action === 'email') {
          setSyncing(false);
          showMsg('已成功发出简报邮件，请检查您的收件箱！', 'success');
          return;
        }

        // Poll for the dates updates every 3 seconds, up to 10 times
        let attempts = 0;
        const todayStr = getBeijingDateStr();
        
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const res = await fetch('/api/summaries');
            const d = await res.json();
            if (d.success && (d.dates.includes(todayStr) || attempts >= 10)) {
              clearInterval(pollInterval);
              setSyncing(false);
              showMsg(action === 'all' ? '数据同步并完成 AI 摘要！已自动向您的邮箱发送了一份简报。' : '数据更新成功！', 'success');
              fetchDates(false); // Update list
              setSelectedDate(todayStr); // Focus on today
            }
          } catch (e) {
            // ignore err in polling
          }
          if (attempts >= 10) {
            clearInterval(pollInterval);
            setSyncing(false);
            showMsg('数据抓取时间较长，已在后台运行，请刷新页面查看。', 'info');
            fetchDates(true);
          }
        }, 3000);
      } else {
        showMsg(`操作失败: ${data.message || data.error || '未知错误'}`, 'error');
        setSyncing(false);
      }
    } catch (err) {
      showMsg('连接服务器失败', 'error');
      setSyncing(false);
    }
  };

  const showMsg = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => {
      setMessage({ text: '', type: '' });
    }, 6000);
  };

  // Filter items based on active tab and search query
  const getFilteredItems = () => {
    if (!summaryData) return [];
    
    let allItems = [];
    const catKeys = Object.keys(summaryData.categories || {});
    
    catKeys.forEach(key => {
      const cat = summaryData.categories[key];
      const itemsWithCat = (cat.items || []).map(item => ({
        ...item,
        categoryKey: key,
        categoryTitle: cat.title
      }));
      allItems = [...allItems, ...itemsWithCat];
    });

    // Filter by tab
    if (activeTab !== 'all') {
      allItems = allItems.filter(item => item.categoryKey === activeTab);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      allItems = allItems.filter(item => 
        item.title.toLowerCase().includes(q) || 
        item.summary.toLowerCase().includes(q)
      );
    }

    // Sort by hotness descending
    return allItems.sort((a, b) => b.hotness - a.hotness);
  };

  const filteredItems = getFilteredItems();

  const getCategoryIcon = (key) => {
    switch (key) {
      case 'industry': return <Sparkles size={16} className="text-primary" />;
      case 'research': return <BookOpen size={16} className="text-success" />;
      case 'opensource': return <Terminal size={16} className="text-accent" />;
      case 'ethics': return <ShieldAlert size={16} className="text-warning" />;
      default: return <Sparkles size={16} />;
    }
  };

  const getHotnessBadge = (score) => {
    let type = 'low';
    let flames = '🔥';
    
    if (score > 85) {
      type = 'high';
      flames = '🔥🔥🔥';
    } else if (score > 60) {
      type = 'medium';
      flames = '🔥🔥';
    }

    return (
      <span className={`hotness-badge ${type}`}>
        <span className="flame-emoji">{flames}</span> 热度 {score}
      </span>
    );
  };

  return (
    <div className="app-layout">
      {/* Date Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">🤖</div>
          <div className="brand-info">
            <h2>DailyAI Pulse</h2>
            <span>每日 AI 新闻 & 热点</span>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>
            <Calendar size={14} /> 往期概览
          </h3>
          <div className="date-list">
            {dates.length === 0 ? (
              <div className="empty-sidebar">暂无汇总数据</div>
            ) : (
              dates.map(d => (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className={`date-item ${selectedDate === d ? 'active' : ''}`}
                >
                  <span className="date-dot"></span>
                  <span className="date-text">{d}</span>
                </button>
              ))
            )}
          </div>
        </div>
        
        <div className="sidebar-footer">
          {isStaticMode ? (
            <>
              <div className="mail-info">
                <Database size={14} />
                <span>在线归档库状态:</span>
              </div>
              <div className="mail-addr">共 {dates.length} 期 · 每日 08:10 自动同步</div>
            </>
          ) : (
            <>
              <div className="mail-info">
                <Mail size={14} />
                <span>简报订阅邮箱:</span>
              </div>
              <div className="mail-addr">xuhongtaooo@outlook.com</div>
            </>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Header */}
        <header className="main-header">
          <div className="header-meta">
            <h1 className="header-title">AI 简报</h1>
            <span className="header-subtitle">{selectedDate || '选择日期'}</span>
          </div>
          
          <div className="header-actions">
            {message.text && (
              <div className={`notification-bubble ${message.type}`}>
                {message.type === 'success' && <Check size={14} style={{ marginRight: 4 }} />}
                {message.text}
              </div>
            )}
            <div className="button-group" style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                onClick={toggleTheme} 
                className="btn btn-secondary"
                title={theme === 'light' ? '切换到暗黑模式' : '切换到明亮模式'}
                style={{ padding: '0.75rem', minWidth: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
              {isStaticMode ? (
                <>
                  <span className="static-status-pill" title="已托管至 GitHub Pages，每天定时自动抓新并发布">
                    <Cloud size={14} />
                    云端每日自动更新
                  </span>
                  <button
                    onClick={() => fetchDates(true)}
                    disabled={loading}
                    className="btn btn-primary"
                    title="重新加载最新已归档简报"
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    刷新简报
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => triggerSync('update')} 
                    disabled={syncing} 
                    className="btn btn-secondary"
                    title="仅从网络抓取最新新闻，不发送邮件"
                  >
                    <RefreshCw size={14} className={syncing && message.text?.includes('数据') ? 'animate-spin' : ''} />
                    仅更新数据
                  </button>
                  <button 
                    onClick={() => triggerSync('email')} 
                    disabled={syncing} 
                    className="btn btn-secondary"
                    title="将已抓取的今日摘要发送至您的邮箱"
                  >
                    <Mail size={14} />
                    仅发送邮件
                  </button>
                  <button 
                    onClick={() => triggerSync('all')} 
                    disabled={syncing} 
                    className="btn btn-primary"
                    title="抓取最新数据并自动发送邮件"
                  >
                    <RefreshCw size={14} className={syncing && message.text?.includes('AI 热点') ? 'animate-spin' : ''} />
                    更新 & 发送邮件
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content Body */}
        <div className="content-body">
          {loading && !syncing ? (
            <div className="skeleton-container">
              <div className="skeleton skeleton-title"></div>
              <div className="skeleton skeleton-bullet"></div>
              <div className="skeleton skeleton-bullet"></div>
              <div className="skeleton skeleton-card"></div>
              <div className="skeleton skeleton-card"></div>
            </div>
          ) : !summaryData ? (
            <div className="empty-state">
              <Sparkles size={48} className="empty-icon text-primary animate-pulse" />
              <h3>没有找到数据</h3>
              <p>
                {isStaticMode
                  ? '暂无已归档的简报数据，请点击下方按钮重新加载。'
                  : '请点击上面的“更新”或“更新 & 发送邮件”按钮，抓取今日最新的 AI 行业动态和热度分析。'}
              </p>
              <button
                onClick={() => (isStaticMode ? fetchDates(true) : triggerSync('all'))}
                className="btn btn-primary mt-4"
              >
                <RefreshCw size={16} /> {isStaticMode ? '重新加载' : '立即抓取'}
              </button>
            </div>
          ) : (
            <div className="dashboard-grid">
              {/* Daily Highlights Overview */}
              {summaryData.overview && summaryData.overview.length > 0 && (
                <section className="overview-section animate-fade-in">
                  <div className="overview-title">
                    <Sparkles size={18} className="text-primary animate-pulse" />
                    <h2>今日速览 / Core Takeaways</h2>
                  </div>
                  <ul className="overview-bullets">
                    {summaryData.overview.map((bullet, idx) => (
                      <li key={idx} className="overview-bullet-item">
                        <span className="bullet-num">0{idx + 1}</span>
                        <p>{bullet}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Toolbar */}
              <div className="toolbar-container animate-fade-in">
                {/* Search Bar */}
                <div className="search-bar">
                  <Search size={16} className="search-icon" />
                  <input
                    type="text"
                    placeholder="搜索今日摘要标题或内容..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {/* Filter Tabs */}
                <div className="tabs-list">
                  <button 
                    onClick={() => setActiveTab('all')} 
                    className={`tab-item ${activeTab === 'all' ? 'active' : ''}`}
                  >
                    全部热点
                  </button>
                  {Object.entries(summaryData.categories || {}).map(([key, cat]) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`tab-item ${activeTab === key ? 'active' : ''}`}
                    >
                      {getCategoryIcon(key)}
                      {cat.title.split(' ')[0] || cat.title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feed Card Grid */}
              <div className="feed-grid">
                {filteredItems.length === 0 ? (
                  <div className="empty-feed">
                    <p>没有找到匹配的新闻或项目</p>
                  </div>
                ) : (
                  filteredItems.map((item, index) => (
                    <article 
                      key={index} 
                      className={`feed-card ${item.hotness > 85 ? 'glow-card-accent' : ''} animate-fade-in`}
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      <div className="card-header">
                        <div className={`card-cat ${item.categoryKey}`}>
                          {getCategoryIcon(item.categoryKey)}
                          <span>{item.categoryTitle}</span>
                        </div>
                        {getHotnessBadge(item.hotness)}
                      </div>
                      
                      <h3 className="card-title">{item.title}</h3>
                      <p className="card-summary">{item.summary}</p>
                      
                      {item.link && (
                        <div className="card-footer">
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="card-link">
                            查看原始来源 <ExternalLink size={12} />
                          </a>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
