// ==========================================================
// بوت تليجرام المطور للتحكم بسيرفرات HopX (النسخة الاحترافية v2.5 - الاستقرار الشامل)
// التعديلات وإصلاحات الأخطاء الجوهرية:
//   1) ربط حقيقي وإعادة اتصال بالسيرفرات السابقة عبر أزرار تفاعلية مخصصة.
//   2) حل مشكلة الـ Timeout عبر فصل الأوامر الطويلة والخلفية تماماً عن الانتظار.
//   3) تحرير تلقائي لقفل التداخل (Concurrency Lock) عند حدوث الأخطاء لمنع تعليق البوت.
//   4) فحص نبض ذكي وسريع (Heartbeat) للسيرفر لضمان جودة الاستجابة.
// ==========================================================

console.log("\n==================================================");
console.log(`🚀 [STAMP] تم تشغيل النسخة المستقرة v2.5 بنجاح!`);
console.log(`📅 الوقت الحالي بالسيرفر: ${new Date().toISOString()}`);
console.log("=== نسخة الاستقرار الشامل وجلسات الترمنال المترابطة ===");
console.log("==================================================\n");

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { Sandbox } = require('@hopx-ai/sdk');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let OWNER_ID = process.env.OWNER_ID ? String(process.env.OWNER_ID).trim() : '';

const STATE_FILE = path.join(__dirname, 'state.json');

if (!TOKEN) {
  console.error('❌ خطأ: TELEGRAM_BOT_TOKEN غير موجود بملف .env');
  process.exit(1);
}

// سكربت جلب معلومات النظام الحقيقية
const SYSINFO_SCRIPT = `#!/bin/bash
echo "📊 Basic System Information"
echo "---------------------------------"
echo "Uptime     : $(uptime -p 2>/dev/null | sed 's/^up //')"
echo "Processor  : $(lscpu 2>/dev/null | awk -F: '/Model name/{gsub(/^ +/,"",$2); print $2; exit}')"
echo "CPU cores  : $(nproc) cores"
echo "RAM        : $(free -h | awk '/Mem:/{print $3" / "$2" used"}')"
echo "Swap       : $(free -h | awk '/Swap:/{print $3" / "$2}')"
echo "Disk       : $(df -h / | awk 'NR==2{print $3" / "$2" ("$5" used)"}')"
echo "Distro     : $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "Kernel     : $(uname -r)"
echo "Hostname   : $(hostname)"
echo ""
echo "🌐 Network Information"
echo "---------------------------------"
curl -s --max-time 5 https://ipinfo.io/json 2>/dev/null | \\
  grep -E '"(ip|org|city|country|region)"' | \\
  sed 's/[",]//g' || echo "تعذر جلب معلومات الشبكة"
`;

// إدارة الحالة الذاكرية والدائمة
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!parsed.serverHistory) parsed.serverHistory = [];
      return parsed;
    }
  } catch (e) {
    console.error('تحذير: فشل قراءة state.json', e.message);
  }
  return {
    sandboxId: null,
    apiKey: process.env.HOPX_API_KEY || null,
    currentCreatedAt: null,
    serverHistory: [],
    terminalCwd: '/workspace',
  };
}

function saveState(stateData) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateData, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ فشل حفظ ملف الحالة:', e.message);
  }
}

let appState = loadState();
let currentSandbox = null;
let userMode = 'MAIN'; // MAIN, TERMINAL, INPUT_API, INPUT_PID, INPUT_FOLDER

// قفل لمنع العمليات المتداخلة على السيرفر
let isExecuting = false;

