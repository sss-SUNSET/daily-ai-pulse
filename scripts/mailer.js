import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import dns from 'dns/promises';

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

  // Resolve hostname via OS DNS lookup to avoid queryA ETIMEOUT in custom DNS environments
  let resolvedHost = SMTP_HOST;
  try {
    const { address } = await dns.lookup(SMTP_HOST);
    resolvedHost = address;
  } catch (lookupErr) {
    console.warn(`[Mailer] DNS lookup for ${SMTP_HOST} warning:`, lookupErr.message);
  }

  // Function to create a transporter for a specific port/secure configuration
  const buildTransporter = (portNum, isSecure) => nodemailer.createTransport({
    host: resolvedHost,
    port: portNum,
    secure: isSecure,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      servername: SMTP_HOST,
      rejectUnauthorized: false
    },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });

  // Build HTML Content with premium design
  const htmlContent = buildEmailTemplate(summaryData, dateStr);

  const initialPort = parseInt(SMTP_PORT || '587', 10);
  const initialSecure = SMTP_SECURE === 'true';
  const portsToTry = [
    { port: initialPort, secure: initialSecure },
    { port: initialPort === 587 ? 465 : 587, secure: initialPort === 587 ? true : false },
    { port: 587, secure: false }
  ];

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { port, secure } = portsToTry[attempt - 1] || portsToTry[0];
    const transporter = buildTransporter(port, secure);
    try {
      console.log(`[Mailer] Attempting delivery (Attempt ${attempt}/${maxRetries}) via ${SMTP_HOST}:${port} (secure: ${secure})...`);
      const info = await transporter.sendMail({
        from: `"DailyAI Pulse" <${SMTP_USER}>`,
        to: receiver,
        subject: `🤖 DailyAI Pulse | AI 热点简报 (${dateStr})`,
        html: htmlContent,
      });
      console.log(`[Mailer] Email sent successfully! Message ID: ${info.messageId}`);
      return true;
    } catch (error) {
      console.warn(`[Mailer] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        const delayMs = attempt * 3000;
        console.log(`[Mailer] Retrying email delivery in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error('[Mailer] All email delivery attempts failed.');
        return false;
      }
    }
  }
}

function getCategoryStyle(key) {
  switch (key) {
    case 'industry':
      return 'background-color: #ECE9FE; color: #5B21B6; border: 1px solid rgba(139, 92, 246, 0.2);';
    case 'research':
      return 'background-color: #ECFDF5; color: #065F46; border: 1px solid rgba(16, 185, 129, 0.2);';
    case 'opensource':
      return 'background-color: #F0F9FF; color: #075985; border: 1px solid rgba(14, 165, 233, 0.2);';
    case 'ethics':
      return 'background-color: #FEF3C7; color: #92400E; border: 1px solid rgba(245, 158, 11, 0.2);';
    default:
      return 'background-color: #E8F0FE; color: #5C85E6; border: 1px solid rgba(92, 133, 230, 0.2);';
  }
}

function getHotnessStyle(score) {
  if (score > 85) {
    return 'background-color: #FEE2E2; color: #DC2626; border: 1px solid rgba(239, 68, 68, 0.25);';
  } else if (score > 60) {
    return 'background-color: #FEF3C7; color: #D97706; border: 1px solid rgba(245, 158, 11, 0.25);';
  } else {
    return 'background-color: #ECFDF5; color: #059669; border: 1px solid rgba(16, 185, 129, 0.25);';
  }
}

