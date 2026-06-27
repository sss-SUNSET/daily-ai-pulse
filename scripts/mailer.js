import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Send the summarized AI news email
 * @param {Object} summaryData The summary JSON object
 * @param {string} dateStr The date string (YYYY-MM-DD)
 */
export async function sendSummaryEmail(summaryData, dateStr) {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, RECEIVER_EMAIL } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('\n⚠️ [Mailer] SMTP credentials are not fully configured. Skipping email delivery.');
    console.warn('To enable emails, configure SMTP_HOST, SMTP_USER, and SMTP_PASS in the .env file.\n');
    return false;
  }

  const receiver = RECEIVER_EMAIL || 'xuhongtaooo@outlook.com';

  console.log(`[Mailer] Preparing daily email for ${receiver}...`);

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  // Build HTML Content with premium design
  const htmlContent = buildEmailTemplate(summaryData, dateStr);

  try {
    const info = await transporter.sendMail({
      from: `"DailyAI Pulse" <${SMTP_USER}>`,
      to: receiver,
      subject: `🤖 DailyAI Pulse | AI 热点简报 (${dateStr})`,
      html: htmlContent,
    });
    console.log(`[Mailer] Email sent successfully! Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[Mailer] Error sending email:', error.message);
    return false;
  }
}

function buildEmailTemplate(data, dateStr) {
  // --- DESKTOP VIEW (Grouped by Categories) ---
  const categoriesList = Object.entries(data.categories || {});
  let categoriesHtml = '';
  
  for (const [key, category] of categoriesList) {
    if (!category.items || category.items.length === 0) continue;
    
    categoriesHtml += `
      <div style="margin-bottom: 30px; background-color: #1a1e29; border-radius: 12px; padding: 20px; border: 1px solid #2e364f;">
        <h3 style="color: #6366f1; font-size: 18px; margin-top: 0; margin-bottom: 15px; border-bottom: 2px solid #2e364f; padding-bottom: 8px; font-weight: 600;">
          📂 ${category.title}
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
    `;
    
    category.items.forEach((item, index) => {
      let flames = '🔥';
      if (item.hotness > 85) flames = '🔥🔥🔥';
      else if (item.hotness > 60) flames = '🔥🔥';

      categoriesHtml += `
        <tr style="border-bottom: ${index === category.items.length - 1 ? 'none' : '1px solid #232a3d'};">
          <td style="padding: 15px 0;">
            <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: bold; font-size: 16px; color: #f3f4f6;">
                ${item.title}
              </span>
              <span style="background-color: #ef444422; color: #f87171; font-size: 12px; padding: 2px 8px; border-radius: 20px; font-weight: 500; white-space: nowrap; margin-left: 10px; border: 1px solid #ef444433;">
                ${flames} 热度: ${item.hotness}
              </span>
            </div>
            <p style="color: #9ca3af; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
              ${item.summary}
            </p>
            ${item.link ? `
              <a href="${item.link}" target="_blank" style="color: #818cf8; font-size: 13px; text-decoration: none; font-weight: 500;">
                查看原文 →
              </a>
            ` : ''}
          </td>
        </tr>
      `;
    });
    
    categoriesHtml += `
        </table>
      </div>
    `;
  }

  // --- MOBILE VIEW (Flat List sorted by Hotness) ---
  let allItems = [];
  Object.entries(data.categories || {}).forEach(([key, category]) => {
    if (category.items) {
      category.items.forEach(item => {
        allItems.push({
          ...item,
          categoryTitle: category.title.split(' ')[0] || category.title
        });
      });
    }
  });
  // Sort all items by hotness descending
  allItems.sort((a, b) => b.hotness - a.hotness);

  let mobileHtml = `
    <!--[if !mso]><!-->
    <div class="mobile-view" style="display: none; max-height: 0px; overflow: hidden; mso-hide: all;">
      <div style="background-color: #1a1e29; border-radius: 12px; padding: 12px; border: 1px solid #2e364f; margin-bottom: 20px;">
        <h3 style="color: #6366f1; font-size: 16px; margin-top: 0; margin-bottom: 12px; border-bottom: 2px solid #2e364f; padding-bottom: 8px; font-weight: 700; text-align: center;">
          🔥 今日热度总览 (从高到低)
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; table-layout: fixed;">
  `;

  allItems.forEach((item, index) => {
    let flames = '🔥';
    if (item.hotness > 85) flames = '🔥🔥';
    else if (item.hotness > 60) flames = '🔥';

    mobileHtml += `
      <tr style="border-bottom: ${index === allItems.length - 1 ? 'none' : '1px solid #232a3d'};">
        <td style="padding: 12px 0; word-wrap: break-word;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="background-color: #3b82f622; color: #60a5fa; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: bold; display: inline-block; margin-bottom: 6px;">
                  ${item.categoryTitle}
                </span>
                <span style="background-color: #ef44441a; color: #f87171; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: bold; display: inline-block; float: right;">
                  ${flames} 热度: ${item.hotness}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 4px;">
                <div style="font-weight: 700; font-size: 14px; color: #ffffff; line-height: 1.35; margin-bottom: 6px;">
                  ${item.title}
                </div>
                <p style="color: #9ca3af; font-size: 12px; line-height: 1.45; margin: 0 0 8px 0; text-align: justify;">
                  ${item.summary}
                </p>
                ${item.link ? `
                  <a href="${item.link}" target="_blank" style="color: #818cf8; font-size: 11px; text-decoration: none; font-weight: bold;">
                    查看原文 →
                  </a>
                ` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  });

  mobileHtml += `
        </table>
      </div>
    </div>
    <!--<![endif]-->
  `;

  // --- OVERVIEW SECTION ---
  let overviewHtml = '';
  if (data.overview && data.overview.length > 0) {
    overviewHtml = `
      <div class="overview-box" style="background: linear-gradient(135deg, #3b82f61a 0%, #818cf81a 100%); border: 1px solid #4f46e544; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
        <h3 class="overview-title" style="color: #818cf8; font-size: 18px; margin-top: 0; margin-bottom: 12px; font-weight: 600;">✨ 今日速览 (Overview)</h3>
        <ul style="margin: 0; padding-left: 20px; color: #d1d5db; font-size: 15px; line-height: 1.7;">
          ${data.overview.map(bullet => `<li class="overview-bullet" style="margin-bottom: 8px;">${bullet}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>DailyAI Pulse</title>
      <style>
        /* CSS Media Queries for Mobile Email Clients */
        @media only screen and (max-width: 600px) {
          .desktop-view {
            display: none !important;
            max-height: 0px !important;
            overflow: hidden !important;
            mso-hide: all !important;
            width: 0 !important;
          }
          .mobile-view {
            display: block !important;
            max-height: none !important;
            overflow: visible !important;
            width: 100% !important;
          }
          .main-table {
            border-radius: 8px !important;
            border: none !important;
          }
          .header-td {
            padding: 20px 10px !important;
          }
          .header-title {
            font-size: 22px !important;
          }
          .header-subtitle {
            font-size: 12px !important;
          }
          .content-td {
            padding: 12px 10px !important;
          }
          .overview-box {
            padding: 12px !important;
            margin-bottom: 20px !important;
          }
          .overview-title {
            font-size: 15px !important;
          }
          .overview-bullet {
            font-size: 12px !important;
            line-height: 1.4 !important;
            margin-bottom: 6px !important;
          }
        }
      </style>
    </head>
    <body style="background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 10px; color: #f3f4f6;">
      <table class="main-table" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 650px; margin: 0 auto; background-color: #0f172a; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
        <!-- Header -->
        <tr>
          <td class="header-td" style="background: linear-gradient(90deg, #312e81 0%, #1e1b4b 100%); padding: 30px 20px; text-align: center; border-bottom: 1px solid #2e364f;">
            <h1 class="header-title" style="color: #ffffff; font-size: 28px; margin: 0; font-weight: 800; letter-spacing: 1px;">🤖 DailyAI Pulse</h1>
            <p class="header-subtitle" style="color: #a5b4fc; font-size: 14px; margin: 8px 0 0 0; letter-spacing: 0.5px;">
              您的每日人工智能新闻与热点摘要 • ${dateStr}
            </p>
          </td>
        </tr>
        
        <!-- Content -->
        <tr>
          <td class="content-td" style="padding: 24px 20px;">
            ${overviewHtml}
            
            <!-- Desktop Layout -->
            <div class="desktop-view">
              ${categoriesHtml}
            </div>
            
            <!-- Mobile Layout -->
            ${mobileHtml}
          </td>
        </tr>
        
        <!-- Footer -->
        <tr>
          <td style="background-color: #0b0f19; padding: 20px; text-align: center; border-top: 1px solid #1e293b;">
            <p style="color: #6b7280; font-size: 11px; margin: 0 0 5px 0;">
              此邮件由 DailyAI Pulse 自动化系统于每天上午 9 点发送。
            </p>
            <p style="color: #6b7280; font-size: 11px; margin: 0;">
              本地服务运行地址：<a href="http://localhost:3000" style="color: #6366f1; text-decoration: none;">http://localhost:3000</a>
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}