function regionToCountry(region) {
  const map = {
    'eu-west': '🇩🇪 ألمانيا (Germany)',
    'eu-central': '🇩🇪 ألمانيا (Germany)',
    'us-east': '🇺🇸 أمريكا (USA)',
    'us-west': '🇺🇸 أمريكا (USA)',
    'ap-south': '🇸🇬 سنغافورة (Singapore)',
  };
  return map[region] || `${region} (غير معروف بالضبط)`;
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('🚀 البوت المطور v2.5 يعمل الآن ويراقب حالة الاتصال باستمرار...');

// بوابة الاتصال الذكية للتحقق وإعادة الاتصال عند السقوط
async function getActiveSandbox(chatId) {
  if (!appState.sandboxId || !appState.apiKey) {
    currentSandbox = null;
    return null;
  }

  if (currentSandbox) {
    try {
      // فحص سريع جداً لنبض السيرفر لتفادي تعليق البوت
      await Promise.race([
        currentSandbox.commands.run('echo 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      return currentSandbox;
    } catch (e) {
      console.log('⚠️ تم كشف سقوط الاتصال بالساند بوكس، محاولة الإنعاش التلقائي...');
      currentSandbox = null;
    }
  }

  // محاولة إعادة الاتصال التلقائي باستخدام المعرف المخزن
  try {
    currentSandbox = await Sandbox.connect({
      sandboxId: appState.sandboxId,
      apiKey: appState.apiKey,
    });
    console.log(`✅ تم استعادة الاتصال بالساند بوكس بنجاح: ${appState.sandboxId}`);
    return currentSandbox;
  } catch (e) {
    console.log('❌ فشلت محاولة إعادة الاتصال التلقائية بالسيرفر:', e.message);
    
    // ننقل السيرفر الحالي للسجل لكي لا يضيع نهائياً ويمكنه محاولة الاتصال به يدوياً لاحقاً
    pushToHistory(appState.sandboxId, appState.currentCreatedAt);
    
    appState.sandboxId = null;
    appState.currentCreatedAt = null;
    saveState(appState);
    currentSandbox = null;
    
    if (chatId) {
      await bot.sendMessage(chatId, '⚠️ تعذر الاتصال بالسيرفر الحالي تلقائياً. يمكنك الانتقال إلى "سيرفراتي السابقة" لمحاولة الاتصال به يدوياً أو إنشاء سيرفر جديد.', getStartKeyboard());
    }
    return null;
  }
}

function pushToHistory(id, createdAt) {
  if (!id) return;
  appState.serverHistory = appState.serverHistory || [];
  const exists = appState.serverHistory.some(h => h.id === id);
  if (!exists) {
    appState.serverHistory.unshift({
      id: id,
      createdAt: createdAt || new Date().toISOString(),
      replacedAt: new Date().toISOString(),
    });
    appState.serverHistory = appState.serverHistory.slice(0, 15); // الاحتفاظ بآخر 15 سيرفر
    saveState(appState);
  }
}

// الإقلاع التلقائي وفحص الجلسة السابقة
(async () => {
  await getActiveSandbox();
})();

function isOwner(chatId) {
  return OWNER_ID && String(chatId) === String(OWNER_ID);
}

// ==========================================================
// القوالب والواجهات الرسومية
// ==========================================================
function getServerDashboardKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🖥️ الترمنال (جلسة مستمرة)', callback_data: 'open_terminal' }],
        [{ text: '📂 إدارة الملفات', callback_data: 'manage_files' }],
        [{ text: '⚙️ العمليات', callback_data: 'manage_processes' }],
        [{ text: '📊 حالة السيرفر', callback_data: 'server_status' }],
        [{ text: '⚡ أوامر سريعة', callback_data: 'quick_commands' }],
        [{ text: '🗑️ إنهاء السيرفر الحالي', callback_data: 'kill_server' }],
        [{ text: '🗂️ سيرفراتي السابقة والمحفوظة', callback_data: 'list_previous' }],
        [{ text: '🔑 تغيير مفتاح API', callback_data: 'change_api' }]
      ]
    }
  };
}

function getTerminalKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Ctrl+C', callback_data: 'term_ctrl_c' },
          { text: '🧹 مسح الشاشة', callback_data: 'term_clear' }
        ],
        [{ text: '🚪 خروج للرئيسية', callback_data: 'exit_terminal' }]
      ]
    }
  };
}

function getStartKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 إنشاء سيرفر جديد', callback_data: 'create_server' }],
        [{ text: '🗂️ سيرفراتي السابقة والمحفوظة', callback_data: 'list_previous' }],
        [{ text: '🔑 تغيير مفتاح API', callback_data: 'change_api' }]
      ]
    }
  };
}