function buildEmailTemplate(data, dateStr) {
  // --- DESKTOP VIEW (Grouped by Categories) ---
  const categoriesList = Object.entries(data.categories || {});
  let categoriesHtml = '';
  
  for (const [key, category] of categoriesList) {
    if (!category.items || category.items.length === 0) continue;
    
    const catStyle = getCategoryStyle(key);
    
    categoriesHtml += `
      <div style="margin-bottom: 30px; background-color: #EBF1F6; border-radius: 16px; padding: 24px; border: 1px solid rgba(163, 177, 198, 0.35); box-shadow: 4px 4px 10px rgba(163, 177, 198, 0.15), -4px -4px 10px rgba(255, 255, 255, 0.8);">
        <div style="margin-bottom: 18px; border-bottom: 1px solid rgba(163, 177, 198, 0.25); padding-bottom: 10px;">
          <span style="font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 20px; display: inline-block; ${catStyle}">
            ${category.title}
          </span>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
    `;
    
    category.items.forEach((item, index) => {
      let flames = '🔥';
      if (item.hotness > 85) flames = '🔥🔥🔥';
      else if (item.hotness > 60) flames = '🔥🔥';

      const hotStyle = getHotnessStyle(item.hotness);

      categoriesHtml += `
        <tr style="border-bottom: ${index === category.items.length - 1 ? 'none' : '1px solid rgba(163, 177, 198, 0.2)'};">
          <td style="padding: 18px 0;">
            <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 800; font-size: 16px; color: #2D3748; font-family: 'Space Grotesk', -apple-system, sans-serif;">
                ${item.title}
              </span>
              <span style="font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 700; white-space: nowrap; margin-left: 10px; display: inline-block; ${hotStyle}">
                ${flames} 热度: ${item.hotness}
              </span>
            </div>
            <p style="color: #5A6A85; font-size: 14px; line-height: 1.65; margin: 0 0 12px 0;">
              ${item.summary}
            </p>
            ${item.link ? `
              <a href="${item.link}" target="_blank" style="color: #5C85E6; background-color: #E8F0FE; border: 1px solid rgba(92, 133, 230, 0.2); padding: 4px 10px; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 700; display: inline-block; box-shadow: 2px 2px 5px rgba(163, 177, 198, 0.15), -2px -2px 5px rgba(255, 255, 255, 0.8);">
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
          categoryKey: key,
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
      <div style="background-color: #EBF1F6; border-radius: 16px; padding: 16px; border: 1px solid rgba(163, 177, 198, 0.35); margin-bottom: 25px; box-shadow: 4px 4px 10px rgba(163, 177, 198, 0.15), -4px -4px 10px rgba(255, 255, 255, 0.8);">
        <h3 style="color: #5C85E6; font-size: 16px; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid rgba(163, 177, 198, 0.25); padding-bottom: 8px; font-weight: 800; text-align: center; font-family: 'Space Grotesk', -apple-system, sans-serif;">
          🔥 今日热度总览 (从高到低)
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; table-layout: fixed;">
  `;

  allItems.forEach((item, index) => {
    let flames = '🔥';
    if (item.hotness > 85) flames = '🔥🔥';
    else if (item.hotness > 60) flames = '🔥';

    const catStyle = getCategoryStyle(item.categoryKey);
    const hotStyle = getHotnessStyle(item.hotness);

    mobileHtml += `
      <tr style="border-bottom: ${index === allItems.length - 1 ? 'none' : '1px solid rgba(163, 177, 198, 0.2)'};">
        <td style="padding: 14px 0; word-wrap: break-word;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; margin-bottom: 6px; ${catStyle}">
                  ${item.categoryTitle}
                </span>
                <span style="font-size: 9px; padding: 2px 6px; border-radius: 10px; font-weight: 700; display: inline-block; float: right; ${hotStyle}">
                  ${flames} 热度: ${item.hotness}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 4px;">
                <div style="font-weight: 800; font-size: 14px; color: #2D3748; line-height: 1.35; margin-bottom: 6px; font-family: 'Space Grotesk', -apple-system, sans-serif;">
                  ${item.title}
                </div>
                <p style="color: #5A6A85; font-size: 12.5px; line-height: 1.5; margin: 0 0 10px 0; text-align: justify;">
                  ${item.summary}
                </p>
                ${item.link ? `
                  <a href="${item.link}" target="_blank" style="color: #5C85E6; background-color: #E8F0FE; border: 1px solid rgba(92, 133, 230, 0.2); padding: 4px 8px; border-radius: 4px; text-decoration: none; font-size: 11px; font-weight: 700; display: inline-block;">
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
      <div class="overview-box" style="background-color: #EBF1F6; border: 1px solid rgba(163, 177, 198, 0.35); border-left: 5px solid #5C85E6; border-radius: 16px; padding: 20px; margin-bottom: 30px; box-shadow: 4px 4px 10px rgba(163, 177, 198, 0.15), -4px -4px 10px rgba(255, 255, 255, 0.8);">
        <h3 class="overview-title" style="color: #2D3748; font-size: 18px; margin-top: 0; margin-bottom: 12px; font-weight: 800; font-family: 'Space Grotesk', -apple-system, sans-serif;">✨ 今日速览 (Overview)</h3>
        <ul style="margin: 0; padding-left: 20px; color: #5A6A85; font-size: 14.5px; line-height: 1.7; font-weight: 500;">
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
            padding: 30px 10px 15px 10px !important;
          }
          .header-title {
            font-size: 26px !important;
          }
          .header-subtitle {
            font-size: 11px !important;
            margin-top: 8px !important;
          }
          .content-td {
            padding: 16px 10px !important;
          }
          .overview-box {
            padding: 16px !important;
            margin-bottom: 20px !important;
          }
          .overview-title {
            font-size: 15px !important;
          }
          .overview-bullet {
            font-size: 13px !important;
            line-height: 1.5 !important;
            margin-bottom: 6px !important;
          }
        }
      </style>
    </head>
    <body style="background-color: #EBF1F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 10px; color: #2D3748;">
      <table class="main-table" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 650px; margin: 0 auto; background-color: #EBF1F6; border-radius: 20px; overflow: hidden; border: 1px solid rgba(163, 177, 198, 0.35); box-shadow: 6px 6px 20px rgba(163, 177, 198, 0.2), -6px -6px 20px rgba(255, 255, 255, 0.8);">
        <!-- Header -->
        <tr>
          <td class="header-td" style="background-color: #EBF1F6; padding: 40px 20px 20px 20px; text-align: center; border-bottom: 1px solid rgba(163, 177, 198, 0.25);">
            <h1 class="header-title" style="color: #2D3748; font-size: 32px; margin: 0; font-weight: 800; letter-spacing: -0.5px; font-family: 'Space Grotesk', -apple-system, sans-serif;">AI 简报</h1>
            <p class="header-subtitle" style="color: #5A6A85; font-size: 13px; margin: 12px 0 0 0; letter-spacing: 0.5px; font-weight: 600; font-family: -apple-system, sans-serif;">
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
          <td style="background-color: #EBF1F6; padding: 24px; text-align: center; border-top: 1px solid rgba(163, 177, 198, 0.25);">
            <p style="color: #5A6A85; font-size: 11px; margin: 0 0 6px 0; font-weight: 500;">
              此邮件由 DailyAI Pulse 自动化系统于每天上午发送。
            </p>
            <p style="color: #5A6A85; font-size: 11px; margin: 0; font-weight: 500;">
              本地服务运行地址：<a href="http://localhost:3000" style="color: #5C85E6; text-decoration: none; font-weight: 700;">http://localhost:3000</a>
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}
