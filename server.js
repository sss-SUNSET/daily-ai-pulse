import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { run as runAggregator } from './scripts/aggregate.js';
import { sendSummaryEmail } from './scripts/mailer.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve('data');

app.use(cors());
app.use(express.json());

// Serve static frontend files from Vite build folder 'dist'
app.use(express.static(path.resolve('dist')));

// API: Get all dates that have summaries
app.get('/api/summaries', async (req, res) => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const files = await fs.readdir(DATA_DIR);
    
    // Filter out non-JSON files and extract the date part
    const dates = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .sort((a, b) => b.localeCompare(a)); // Newest first
      
    res.json({ success: true, dates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get summary for a specific date
app.get('/api/summary/:date', async (req, res) => {
  const { date } = req.params;
  
  // Basic validation to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' });
  }
  
  const filePath = path.join(DATA_DIR, `${date}.json`);
  
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    res.json({ success: true, data: JSON.parse(data) });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ success: false, error: `Summary for date ${date} not found.` });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// API: Manually trigger aggregation
let isAggregating = false;
app.post('/api/trigger', async (req, res) => {
  const { action = 'all' } = req.body;
  const todayStr = new Date().toISOString().split('T')[0];

  if (isAggregating) {
    return res.status(429).json({ success: false, message: '任务已在运行中，请稍后再试。' });
  }

  if (action === 'email') {
    const filePath = path.join(DATA_DIR, `${todayStr}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const summaryData = JSON.parse(data);
      
      console.log('[Server] Manually triggering email sending for today...');
      
      sendSummaryEmail(summaryData, todayStr)
        .then((success) => {
          console.log(`[Server] Manual email trigger completed. Success: ${success}`);
        })
        .catch(err => {
          console.error('[Server] Manual email trigger failed:', err);
        });

      return res.json({ success: true, message: '已开始发送简报邮件，请稍后检查邮箱。' });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: '今日尚未抓取任何数据，无法发送邮件。请先执行更新。' });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  isAggregating = true;
  console.log(`[Server] Manual aggregation triggered: action=${action}`);

  const runOptions = { email: action === 'all', retries: 1 };

  runAggregator(runOptions)
    .then(() => {
      isAggregating = false;
      console.log(`[Server] Manual aggregation (${action}) completed.`);
    })
    .catch((err) => {
      isAggregating = false;
      console.error('[Server] Manual aggregation failed:', err);
    });

  const msg = action === 'all' 
    ? '更新与发送任务已启动，大约需要 10-30 秒，完成后将自动发送邮件...'
    : '更新数据任务已启动，大约需要 10-30 秒，完成后网页会自动刷新...';

  res.json({ success: true, message: msg });
});

// Fallback for SPA Routing: serve index.html for all other requests
app.get('*', (req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Web interface not built yet. Please build the frontend first.');
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 DailyAI Pulse server running at: http://localhost:${PORT}`);
  console.log(`📁 Saved news directory: ${DATA_DIR}\n`);
});