// ==========================================================
// معالج الرسائل النصية المباشرة
// ==========================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!OWNER_ID) {
    OWNER_ID = String(chatId);
    try {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      envContent = envContent.includes('OWNER_ID=')
        ? envContent.replace(/OWNER_ID=.*/g, `OWNER_ID=${OWNER_ID}`)
        : envContent + `\nOWNER_ID=${OWNER_ID}\n`;
      fs.writeFileSync(envPath, envContent, 'utf8');
    } catch (e) { console.error(e); }
    await bot.sendMessage(chatId, `✅ تم تسجيلك كمالك للبوت برقم: \`${OWNER_ID}\``, { parse_mode: 'Markdown' });
  }

  if (!isOwner(chatId)) return;

  if (text === '/start' || text === '/menu') {
    isExecuting = false; // تحرير القفل تلقائياً عند طلب القائمة الرئيسية لإصلاح التعليق
    userMode = 'MAIN';
    if (!appState.apiKey) {
      userMode = 'INPUT_API';
      await bot.sendMessage(chatId, '👋 أهلاً بك في **HopX Bot** [v2.5]\n\nللبدء، أرسل لي مفتاح الـ API الخاص بك (يبدأ بـ `hopx_live`):', { parse_mode: 'Markdown' });
      return;
    }

    const sandbox = await getActiveSandbox(chatId);
    if (sandbox) {
      await bot.sendMessage(chatId, `⚙️ السيرفر النشط والمتصل حالياً: \`${appState.sandboxId}\`\nالحالة: \`مستقر / متصل\` ⏳`, {
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } else {
      await bot.sendMessage(chatId, '⚙️ لا يوجد سيرفر نشط حالياً أو تعذر الاتصال التلقائي بالقديم. اختر من الخيارات أدناه:', getStartKeyboard());
    }
    return;
  }

  // تأمين ضد التداخل (Concurrency lock)
  if (isExecuting) {
    await bot.sendMessage(chatId, '⏳ يرجى الانتظار حتى ينتهي تنفيذ الأمر السابق لمنع تداخل العمليات وحماية السيرفر. (إذا علق البوت أرسل /start لإعادة التعيين)');
    return;
  }

  // معالجة رفع الملفات للمستخدم
  if (msg.document) {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا يوجد سيرفر نشط ومتصل حالياً للرفع إليه.');
      return;
    }
    isExecuting = true;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري رفع وتمرير الملف إلى السيرفر الخاص بك...');
    try {
      const fileId = msg.document.file_id;
      const fileName = msg.document.file_name || `file_${Date.now()}`;
      const fileLink = await bot.getFileLink(fileId);

      const https = require('https');
      const chunks = await new Promise((resolve, reject) => {
        https.get(fileLink, (res) => {
          const data = [];
          res.on('data', (c) => data.push(c));
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }).on('error', reject);
      });
      const buffer = Buffer.concat(chunks);

      const remotePath = `/workspace/${fileName}`;
      const tempB64Path = `/tmp/${fileName}.b64`;
      const base64Content = buffer.toString('base64');

      await sandbox.files.write(tempB64Path, base64Content);
      const decodeResult = await sandbox.commands.run(
        `base64 -d "${tempB64Path}" > "${remotePath}" && rm "${tempB64Path}" && echo OK`
      );
      if (!decodeResult.stdout || !decodeResult.stdout.includes('OK')) {
        throw new Error(decodeResult.stderr || 'فشل فك التشفير التلقائي للملف بالسيرفر');
      }

      const isZip = fileName.toLowerCase().endsWith('.zip');
      await bot.editMessageText(`✅ تم رفع الملف بنجاح إلى:\n\`${remotePath}\``, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        ...(isZip ? {
          reply_markup: {
            inline_keyboard: [[{ text: '📦 استخراج الملف الآن (فك الضغط)', callback_data: `extract_zip:${remotePath}` }]]
          }
        } : {})
      });
    } catch (e) {
      console.error('تفاصيل خطأ الرفع:', e);
      await bot.editMessageText(`❌ فشل رفع وتجهيز الملف بالسيرفر:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    } catch(err) {
      console.log(err);
    } finally {
      isExecuting = false;
    }
    return;
  }

  if (userMode === 'INPUT_API') {
    if (text.includes('hopx_live')) {
      appState.apiKey = text;
      saveState(appState);
      userMode = 'MAIN';
      await bot.sendMessage(chatId, '🔒 تم تسجيل مفتاح API بنجاح ومزامنته.', getStartKeyboard());
    } else {
      await bot.sendMessage(chatId, '❌ التنسيق غير صحيح. يرجى تزويدي بمفتاح يبدأ بـ `hopx_live`.');
    }
    return;
  }

  // تحميل ملف من السيرفر
  if (text.startsWith('/download')) {
    const filePath = text.replace('/download', '').trim();
    if (!filePath) {
      await bot.sendMessage(chatId, '⚠️ اكتب مسار الملف بعد /download، مثال:\n/download /workspace/file.txt');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا يوجد سيرفر نشط لتحميل الملف منه.');
      return;
    }
    isExecuting = true;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري إعداد الملف للتحميل والتأمين...');
    try {
      const fileName = filePath.split('/').pop() || 'file';
      const tempB64Path = `/tmp/${fileName}.b64`;
      const encodeResult = await sandbox.commands.run(
        `base64 -w 0 "${filePath}" > "${tempB64Path}" && echo OK`
      );
      if (!encodeResult.stdout || !encodeResult.stdout.includes('OK')) {
        throw new Error(encodeResult.stderr || 'تعذر العثور على الملف أو قراءته.');
      }
      const base64Content = await sandbox.files.read(tempB64Path);
      const buffer = Buffer.from(base64Content, 'base64');
      await sandbox.commands.run(`rm "${tempB64Path}"`);

      await bot.sendDocument(chatId, buffer, {}, { filename: fileName });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch (e) {
      await bot.editMessageText(`❌ فشل تنزيل الملف من السيرفر:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    } finally {
      isExecuting = false;
    }
    return;
  }

  if (userMode === 'INPUT_FOLDER') {
    userMode = 'MAIN';
    const folderName = text.trim().replace(/[^a-zA-Z0-9_\-\/. ]/g, '');
    if (!folderName) {
      await bot.sendMessage(chatId, '❌ اسم مجلد غير صالح.');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا يوجد سيرفر متصل حالياً.');
      return;
    }
    try {
      const folderPath = folderName.startsWith('/workspace') ? folderName : `/workspace/${folderName}`;
      await sandbox.commands.run(`mkdir -p "${folderPath}"`);
      await bot.sendMessage(chatId, `✅ تم إنشاء المجلد الجديد:\n\`${folderPath}\``, { parse_mode: 'Markdown' });
    } catch (e) {
      await bot.sendMessage(chatId, `❌ فشل إنشاء المجلد داخل السيرفر:\n${e.message}`);
    }
    return;
  }

  if (userMode === 'INPUT_PID') {
    userMode = 'MAIN';
    const pid = text.replace(/[^0-9]/g, '');
    if (!pid) {
      await bot.sendMessage(chatId, '❌ يجب إرسال رقم PID صحيح.');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا يوجد سيرفر متصل حالياً.');
      return;
    }
    try {
      const result = await sandbox.commands.run(`kill -9 ${pid}`);
      const output = (result.stderr || '').trim();
      if (output) {
        await bot.sendMessage(chatId, `⚠️ ${output}`);
      } else {
        await bot.sendMessage(chatId, `✅ تم إنهاء العملية ذات الرقم \`${pid}\` بنجاح.`, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      await bot.sendMessage(chatId, `❌ فشل قتل العملية:\n${e.message}`);
    }
    return;
  }

  // ---------- الترمنال التراكمي (Stateful Terminal) ----------
  if (userMode === 'TERMINAL') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      userMode = 'MAIN';
      await bot.sendMessage(chatId, '⚠️ انقطع الاتصال بالسيرفر. يرجى إعادة الاتصال أو إنشاء سيرفر جديد.', getStartKeyboard());
      return;
    }

    isExecuting = true;
    const executingMsg = await bot.sendMessage(chatId, `⏳ جاري التنفيذ: \`${text}\`...`, { parse_mode: 'Markdown' });

    try {
      const cwd = appState.terminalCwd || '/workspace';
      
      // الكشف الذكي عن تشغيل الأوامر الطويلة أو الخلفية (تجنب الـ timeout)
      let fullCmd = '';
      const isBackgroundJob = text.includes('nohup') || text.includes('&') || text.includes('node index.js');

      if (isBackgroundJob) {
        // إذا كان أمر خلفي طويل، نقوم بتنفيذه وفصله تماماً دون جعل الترمنال ينتظر المخرجات اللانهائية له
        fullCmd = `
          if [ -f /tmp/.hopx_env ]; then source /tmp/.hopx_env 2>/dev/null; fi
          cd "${cwd}" 2>/dev/null
          ${text} > /dev/null 2>&1 & 
          echo "__BACKGROUND_STARTED__"
          echo "__CWD__:$(pwd)"
        `;
      } else {
        fullCmd = `
          if [ -f /tmp/.hopx_env ]; then source /tmp/.hopx_env 2>/dev/null; fi
          cd "${cwd}" 2>/dev/null
          ${text}
          export -p > /tmp/.hopx_env 2>/dev/null
          echo "__CWD__:$(pwd)"
        `;
      }

      // تحديد مهلة أقصاها 20 ثانية للأوامر العادية لتلافي الـ timeout العام للسكربت
      const result = await Promise.race([
        sandbox.commands.run(fullCmd),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TimeoutExceeded')), 25000))
      ]);

      let stdoutLines = (result.stdout || '').split('\n');
      let newCwd = cwd;
      const cwdMarkerIndex = stdoutLines.findIndex((l) => l.startsWith('__CWD__:'));
      if (cwdMarkerIndex !== -1) {
        newCwd = stdoutLines[cwdMarkerIndex].replace('__CWD__:', '').trim() || cwd;
        stdoutLines.splice(cwdMarkerIndex, 1);
      }
      appState.terminalCwd = newCwd;
      saveState(appState);

      let output = stdoutLines.join('\n') + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
      if (output.includes('__BACKGROUND_STARTED__')) {
        output = "🚀 تم إطلاق العملية في الخلفية بنجاح بنظام منفصل (بدون تعليق البوت). يمكنك فحص السجلات عبر ملف الـ log الخاص بك أو من قسم العمليات.";
      }
      if (!output.trim()) output = '(تم تنفيذ الأمر بنجاح ودون مخرجات)';

      await bot.editMessageText(`\`${text}\`\n\`⚙️ ${newCwd} $\`\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\``, {
        chat_id: chatId,
        message_id: executingMsg.message_id,
        parse_mode: 'Markdown',
        ...getTerminalKeyboard()
      });
    } catch (e) {
      let errMsg = e.message;
      if (e.message === 'TimeoutExceeded') {
        errMsg = "⏳ تجاوز الأمر مهلة الـ 25 ثانية ولكنه قد يكون مستمراً بالعمل في الخلفية بنجاح (مثالي لأوامر تشغيل السكربتات الطويلة).";
      }
      await bot.editMessageText(`❌ حالة التنفيذ للأمر \`${text}\`:\n${errMsg}`, {
        chat_id: chatId,
        message_id: executingMsg.message_id,
        parse_mode: 'Markdown',
        ...getTerminalKeyboard()
      });
    } finally {
      isExecuting = false;
    }
    return;
  }
});

// ==========================================================
// معالج الأزرار التفاعلية
// ==========================================================
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (!isOwner(chatId)) return;
  await bot.answerCallbackQuery(callbackQuery.id);

  if (data === 'create_server') {
    await bot.sendMessage(chatId, '⏳ هل أنت متأكد من إنشاء سيرفر جديد؟\n\n⚠️ السيرفر الحالي سيتم حفظ معرفه في السجل للعودة إليه لاحقاً إذا رغبت.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ نعم، أنشئ سيرفر جديد', callback_data: 'confirm_create_server' }],
          [{ text: '❌ إلغاء والتراجع', callback_data: 'go_main' }]
        ]
      }
    });
    return;
  }

  if (data === 'confirm_create_server') {
    if (isExecuting) {
      await bot.sendMessage(chatId, '⚠️ السيرفر مشغول حالياً في عملية أخرى. انتظر لحظة!');
      return;
    }
    isExecuting = true;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري أرشفة الجلسة وتهيئة السيرفر الجديد المخصص...');
    try {
      if (appState.sandboxId) {
        pushToHistory(appState.sandboxId, appState.currentCreatedAt);
      }

      currentSandbox = await Sandbox.create({
        template: 'code-interpreter',
        apiKey: appState.apiKey,
      });
      appState.sandboxId = currentSandbox.sandboxId;
      appState.currentCreatedAt = new Date().toISOString();
      appState.terminalCwd = '/workspace';
      saveState(appState);

      try {
        await currentSandbox.commands.run('rm -f /tmp/.hopx_env');
      } catch (_) {}

      await bot.deleteMessage(chatId, loadingMsg.message_id);
      await bot.sendMessage(chatId, `✅ **تم بناء وإنشاء السيرفر بنجاح**\n\n• **المعرّف الجديد:** \`${currentSandbox.sandboxId}\`\n• **القالب الحركي:** \`code-interpreter\`\n• **الموقع:** ${regionToCountry('eu-west')}\n• **الحالة:** متاح دائم ومستمر`, {
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشل تأسيس السيرفر:\n${e.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
    } finally {
      isExecuting = false;
    }
    return;
  }

  // ميزة إعادة الاتصال اليدوي بسيرفر قديم من السجل
  if (data.startsWith('connect_to:')) {
    const targetSandboxId = data.replace('connect_to:', '');
    isExecuting = true;
    const connectMsg = await bot.sendMessage(chatId, `⏳ محاولة الاتصال المباشر بالسيرفر: \`${targetSandboxId}\`...`, { parse_mode: 'Markdown' });
    try {
      const testSandbox = await Sandbox.connect({
        sandboxId: targetSandboxId,
        apiKey: appState.apiKey
      });
      
      // نجح الاتصال! نقوم بتبديل السيرفر النشط
      if (appState.sandboxId && appState.sandboxId !== targetSandboxId) {
        pushToHistory(appState.sandboxId, appState.currentCreatedAt);
      }
      
      currentSandbox = testSandbox;
      appState.sandboxId = targetSandboxId;
      // بحث عن التاريخ الأصلي من السجل لو وجد
      const histItem = appState.serverHistory.find(h => h.id === targetSandboxId);
      appState.currentCreatedAt = histItem ? histItem.createdAt : new Date().toISOString();
      saveState(appState);

      await bot.editMessageText(`✅ تم استعادة الاتصال والتحكم الكامل بالسيرفر المستهدف بنجاح!\nالمعرف: \`${targetSandboxId}\``, {
        chat_id: chatId,
        message_id: connectMsg.message_id,
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } catch (e) {
      await bot.editMessageText(`❌ تعذر الاتصال بهذا السيرفر. يبدو أنه تم حذفه تلقائياً من المنصة لمرور فترة طويلة على عدم استخدامه.\nالخطأ: ${e.message}`, {
        chat_id: chatId,
        message_id: connectMsg.message_id
      });
    } finally {
      isExecuting = false;
    }
    return;
  }

  if (data === 'open_terminal') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    userMode = 'TERMINAL';
    await bot.sendMessage(chatId, `🖥️ **الترمنال التراكمي المستقر (v2.5)**\n\nالآن أي أمر تكتبه هنا سيرتبط بما قبله بشكل مستمر ومتكامل.\n💡 *تنبيه:* إذا كنت تشغل تطبيق نود أو بوت آخر طويل الأمد، فسيقوم البوت بتشغيله بالخلفية بأمان دون تجميد الجلسة.`, {
      parse_mode: 'Markdown',
      ...getTerminalKeyboard()
    });
    return;
  }

  if (data === 'exit_terminal' || data === 'go_main') {
    userMode = 'MAIN';
    isExecuting = false; // فك أي تعليق تلقائياً عند العودة
    const sandbox = await getActiveSandbox(chatId);
    if (sandbox) {
      await bot.sendMessage(chatId, `🏠 عدت للوحة التحكم الرئيسية للسيرفر النشط:`, getServerDashboardKeyboard());
    } else {
      await bot.sendMessage(chatId, '🏠 القائمة الرئيسية - لا يوجد سيرفر متصل حالياً:', getStartKeyboard());
    }
    return;
  }

  if (data === 'kill_server') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا يوجد سيرفر نشط لإيقافه.');
      return;
    }
    await bot.sendMessage(chatId, '🛑 **تأكيد حذف وحرق السيرفر الحالي**\n\nهل تود مسح السيرفر ومحتوياته بالكامل من سحابة HopX نهائياً؟', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ نعم، تدمير فوري ونقله للأرشيف', callback_data: 'confirm_kill_server' }],
          [{ text: '❌ إلغاء وتراجع', callback_data: 'go_main' }]
        ]
      }
    });
    return;
  }

  if (data === 'confirm_kill_server') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ السيرفر مغلق بالفعل من طرف السحابة.');
      return;
    }
    try {
      pushToHistory(appState.sandboxId, appState.currentCreatedAt);
      await sandbox.kill();
      currentSandbox = null;
      appState.sandboxId = null;
      appState.currentCreatedAt = null;
      saveState(appState);
      await bot.sendMessage(chatId, '🗑️ تم إرسال طلب التدمير للبيئة المعزولة ونقل السيرفر للأرشيف.', getStartKeyboard());
    } catch (e) {
      await bot.sendMessage(chatId, `❌ فشل طلب التدمير الكامل: ${e.message}`, getStartKeyboard());
    }
    return;
  }

  if (data === 'quick_commands') {
    await bot.sendMessage(chatId, '⚡ اختر أحد الأوامر السريعة المتاحة بالسيرفر:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 تحديث النظام وحزم التطوير', callback_data: 'qc_update' }],
          [{ text: '🧹 تنظيف بقايا الملفات المؤقتة', callback_data: 'qc_clean' }],
          [{ text: '💾 استهلاك القرص الصلب', callback_data: 'qc_disk' }],
          [{ text: '📁 سرد ملفات مساحة العمل الرئيسية', callback_data: 'qc_ls' }],
          [{ text: '🏠 العودة للرئيسية', callback_data: 'go_main' }]
        ]
      }
    });
    return;
  }

  if (['qc_update', 'qc_clean', 'qc_disk', 'qc_ls'].includes(data)) {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    if (isExecuting) {
      await bot.sendMessage(chatId, '⚠️ السيرفر قيد التنفيذ حالياً. يرجى الانتظار قليلاً.');
      return;
    }
    isExecuting = true;
    const commandsMap = {
      qc_update: 'apt update -y && apt upgrade -y',
      qc_clean: 'apt clean && rm -rf /tmp/* 2>/dev/null; echo "تم تنظيف المساحة المؤقتة بنجاح"',
      qc_disk: 'df -h /',
      qc_ls: 'ls -la /workspace',
    };
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تشغيل الأمر السريع...');
    try {
      const result = await sandbox.commands.run(commandsMap[data]);
      const output = (result.stdout || '') + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
      await bot.editMessageText('```\n' + (output.trim().slice(0, 3500) || '(لا توجد نتائج أو مخرجات للأمر)') + '\n```', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشل تنفيذ الأمر السريع:\n${e.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
    } finally {
      isExecuting = false;
    }
    return;
  }

  if (data === 'manage_processes') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري رصد جدول العمليات النشطة بالسيرفر...');
    try {
      const result = await sandbox.commands.run("ps aux --sort=-%mem | head -15");
      const output = (result.stdout || '').trim() || '(لا توجد عمليات نشطة حالياً)';
      await bot.editMessageText('```\n' + output.slice(0, 3500) + '\n```', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛑 إنهاء عملية مخصصة (PID)', callback_data: 'kill_process_prompt' }],
            [{ text: '🏠 الرئيسية', callback_data: 'go_main' }]
          ]
        }
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشل استخراج جدول العمليات:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
    return;
  }

  if (data === 'kill_process_prompt') {
    userMode = 'INPUT_PID';
    await bot.sendMessage(chatId, '🛑 أرسل رقم العملية (PID) المطلوب إنهاؤها الآن من فضلك:');
    return;
  }

  if (data.startsWith('extract_zip:')) {
    const zipPath = data.replace('extract_zip:', '');
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري استخلاص وفك الضغط عن الملف...');
    try {
      const dir = zipPath.substring(0, zipPath.lastIndexOf('/')) || '/workspace';
      const result = await sandbox.commands.run(`cd "${dir}" && unzip -o "${zipPath}"`);
      const output = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '');
      await bot.editMessageText(`✅ تم تفريغ الأرشيف المضغوط بالمسار المحدد:\n\`${dir}\`\n\n\`\`\`\n${output.trim().slice(0, 3000) || '(بدون مخرجات)'}\n\`\`\``, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشل فك الضغط عن الملف المرفق:\n${e.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
    }
    return;
  }

  if (data === 'manage_files') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    try {
      const result = await sandbox.commands.run('ls -1 /workspace | wc -l');
      const count = (result.stdout || '0').trim();
      await bot.sendMessage(chatId, `📁 المجلد الحالي: \`/workspace\` ويحوي حالياً \`${count}\` من العناصر والمجلدات الفرعية.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 رفع وتجهيز ملف', callback_data: 'prompt_upload' }],
            [{ text: '📁 إنشاء مجلد فرعي', callback_data: 'prompt_folder' }],
            [{ text: '🏠 الرئيسية', callback_data: 'go_main' }]
          ]
        }
      });
    } catch (e) {
      await bot.sendMessage(chatId, `❌ خطأ أثناء تصفح الملفات:\n${e.message}`);
    }
    return;
  }

  if (data === 'prompt_upload') {
    await bot.sendMessage(chatId, '📤 أرسل الملف المطلوب ترحيله للسيرفر كـ **Document** وسيتم توجيهه مباشرة للمجلد الرئيسي `/workspace`.', { parse_mode: 'Markdown' });
    return;
  }

  if (data === 'prompt_folder') {
    userMode = 'INPUT_FOLDER';
    await bot.sendMessage(chatId, '📝 أرسل الآن اسم المجلد الجديد الذي تود إنشائه داخل `/workspace`:', { parse_mode: 'Markdown' });
    return;
  }

  if (data === 'server_status') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري استخلاص وفحص حالة العتاد للسيرفر الحالي...');
    try {
      await sandbox.files.write('/tmp/sysinfo.sh', SYSINFO_SCRIPT);
      const result = await sandbox.commands.run('bash /tmp/sysinfo.sh');
      const output = (result.stdout || '').trim() || '(تعذر الحصول على معلومات المراقبة)';
      await bot.editMessageText('```\n' + output.slice(0, 3500) + '\n```', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشلت محاولة المراقبة الذكية:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
    return;
  }

  if (data === 'change_api') {
    userMode = 'INPUT_API';
    await bot.sendMessage(chatId, '🔑 أرسل الآن مفتاح الـ API الجديد لاستبداله بالقديم:');
    return;
  }

  if (data === 'list_previous') {
    let inline_keyboard = [];
    let textOutput = "🗂️ **سجل السيرفرات الخاصة بك:**\n\n";

    if (appState.sandboxId) {
      const createdStr = appState.currentCreatedAt ? new Date(appState.currentCreatedAt).toLocaleString('en-GB') : 'غير محدد';
      textOutput += `🟢 *السيرفر الحالي النشط:* \`${appState.sandboxId}\`\n📅 تاريخ الإنشاء: ${createdStr}\n\n`;
    }

    const history = appState.serverHistory || [];
    if (history.length > 0) {
      textOutput += "📜 *اضغط على أي سيرفر بالأسفل لمحاولة إعادة الاتصال به واستعادة العمل عليه:*";
      history.forEach((h, i) => {
        const createdStr = h.createdAt ? new Date(h.createdAt).toLocaleDateString('en-GB') : 'غير محدد';
        inline_keyboard.push([{
          text: `🔗 سيرفر [${createdStr}] - ID: ${h.id.slice(0,8)}...`,
          callback_data: `connect_to:${h.id}`
        }]);
      });
    } else {
      textOutput += "ℹ️ لا توجد سيرفرات مؤرشفة في السجل حتى الآن.";
    }

    inline_keyboard.push([{ text: '🏠 العودة للرئيسية', callback_data: 'go_main' }]);

    await bot.sendMessage(chatId, textOutput, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
    return;
  }

  if (data === 'term_clear') {
    await bot.sendMessage(chatId, '🧹 تم تنظيف شاشة العرض.');
    return;
  }

  if (data === 'term_ctrl_c') {
    await bot.sendMessage(chatId, 'ℹ️ بروتوكول HopX الحالي ينفذ كل أمر على حدة كأمر مستقل. لإيقاف عملية طويلة تعمل في الخلفية، انتقل إلى قسم "العمليات" لإنهاء تشغيلها فوراً.');
    return;
  }
});

bot.on('polling_error', (err) => {
  console.error('تنبيه - خطأ في اتصال تليجرام:', err.message);
});

// معالجة الأخطاء الشاملة لمنع توقف السيرفر والبوت
process.on('uncaughtException', (err) => {
  console.error('❌ تم رصد خطأ برمجي عام غير متوقع:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ تم رصد وعد (Promise) مرفوض مهمل بالخلفية:', reason);
});
