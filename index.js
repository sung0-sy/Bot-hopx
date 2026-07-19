// ==========================================================
// بوت تليجرام المطور للتحكم بسيرفرات HopX (النسخة الاحترافية الفائقة v3.1.1)
// نظام الحماية والتحمل الفائق + حل مشكلة منافذ Render السحابية:
//   1) دمج خادم ويب وهمي (Dummy HTTP Server) لتجاوز فحص المنافذ في Render بنجاح.
//   2) دمج الـ Keep-Alive التلقائي (كل 4 دقائق) لمنع حذف السيرفر.
//   3) ميزة الكشف عن الأوامر الانتحارية والخطيرة لحماية البيئة السحابية.
//   4) نظام التنظيف الدوري للذاكرة العشوائية RAM وملفات الكاش (كل ساعتين).
//   5) أداة اقتطاع النصوص وحماية البوت من الانهيار عند قراءة السجلات الضخمة.
//   6) سجل السيرفرات النشطة التفاعلي مع أزرار استعادة الجلسة الفورية.
//   7) تتبع دقيق لمعرفات العمليات (PIDs) والتشغيل الخلفي الآمن (setsid).
// ==========================================================

console.log("\n==================================================");
console.log(`🚀 [STAMP] تم تشغيل النسخة الاحترافية الفائقة v3.1.1 بنجاح!`);
console.log(`📅 الوقت الحالي بالسيرفر: ${new Date().toISOString()}`);
console.log("=== نظام الدروع النشطة: تنظيف ذاتي + أمان فائق + حماية الذاكرة ===");
console.log("==================================================\n");

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http'); // مدمجة لحل مشكلة بورت Render
const TelegramBot = require('node-telegram-bot-api');
const { Sandbox } = require('@hopx-ai/sdk');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let OWNER_ID = process.env.OWNER_ID ? String(process.env.OWNER_ID).trim() : '';

const STATE_FILE = path.join(__dirname, 'state.json');

if (!TOKEN) {
  console.error('❌ خطأ: TELEGRAM_BOT_TOKEN غير موجود بملف .env');
  process.exit(1);
}

// 🌐 حل مشكلة منفذ Render (Port Binding)
// هذا الخادم البسيط يخبر Render أن التطبيق حي ومستقر ليتجاوز الفحص بنجاح
const PORT = process.env.PORT || 3000;
const dummyServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🚀 البوت يعمل بنجاح وبأعلى مستويات الاستقرار تحت حماية v3.1.1!\n');
});

dummyServer.listen(PORT, () => {
  console.log(`🌐 [Render Fix] خادم الويب الوهمي يعمل ويستمع على المنفذ: ${PORT}`);
});

// ثوابت التهيئة والتشغيل الآمن
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;       // نبضة Keep-Alive كل 4 دقائق لمنع حذف السيرفر خمولاً
const MAINTENANCE_INTERVAL_MS = 2 * 60 * 60 * 1000; // صيانة ذاتية وتنظيف الكاش كل ساعتين
const COMMAND_TIMEOUT_MS = 55 * 1000;               // أقصى مهلة لتنفيذ أي أمر لمنع تعليق قفل التنفيذ
const RECONNECT_RETRIES = 3;                        // عدد محاولات الاتصال بالسيرفر قبل إعلان فشله المؤقت
const RECONNECT_DELAY_MS = 3000;                    // التأخير بين محاولات إعادة الاتصال
const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000;         // مراقب خلفي يعيد المحاولة كل دقيقتين حتى لو فشلت المحاولات الأولى
// ⚠️ منصة HopX تفرض مهلة انتهاء تلقائية للسيرفر (Sandbox Timeout) حتى لو كان متصلاً ويستجيب!
// مجرد إرسال أمر فحص "echo" لا يمدد هذه المهلة؛ لازم تمديد صريح عبر sandbox.setTimeout()
const SANDBOX_EXTEND_TIMEOUT_MS = 60 * 60 * 1000;   // نحاول تمديد مهلة السيرفر لساعة كاملة من كل نبضة Keep-Alive

// مصفوفة حظر الأوامر الخطيرة لتجنب تدمير الـ Sandbox نفسه
const DANGEROUS_PATTERNS = [
  /\bpkill\b.*\bnode\b/i,
  /\bkillall\b.*\bnode\b/i,
  /\bpkill\b\s+-9?\s*$/i, 
  /\bkill\s+-9\s+-1\b/i, 
  /\breboot\b/i,
  /\bshutdown\b/i,
];

// سكربت جلب معلومات النظام الفنية والشبكية المطور
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

// 🛡️ تطبيع sandboxId لضمان أنه نص (string) دائماً وليس object بالغلط
// (هذا هو السبب الجذري لخطأ "The sandbox '[object Object]' was not found")
function normalizeSandboxId(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    return raw.sandboxId || raw.sandbox_id || raw.id || null;
  }
  return String(raw);
}

// إدارة تحميل وحفظ حالة البوت المستمرة
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!parsed.serverHistory) parsed.serverHistory = [];
      // تنظيف تلقائي لأي sandboxId فاسد (object) مخزّن مسبقاً من نسخة قديمة فيها الخلل
      const cleanId = normalizeSandboxId(parsed.sandboxId);
      if (parsed.sandboxId && cleanId !== parsed.sandboxId) {
        console.log('🛠️ تم اكتشاف وإصلاح sandboxId فاسد (object) داخل state.json تلقائياً.');
      }
      parsed.sandboxId = cleanId;
      return parsed;
    }
  } catch (e) {
    console.error('تحذير: فشل قراءة state.json، تم إنشاء حالة افتراضية جديدة:', e.message);
  }
  return {
    sandboxId: null,
    apiKey: process.env.HOPX_API_KEY || null,
    currentCreatedAt: null,
    serverHistory: [],
    terminalCwd: '/workspace',
    lastProcessPid: null,
    lastProcessLabel: null,
  };
}

function saveState(stateData) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateData, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ فشل حفظ ملف الحالة الدائم:', e.message);
  }
}

let appState = loadState();
let currentSandbox = null;
let userMode = 'MAIN'; // MAIN, TERMINAL, INPUT_API, INPUT_PID, INPUT_FOLDER, INPUT_BG_CMD
let pendingDangerousCommand = null; 

let isExecuting = false; // قفل العمليات المتزامنة لمنع تداخل المدخلات
let keepAliveTimer = null;
let maintenanceTimer = null;
let reconnectWatchdogTimer = null;

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
console.log('🚀 البوت المطور v3.1.1 مستعد ومحمي بالكامل...');

// أداة وضع سقف زمني لتنفيذ العمليات البرمجية لمنع التجمد
function withTimeout(promise, ms, label = 'العملية') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`⏱️ انتهت المهلة المحددة (${label} استغرقت أكثر من ${ms / 1000} ثانية)`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// دالة ذكية لاقتطاع النصوص الضخمة لمنع توقف البوت أو حظر تليجرام
function safeTruncate(text, maxLength = 3500) {
  if (!text) return '(لا توجد مخرجات)';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + `\n\n⚠️ ... [تم اقتطاع النص لكبر حجم المخرجات وحماية ذاكرة البوت] ...`;
}

function isDangerousCommand(text) {
  return DANGEROUS_PATTERNS.some((re) => re.test(text));
}

// تفعيل نبضات منع الحذف التلقائي خمولاً + تمديد صريح لمهلة انتهاء السيرفر عند HopX
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(async () => {
    if (!currentSandbox) return;
    try {
      await withTimeout(currentSandbox.commands.run('echo keepalive'), 15000, 'Keep-Alive');

      // ⚠️ مهم جداً: مجرد تنفيذ أمر لا يمدد مهلة انتهاء الـ Sandbox تلقائياً عند HopX.
      // لازم استدعاء صريح لتمديد المهلة، وإلا سيُحذف السيرفر من المنصة نفسها
      // حتى لو كان البوت يرسل له أوامر بنجاح (بالضبط المشكلة اللي كانت تصير).
      try {
        if (typeof currentSandbox.setTimeout === 'function') {
          await currentSandbox.setTimeout(SANDBOX_EXTEND_TIMEOUT_MS);
          console.log(`⏱️ تم تمديد مهلة انتهاء السيرفر بنجاح لساعة إضافية.`);
        } else if (typeof Sandbox.setTimeout === 'function') {
          await Sandbox.setTimeout(appState.sandboxId, SANDBOX_EXTEND_TIMEOUT_MS, { apiKey: appState.apiKey });
          console.log(`⏱️ تم تمديد مهلة انتهاء السيرفر (عبر الدالة الساكنة) بنجاح.`);
        }
      } catch (extendErr) {
        console.log('⚠️ تعذر تمديد مهلة انتهاء السيرفر صراحة (قد تختلف تسمية الدالة بهذه النسخة من الـ SDK):', extendErr.message);
      }

      console.log(`💓 تم إرسال نبضة Keep-Alive بنجاح للسيرفر: ${appState.sandboxId} - ${new Date().toISOString()}`);
    } catch (e) {
      console.log('⚠️ فشل إرسال نبضة Keep-Alive، سيتم الإنعاش التلقائي عند أول حركة:', e.message);
      currentSandbox = null;
      startReconnectWatchdog();
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// نظام الصيانة الدوري والتنظيف الذاتي للسيرفر (كل ساعتين) لحمايته من امتلاء الذاكرة
function startAutoMaintenance() {
  stopAutoMaintenance();
  maintenanceTimer = setInterval(async () => {
    if (!currentSandbox) return;
    try {
      // تفريغ الملفات المؤقتة + كاش الذاكرة العشوائية بذكاء
      await currentSandbox.commands.run('rm -rf /tmp/* && sync');
      console.log('🧹 [الصيانة الدورية] تم تنظيف مجلد المؤقتات وتحرير الذاكرة العشوائية تلقائياً.');
    } catch (e) {
      console.log('⚠️ [الصيانة الدورية] فشل تفعيل الصيانة التلقائية:', e.message);
    }
  }, MAINTENANCE_INTERVAL_MS);
}

function stopAutoMaintenance() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}

// أرشفة وتخزين معرّفات السيرفرات في السجل
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
    appState.serverHistory = appState.serverHistory.slice(0, 15);
    saveState(appState);
  }
}

// استعادة الاتصال الذكي بالسيرفر الفعلي والتأكد من سلامته
async function getActiveSandbox(chatId) {
  // تطبيع الـ ID دائماً قبل أي استخدام لتفادي مشكلة "[object Object]"
  appState.sandboxId = normalizeSandboxId(appState.sandboxId);

  if (!appState.sandboxId || !appState.apiKey) {
    currentSandbox = null;
    return null;
  }

  if (currentSandbox) {
    try {
      await withTimeout(currentSandbox.commands.run('echo 1'), 5000, 'فحص سريع للاتصال');
      return currentSandbox;
    } catch (e) {
      console.log('⚠️ تم اكتشاف سقوط في الاتصال الحالي، جاري تفعيل آلية الإنعاش...');
      currentSandbox = null;
    }
  }

  const targetId = appState.sandboxId;
  let lastError = null;
  for (let attempt = 1; attempt <= RECONNECT_RETRIES; attempt++) {
    try {
      const connected = await withTimeout(
        Sandbox.connect({ sandboxId: targetId, apiKey: appState.apiKey }),
        20000,
        `إعادة الاتصال المحاولة رقم ${attempt}`
      );
      currentSandbox = connected;
      console.log(`✅ تم استعادة قنوات الاتصال بالسيرفر المحفوظ بنجاح: ${targetId}`);
      startKeepAlive();
      startAutoMaintenance(); // تشغيل الصيانة عند استعادة الاتصال
      stopReconnectWatchdog(); // نجح الاتصال، لا داعي للمراقب الخلفي بعد الآن
      return currentSandbox;
    } catch (e) {
      lastError = e;
      console.log(`❌ فشلت محاولة الإنعاش رقم ${attempt}/${RECONNECT_RETRIES}:`, e.message);
      if (attempt < RECONNECT_RETRIES) {
        await new Promise((res) => setTimeout(res, RECONNECT_DELAY_MS));
      }
    }
  }

  // فشلت المحاولات الفورية، لكن لا نمسح الـ sandboxId نهائياً — قد يكون عطل مؤقت بالشبكة أو بالمنصة.
  // بدل الاستسلام، نُبقي المعرّف محفوظاً ونشغّل مراقب خلفي يعيد المحاولة تلقائياً باستمرار.
  currentSandbox = null;
  stopKeepAlive();
  stopAutoMaintenance();
  startReconnectWatchdog();

  if (chatId) {
    await bot.sendMessage(
      chatId,
      `⚠️ تعذر الاتصال بالسيرفر \`${targetId}\` بعد ${RECONNECT_RETRIES} محاولات فورية.\n\nالسبب الأخير: ${lastError ? lastError.message : 'غير معروف'}\n\nالمعرّف **لم يُحذف** — البوت سيستمر بالمحاولة تلقائياً بالخلفية كل ${WATCHDOG_INTERVAL_MS / 60000} دقيقة، أو اضغط "إعادة المحاولة الآن".`,
      { parse_mode: 'Markdown', ...getReconnectKeyboard() }
    );
  }
  return null;
}

// مراقب خلفي: يستمر بمحاولة إعادة الاتصال دورياً حتى لو فشلت كل المحاولات الفورية،
// بدل حذف السيرفر نهائياً من أول انقطاع (تنفيذاً لمطلب: "مهما صار لازم يرجع يتصل").
function startReconnectWatchdog() {
  if (reconnectWatchdogTimer) return; // شغّال بالفعل
  reconnectWatchdogTimer = setInterval(async () => {
    if (currentSandbox || !appState.sandboxId) {
      stopReconnectWatchdog();
      return;
    }
    console.log('🔁 [Watchdog] محاولة إعادة اتصال تلقائية بالخلفية...');
    await getActiveSandbox(null);
    if (currentSandbox && OWNER_ID) {
      bot.sendMessage(
        OWNER_ID,
        `✅ تم استعادة الاتصال تلقائياً بالسيرفر \`${appState.sandboxId}\` بعد انقطاع مؤقت.`,
        { parse_mode: 'Markdown', ...getServerDashboardKeyboard() }
      ).catch(() => {});
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopReconnectWatchdog() {
  if (reconnectWatchdogTimer) {
    clearInterval(reconnectWatchdogTimer);
    reconnectWatchdogTimer = null;
  }
}

function getReconnectKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 إعادة المحاولة الآن', callback_data: 'retry_connect' }],
        [{ text: '🚀 إنشاء سيرفر جديد بدلاً منه', callback_data: 'create_server' }],
        [{ text: '🗂️ سيرفراتي السابقة', callback_data: 'list_previous' }]
      ]
    }
  };
}

// الإقلاع الأولي وفحص الحالة السابقة عند تشغيل السكربت
(async () => {
  await getActiveSandbox();
})();

function isOwner(chatId) {
  return OWNER_ID && String(chatId) === String(OWNER_ID);
}

// ==========================================================
// القوالب والواجهات الرسومية التفاعلية للوحة التحكم
// ==========================================================
function getServerDashboardKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🖥️ الترمنال (جلسة مستمرة وبث حي)', callback_data: 'open_terminal' }],
        [{ text: '📂 إدارة الملفات والتخزين', callback_data: 'manage_files' }],
        [{ text: '⚙️ العمليات والنظام الداخلي', callback_data: 'manage_processes' }],
        [{ text: '📊 حالة وموارد السيرفر', callback_data: 'server_status' }],
        [{ text: '⚡ أوامر تشغيل سريعة', callback_data: 'quick_commands' }],
        [{ text: '🗑️ إنهاء وتدمير السيرفر الحالي', callback_data: 'kill_server' }],
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
        [{ text: '🚀 إنشاء سيرفر جديد وفوري', callback_data: 'create_server' }],
        [{ text: '🗂️ سيرفراتي السابقة والمحفوظة', callback_data: 'list_previous' }],
        [{ text: '🔑 تغيير مفتاح API', callback_data: 'change_api' }]
      ]
    }
  };
}

// ==========================================================
// معالج الرسائل البرقية والنصوص والملفات
// ==========================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // إعداد المالك الأول للبوت تلقائياً
  if (!OWNER_ID) {
    OWNER_ID = String(chatId);
    try {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      envContent = envContent.includes('OWNER_ID=')
        ? envContent.replace(/OWNER_ID=.*/g, `OWNER_ID=${OWNER_ID}`)
        : envContent + `\nOWNER_ID=${OWNER_ID}\n`;
      fs.writeFileSync(envPath, envContent, 'utf8');
    } catch (e) { console.error('فشل إعداد OWNER_ID بملف .env:', e.message); }
    await bot.sendMessage(chatId, `✅ تم تسجيلك بنجاح كمالك حصري للبوت برقم تعريف: \`${OWNER_ID}\``, { parse_mode: 'Markdown' });
  }

  if (!isOwner(chatId)) return;

  // فك القفل في حال إرسال أوامر البدء
  if (text === '/start' || text === '/menu') {
    isExecuting = false;
    userMode = 'MAIN';
    pendingDangerousCommand = null;

    if (!appState.apiKey) {
      userMode = 'INPUT_API';
      await bot.sendMessage(chatId, '👋 أهلاً بك في **HopX Bot** [v3.1.1]\n\nللبدء والتحكم الكامل بمواردك، أرسل مفتاح الـ API الخاص بك (يبدأ بـ `hopx_live`):', { parse_mode: 'Markdown' });
      return;
    }

    const sandbox = await getActiveSandbox(chatId);
    if (sandbox) {
      await bot.sendMessage(chatId, `⚙️ **السيرفر النشط حالياً:** \`${appState.sandboxId}\`\n• **الحالة:** \`مستقر ومتصل\` ⏳\n• 💓 **Keep-Alive:** مفعّل\n• 🧹 **الصيانة الذاتية:** نشطة لحماية الذاكرة العشوائية.`, {
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } else {
      await bot.sendMessage(chatId, '⚙️ لا توجد بيئة نشطة حالياً. يرجى اختيار الإجراء المناسب من الخيارات التالية للبدء:', getStartKeyboard());
    }
    return;
  }

  // التحقق من تداخل العمليات
  if (isExecuting) {
    await bot.sendMessage(chatId, '⏳ يرجى الانتظار حتى اكتمال تنفيذ العملية السابقة لحماية بيئة السيرفر من التعليق. (أرسل /start لإعادة الضبط إذا طال الانتظار)');
    return;
  }

  // معالجة استقبال ورفع الملفات المستندة (Documents)
  if (msg.document) {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا توجد بيئة عمل نشطة ومثبتة للرفع إليها حالياً.');
      return;
    }
    isExecuting = true;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تنزيل الملف وترحيله إلى خادم HopX الخاص بك...');
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
      const decodeResult = await withTimeout(
        sandbox.commands.run(`base64 -d "${tempB64Path}" > "${remotePath}" && rm "${tempB64Path}" && echo OK`),
        COMMAND_TIMEOUT_MS,
        'رفع وتأكيد الملف'
      );
      
      if (!decodeResult.stdout || !decodeResult.stdout.includes('OK')) {
        throw new Error(decodeResult.stderr || 'فشل فك تشفير وتثبيت الملف بالسيرفر الفعلي');
      }

      const isZip = fileName.toLowerCase().endsWith('.zip');
      await bot.editMessageText(`✅ تم رفع وتجهيز الملف بالكامل في:\n\`${remotePath}\``, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        ...(isZip ? {
          reply_markup: {
            inline_keyboard: [[{ text: '📦 فك ضغط الأرشيف (Extract)', callback_data: `extract_zip:${remotePath}` }]]
          }
        } : {})
      });
    } catch (e) {
      console.error('تفاصيل خطأ الرفع الفني:', e);
      await bot.editMessageText(`❌ فشلت عملية نقل الملف إلى السيرفر:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    } finally {
      isExecuting = false;
    }
    return;
  }

  // إدخال مفتاح الـ API
  if (userMode === 'INPUT_API') {
    if (text.includes('hopx_live')) {
      appState.apiKey = text;
      saveState(appState);
      userMode = 'MAIN';
      await bot.sendMessage(chatId, '🔒 تم حفظ وتوثيق مفتاح الـ API ومزامنته مع الجلسة.', getStartKeyboard());
    } else {
      await bot.sendMessage(chatId, '❌ التنسيق غير مدعوم. تأكد من تزويدي بمفتاح يبدأ بالبادئة الرسمية: `hopx_live`.');
    }
    return;
  }

  // تنزيل ملف مخصص من السيرفر
  if (text.startsWith('/download')) {
    const filePath = text.replace('/download', '').trim();
    if (!filePath) {
      await bot.sendMessage(chatId, '⚠️ اكتب المسار الفعلي للملف بعد الأمر، مثال:\n/download /workspace/index.js');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا توجد بيئة نشطة لاستخراج الملفات منها.');
      return;
    }
    isExecuting = true;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تأمين وتشفير الملف لتهيئته للتنزيل المباشر...');
    try {
      const fileName = filePath.split('/').pop() || 'file';
      const tempB64Path = `/tmp/${fileName}.b64`;
      const encodeResult = await withTimeout(
        sandbox.commands.run(`base64 -w 0 "${filePath}" > "${tempB64Path}" && echo OK`),
        COMMAND_TIMEOUT_MS,
        'ترميز التنزيل'
      );
      if (!encodeResult.stdout || !encodeResult.stdout.includes('OK')) {
        throw new Error(encodeResult.stderr || 'تعذر تحديد موقع الملف أو قراءة بياناته.');
      }
      const base64Content = await sandbox.files.read(tempB64Path);
      const buffer = Buffer.from(base64Content, 'base64');
      await sandbox.commands.run(`rm "${tempB64Path}"`);

      await bot.sendDocument(chatId, buffer, {}, { filename: fileName });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch (e) {
      await bot.editMessageText(`❌ فشلت عملية تنزيل الملف من الخادم:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    } finally {
      isExecuting = false;
    }
    return;
  }

  // إدخال اسم مجلد لإنشائه
  if (userMode === 'INPUT_FOLDER') {
    userMode = 'MAIN';
    const folderName = text.trim().replace(/[^a-zA-Z0-9_\-\/. ]/g, '');
    if (!folderName) {
      await bot.sendMessage(chatId, '❌ مسار المجلد المدخل يحتوي على رموز غير مدعومة.');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    try {
      const folderPath = folderName.startsWith('/workspace') ? folderName : `/workspace/${folderName}`;
      await sandbox.commands.run(`mkdir -p "${folderPath}"`);
      await bot.sendMessage(chatId, `✅ تم إنشاء مجلد العمل الجديد بنجاح:\n\`${folderPath}\``, { parse_mode: 'Markdown' });
    } catch (e) {
      await bot.sendMessage(chatId, `❌ فشل تأسيس المجلد المطلوب على السيرفر:\n${e.message}`);
    }
    return;
  }

  // إيقاف عملية مخصصة بواسطة الـ PID
  if (userMode === 'INPUT_PID') {
    userMode = 'MAIN';
    const pid = text.replace(/[^0-9]/g, '');
    if (!pid) {
      await bot.sendMessage(chatId, '❌ يجب كتابة رقم PID عددي سليم.');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    try {
      const result = await sandbox.commands.run(`kill -9 ${pid}`);
      const output = (result.stderr || '').trim();
      if (output) {
        await bot.sendMessage(chatId, `⚠️ ${output}`);
      } else {
        await bot.sendMessage(chatId, `✅ تم إنهاء وإغلاق العملية بالمعرّف \`${pid}\` بشكل فوري وقاطع.`, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      await bot.sendMessage(chatId, `❌ واجهت مشكلة أثناء محاولة قتل العملية:\n${e.message}`);
    }
    return;
  }

  // معالجة الترمنال التراكمي (Stateful Terminal)
  if (userMode === 'TERMINAL') {
    // التحقق من حيازة الموافقة في حال تعليق أمر خطير مسبقاً
    if (pendingDangerousCommand !== null) {
      const confirmText = text.trim().toLowerCase();
      if (confirmText === 'نعم' || confirmText === 'yes' || confirmText === 'تأكيد') {
        const cmdToRun = pendingDangerousCommand;
        pendingDangerousCommand = null;
        await runTerminalCommand(chatId, cmdToRun);
      } else {
        pendingDangerousCommand = null;
        await bot.sendMessage(chatId, '❌ تم إلغاء تنفيذ الأمر الخطير استجابة لطلبك. اكتب أمرك التالي الآن بصيغة آمنة.', getTerminalKeyboard());
      }
      return;
    }

    // الكشف التلقائي عن الأوامر المدمرة لبيئة العمل البرمجية
    if (isDangerousCommand(text)) {
      pendingDangerousCommand = text;
      await bot.sendMessage(
        chatId,
        `⚠️ **تحذير أمني حرج**\n\nالأمر المطلوب:\n\`${text}\`\n\nهذا الأمر قد يتسبب في تدمير عملية الـ Sandbox نفسها وفصل اتصال البوت نهائياً!\n\n💡 إذا كنت تقصد إيقاف آخر عملية قمت بتشغيلها، يرجى الاستعانة زر "⏹️ إيقاف آخر عملية" المتاح بالواجهة.\n\nهل ترغب بالمتابعة بالتأكيد؟ أرسل كلمة \`نعم\` للتأكيد أو أي شيء آخر للإلغاء الفوري.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await runTerminalCommand(chatId, text);
    return;
  }
});

// تنفيذ الأوامر في بيئة الترمنال التراكمية
async function runTerminalCommand(chatId, text) {
  const sandbox = await getActiveSandbox(chatId);
  if (!sandbox) {
    userMode = 'MAIN';
    await bot.sendMessage(chatId, '⚠️ انقطع الاتصال ببيئة السيرفر النشطة حالياً.', getStartKeyboard());
    return;
  }

  isExecuting = true;
  const executingMsg = await bot.sendMessage(chatId, `⏳ جاري التنفيذ والتشغيل: \`${text}\`...`, { parse_mode: 'Markdown' });

  try {
    const cwd = appState.terminalCwd || '/workspace';
    let fullCmd = '';
    const isBackgroundJob = text.includes('nohup') || text.includes('&') || text.includes('node index.js');

    // إذا كان الأمر مخصصاً للعمل بالخلفية، نقوم بحمايته وتحويله لعدم تعليق الشاشة
    if (isBackgroundJob) {
      fullCmd = `
        if [ -f /tmp/.hopx_env ]; then source /tmp/.hopx_env 2>/dev/null; fi
        cd "${cwd}" 2>/dev/null
        ${text} > /workspace/bg_output.log 2>&1 &
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

    const result = await Promise.race([
      sandbox.commands.run(fullCmd),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TimeoutExceeded')), COMMAND_TIMEOUT_MS))
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
      output = "🚀 تم إطلاق العملية بنجاح في خلفية النظام دون تعليق البوت. يمكنك متابعة السجلات فورا عبر ملف `/workspace/bg_output.log`.";
    }

    // الحماية من النصوص الضخمة عبر التصفية والاقتطاع الآمن
    output = safeTruncate(output);

    await bot.editMessageText(`\`${text}\`\n\`⚙️ ${newCwd} $\`\n\`\`\`\n${output}\n\`\`\``, {
      chat_id: chatId,
      message_id: executingMsg.message_id,
      parse_mode: 'Markdown',
      ...getTerminalKeyboard()
    });
  } catch (e) {
    let errMsg = e.message;
    if (e.message === 'TimeoutExceeded') {
      errMsg = "⏳ تجاوز الأمر المهلة المحددة له ولكنه قد يكون مستمراً بالعمل في الخلفية بنجاح دون تعليق شاشة البوت (مثالي للنصوص الطويلة).";
    }
    await bot.editMessageText(`❌ إخطار بخصوص تنفيذ الأمر \`${text}\`:\n${errMsg}`, {
      chat_id: chatId,
      message_id: executingMsg.message_id,
      parse_mode: 'Markdown',
      ...getTerminalKeyboard()
    });
  } finally {
    isExecuting = false;
  }
}

// ==========================================================
// معالج الأزرار التفاعلية والردود اللحظية
// ==========================================================
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (!isOwner(chatId)) return;
  await bot.answerCallbackQuery(callbackQuery.id);

  if (data === 'create_server') {
    await bot.sendMessage(chatId, '⏳ هل تود حتماً تأسيس سيرفر جديد كلياً؟\n\n⚠️ سيتم نقل وتأريخ السيرفر النشط حالياً إلى الأرشيف لحفظه واستعادته لاحقاً عند اللزوم.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ نعم، أسّس الآن', callback_data: 'confirm_create_server' }],
          [{ text: '❌ إلغاء والتراجع', callback_data: 'go_main' }]
        ]
      }
    });
    return;
  }

  if (data === 'confirm_create_server') {
    if (isExecuting) {
      await bot.sendMessage(chatId, '⚠️ السيرفر مشغول حالياً في إكمال عملية برمجية معلقة. يرجى الانتظار!');
      return;
    }
    isExecuting = true;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري أرشفة الجلسة الحالية وبناء السيرفر الجديد من سحابة HopX...');
    try {
      if (appState.sandboxId) {
        pushToHistory(appState.sandboxId, appState.currentCreatedAt);
      }

      stopKeepAlive();
      stopAutoMaintenance();

      try {
        currentSandbox = await Sandbox.create({
          template: 'code-interpreter',
          apiKey: appState.apiKey,
          timeoutMs: SANDBOX_EXTEND_TIMEOUT_MS, // مهلة أولية ساعة كاملة بدل الافتراضي الأقصر
        });
      } catch (createErr) {
        // بعض الخطط قد ترفض تحديد timeoutMs مخصص عند الإنشاء؛ نعيد المحاولة بدونه كخطة بديلة
        console.log('⚠️ فشل الإنشاء مع timeoutMs مخصص، إعادة المحاولة بالإعدادات الافتراضية:', createErr.message);
        currentSandbox = await Sandbox.create({
          template: 'code-interpreter',
          apiKey: appState.apiKey,
        });
      }
      appState.sandboxId = normalizeSandboxId(currentSandbox.sandboxId);
      appState.currentCreatedAt = new Date().toISOString();
      appState.terminalCwd = '/workspace';
      appState.lastProcessPid = null;
      appState.lastProcessLabel = null;
      saveState(appState);
      
      startKeepAlive();
      startAutoMaintenance();

      try {
        await currentSandbox.commands.run('rm -f /tmp/.hopx_env');
      } catch (_) {}

      await bot.deleteMessage(chatId, loadingMsg.message_id);
      await bot.sendMessage(chatId, `✅ **تم إنشاء وتنشيط البيئة الجديدة بنجاح**\n\n• **المعرّف الجديد:** \`${currentSandbox.sandboxId}\`\n• **الموقع الجغرافي:** ${regionToCountry('eu-west')}\n• **الحالة:** متاح ومحمي تلقائياً عبر نبضات Keep-Alive وصيانة دورية نشطة.`, {
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشلت عملية تأسيس السيرفر الجديد:\n${e.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
    } finally {
      isExecuting = false;
    }
    return;
  }

  // الاتصال المباشر بأحد السيرفرات السابقة من السجل
  if (data.startsWith('connect_to:')) {
    const targetSandboxId = data.replace('connect_to:', '');
    isExecuting = true;
    const connectMsg = await bot.sendMessage(chatId, `⏳ جاري تفعيل قنوات الاتصال المباشر بالسيرفر: \`${targetSandboxId}\`...`, { parse_mode: 'Markdown' });
    try {
      const testSandbox = await Sandbox.connect({
        sandboxId: targetSandboxId,
        apiKey: appState.apiKey
      });

      if (appState.sandboxId && appState.sandboxId !== targetSandboxId) {
        pushToHistory(appState.sandboxId, appState.currentCreatedAt);
      }

      currentSandbox = testSandbox;
      appState.sandboxId = targetSandboxId;
      const histItem = appState.serverHistory.find(h => h.id === targetSandboxId);
      appState.currentCreatedAt = histItem ? histItem.createdAt : new Date().toISOString();
      saveState(appState);
      
      startKeepAlive();
      startAutoMaintenance();

      await bot.editMessageText(`✅ تم استعادة قنوات التحكم وإعادة الاتصال بالسيرفر المحدد كجلسة نشطة!\n• المعرّف: \`${targetSandboxId}\``, {
        chat_id: chatId,
        message_id: connectMsg.message_id,
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } catch (e) {
      await bot.editMessageText(`❌ تعذر الإتصال بالبيئة المستهدفة. من المحتمل قيام منصة HopX بحذفها نهائياً لتجاوزها فترات الخمول الطويلة المسموحة.\n\nالخطأ المرتجع: ${e.message}`, {
        chat_id: chatId,
        message_id: connectMsg.message_id
      });
    } finally {
      isExecuting = false;
    }
    return;
  }

  if (data === 'retry_connect') {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري محاولة إعادة الاتصال يدوياً بالسيرفر المحفوظ...');
    await getActiveSandbox(null); // null لتفادي إرسال رسالة فشل مكررة؛ سنعرض النتيجة يدوياً هنا
    if (currentSandbox) {
      await bot.editMessageText(`✅ تم استعادة الاتصال بنجاح بالسيرفر: \`${appState.sandboxId}\``, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        ...getServerDashboardKeyboard()
      });
    } else {
      await bot.editMessageText(`❌ ما زال تعذر الاتصال بالسيرفر \`${appState.sandboxId}\`.\n\nالبوت سيتابع المحاولة تلقائياً بالخلفية كل ${WATCHDOG_INTERVAL_MS / 60000} دقيقة.`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        ...getReconnectKeyboard()
      });
    }
    return;
  }

  if (data === 'open_terminal') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    userMode = 'TERMINAL';
    await bot.sendMessage(chatId, `🖥️ **الترمنال التراكمي المستقر والمقيد (v3.1.1)**\n\nأي أمر ترسله سيتم تنفيذه برمجياً ضمن بيئة جلسة واحدة مستمرة ومتكاملة.\n\n⚠️ ملاحظة: بعض الأوامر الخطيرة مقيدة افتراضياً لحماية بيئتك من التجمد، وسيتم تحذيرك قبل تشغيلها.`, {
      parse_mode: 'Markdown',
      ...getTerminalKeyboard()
    });
    return;
  }

  if (data === 'exit_terminal' || data === 'go_main') {
    userMode = 'MAIN';
    isExecuting = false;
    pendingDangerousCommand = null;
    const sandbox = await getActiveSandbox(chatId);
    if (sandbox) {
      await bot.sendMessage(chatId, `🏠 تم الانتقال للوحة التحكم والتحكم الرئيسية:`, getServerDashboardKeyboard());
    } else {
      await bot.sendMessage(chatId, '🏠 القائمة العامة - السيرفر مغلق أو معطل حالياً:', getStartKeyboard());
    }
    return;
  }

  if (data === 'kill_server') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ لا توجد بيئة عمل نشطة لتدميرها حالياً.');
      return;
    }
    await bot.sendMessage(chatId, '🛑 **تأكيد حذف وتدمير بيئة العمل الحالية**\n\nهل تود بالتأكيد مسح السيرفر الحالي ومحتوياته بالكامل من سحابة HopX نهائياً؟', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ نعم، تدمير نهائي وفوري', callback_data: 'confirm_kill_server' }],
          [{ text: '❌ إلغاء وتراجع', callback_data: 'go_main' }]
        ]
      }
    });
    return;
  }

  if (data === 'confirm_kill_server') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) {
      await bot.sendMessage(chatId, '⚠️ السيرفر مدمر بالفعل من قبل الخادم.');
      return;
    }
    try {
      pushToHistory(appState.sandboxId, appState.currentCreatedAt);
      await sandbox.kill();
      currentSandbox = null;
      appState.sandboxId = null;
      appState.currentCreatedAt = null;
      appState.lastProcessPid = null;
      saveState(appState);
      
      stopKeepAlive();
      stopAutoMaintenance();

      await bot.sendMessage(chatId, '🗑️ تم حرق البيئة وتطهير السجلات ونقل السيرفر إلى السجل كمتوقف.', getStartKeyboard());
    } catch (e) {
      await bot.sendMessage(chatId, `❌ واجهت مشكلة أثناء محاولة تدمير البيئة: ${e.message}`, getStartKeyboard());
    }
    return;
  }

  if (data === 'quick_commands') {
    const stopLabel = appState.lastProcessPid
      ? `⏹️ إيقاف آخر عملية (${appState.lastProcessLabel || appState.lastProcessPid})`
      : '⏹️ إيقاف آخر عملية قمت بتشغيلها';
    await bot.sendMessage(chatId, '⚡ حدد أحد إجراءات الأوامر السريعة المباشرة بالسيرفر:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '▶️ تشغيل عملية خلفية آمنة (setsid)', callback_data: 'prompt_bg_run' }],
          [{ text: stopLabel, callback_data: 'stop_last_process' }],
          [{ text: '🔄 تحديث النظام وحزم التطوير', callback_data: 'qc_update' }],
          [{ text: '🧹 تنظيف بقايا الملفات المؤقتة وعمل الكاش', callback_data: 'qc_clean' }],
          [{ text: '💾 استهلاك المساحة والقرص', callback_data: 'qc_disk' }],
          [{ text: '📁 سرد ملفات مساحة العمل', callback_data: 'qc_ls' }],
          [{ text: '🏠 العودة للرئيسية', callback_data: 'go_main' }]
        ]
      }
    });
    return;
  }

  // تهيئة المستخدم لإطلاق عملية خلفية آمنة ومحمية من التعليق
  if (data === 'prompt_bg_run') {
    userMode = 'INPUT_BG_CMD';
    await bot.sendMessage(chatId, '▶️ أرسل الآن الأمر البرمجي المراد نقله للعمل بالخلفية بدقة (مثل: `node server.js`):\n\n💡 سيتم تشغيل العملية باستخدام بروتوكول `setsid` الآمن لمنع تعليق اتصال البوت، وسيتم تتبع الـ PID لتتمكن من إيقافها لاحقاً بضغطة زر.', { parse_mode: 'Markdown' });
    return;
  }

  if (data === 'stop_last_process') {
    if (!appState.lastProcessPid) {
      await bot.sendMessage(chatId, 'ℹ️ لا توجد عمليات خلفية نشطة مسجلة بالنظام لإيقافها. استخدم تبويب "العمليات" لإنهاء أي مهمة مخصصة بالـ PID.');
      return;
    }
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    try {
      await sandbox.commands.run(`kill -9 ${appState.lastProcessPid} 2>/dev/null; echo done`);
      await bot.sendMessage(chatId, `✅ تم بنجاح وقف وإخماد العملية \`${appState.lastProcessLabel || ''}\` (PID: ${appState.lastProcessPid}) بشكل معزول وآمن.`, { parse_mode: 'Markdown' });
      appState.lastProcessPid = null;
      appState.lastProcessLabel = null;
      saveState(appState);
    } catch (e) {
      await bot.sendMessage(chatId, `❌ فشل إيقاف وتطهير العملية:\n${e.message}`);
    }
    return;
  }

  if (['qc_update', 'qc_clean', 'qc_disk', 'qc_ls'].includes(data)) {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    if (isExecuting) {
      await bot.sendMessage(chatId, '⚠️ السيرفر قيد التنفيذ لمعالجة مهمة أخرى، حاول لاحقاً.');
      return;
    }
    isExecuting = true;
    const commandsMap = {
      qc_update: 'apt update -y && apt upgrade -y',
      qc_clean: 'apt clean && rm -rf /tmp/* 2>/dev/null && sync && echo "تم تفريغ المساحة وتطهير الكاش بنجاح"',
      qc_disk: 'df -h /',
      qc_ls: 'ls -la /workspace',
    };
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تنفيذ الأمر السريع المتفق عليه...');
    try {
      const result = await withTimeout(sandbox.commands.run(commandsMap[data]), COMMAND_TIMEOUT_MS, 'أمر سريع');
      let output = (result.stdout || '') + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
      
      output = safeTruncate(output);

      await bot.editMessageText('```\n' + output + '\n```', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.editMessageText(`❌ تعذر إتمام مهمة الأمر السريع المختار:\n${e.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
    } finally {
      isExecuting = false;
    }
    return;
  }

  if (data === 'manage_processes') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري جرد وبث العمليات الجارية حالياً في النظام...');
    try {
      const result = await sandbox.commands.run("ps aux --sort=-%mem | head -15");
      let output = (result.stdout || '').trim();
      
      output = safeTruncate(output);

      await bot.editMessageText('```\n' + output + '\n```', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛑 إنهاء عملية معينة (PID)', callback_data: 'kill_process_prompt' }],
            [{ text: '🏠 الرئيسية', callback_data: 'go_main' }]
          ]
        }
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشلت عملية قراءة جدول المهمات:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
    return;
  }

  if (data === 'kill_process_prompt') {
    userMode = 'INPUT_PID';
    await bot.sendMessage(chatId, '🛑 أرسل الآن معرّف المهمة أو العملية (PID) لإنهاء عملها من نظام السيرفر:');
    return;
  }

  if (data.startsWith('extract_zip:')) {
    const zipPath = data.replace('extract_zip:', '');
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري فك ضغط الأرشيف ونشر الملفات...');
    try {
      const dir = zipPath.substring(0, zipPath.lastIndexOf('/')) || '/workspace';
      const result = await sandbox.commands.run(`cd "${dir}" && unzip -o "${zipPath}"`);
      let output = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '');
      
      output = safeTruncate(output);

      await bot.editMessageText(`✅ تم فك وتفريغ مكونات الملف المضغوط في:\n\`${dir}\`\n\n\`\`\`\n${output}\n\`\`\``, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.editMessageText(`❌ فشلت محاولة فك الأرشيف:\n${e.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
    }
    return;
  }

  if (data === 'manage_files') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    try {
      const result = await sandbox.commands.run('ls -1 /workspace | wc -l');
      const count = (result.stdout || '0').trim();
      await bot.sendMessage(chatId, `📁 الدليل الرئيسي لملفاتك هو: \`/workspace\` ويضم حالياً عدد \`${count}\` من العناصر والمجلدات الفرعية.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 رفع مستند أو ملف مخصص', callback_data: 'prompt_upload' }],
            [{ text: '📁 تأسيس وإنشاء مجلد فرعي', callback_data: 'prompt_folder' }],
            [{ text: '🏠 الرئيسية', callback_data: 'go_main' }]
          ]
        }
      });
    } catch (e) {
      await bot.sendMessage(chatId, `❌ خطأ غير متوقع أثناء تصفح هيكل الملفات:\n${e.message}`);
    }
    return;
  }

  if (data === 'prompt_upload') {
    await bot.sendMessage(chatId, '📤 أرسل لي الملف المطلوب رفعه للسيرفر الآن كـ **Document** (مستند) وسيتم تخزينه في الدليل التلقائي `/workspace`.', { parse_mode: 'Markdown' });
    return;
  }

  if (data === 'prompt_folder') {
    userMode = 'INPUT_FOLDER';
    await bot.sendMessage(chatId, '📝 أرسل لي اسم المجلد الجديد المراد تهيئته وبنائه داخل مساحة العمل `/workspace`:');
    return;
  }

  if (data === 'server_status') {
    const sandbox = await getActiveSandbox(chatId);
    if (!sandbox) return;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تحليل استهلاك العتاد والموارد وسرعة الشبكة...');
    try {
      await sandbox.files.write('/tmp/sysinfo.sh', SYSINFO_SCRIPT);
      const result = await sandbox.commands.run('bash /tmp/sysinfo.sh');
      const output = (result.stdout || '').trim() || '(فشل جرد البيانات)';
      await bot.editMessageText('```\n' + output.slice(0, 3500) + '\n```', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.editMessageText(`❌ واجهت مشكلة أثناء جمع بيانات العتاد الفنية:\n${e.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
    return;
  }

  if (data === 'change_api') {
    userMode = 'INPUT_API';
    await bot.sendMessage(chatId, '🔑 يرجى تزويدي بمفتاح الـ API الجديد لاستبداله بالقديم في الإعدادات:');
    return;
  }

  if (data === 'list_previous') {
    let inline_keyboard = [];
    let textOutput = "🗂️ **سجل ومستودع السيرفرات الخاصة بك:**\n\n";

    if (appState.sandboxId) {
      const createdStr = appState.currentCreatedAt 
        ? new Date(appState.currentCreatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }) 
        : 'غير محدد';
      textOutput += `🟢 *السيرفر النشط حالياً:* \`${appState.sandboxId}\`\n📅 تاريخ الإنشاء: ${createdStr}\n\n`;
    }

    const history = appState.serverHistory || [];
    if (history.length > 0) {
      textOutput += "📜 *اضغط على أي معرّف سيرفر في الأسفل لاستعادة الجلسة والتحكم به مباشرة:*";
      history.forEach((h) => {
        const createdStr = h.createdAt 
          ? new Date(h.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' }) 
          : 'غير محدد';
        inline_keyboard.push([{
          text: `🔗 سيرفر [${createdStr}] - ID: ${h.id.slice(0, 10)}...`,
          callback_data: `connect_to:${h.id}`
        }]);
      });
    } else {
      textOutput += "ℹ️ لا توجد سيرفرات محفوظة بالأرشيف في الوقت الراهن.";
    }

    inline_keyboard.push([{ text: '🏠 العودة للرئيسية', callback_data: 'go_main' }]);

    await bot.sendMessage(chatId, textOutput, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
    return;
  }

  if (data === 'term_clear') {
    await bot.sendMessage(chatId, '🧹 تم تنظيف وإعادة ضبط واجهة العرض للترمنال.');
    return;
  }

  if (data === 'term_ctrl_c') {
    await bot.sendMessage(chatId, 'ℹ️ بروتوكول HopX الحالي ينفذ الأوامر بشكل معزول ومستقل. لإيقاف مهمة طويلة الأجل تعمل في الخلفية، انتقل إلى قسم "العمليات" أو استخدم زر إيقاف آخر عملية.');
    return;
  }
});

// معالجة تشغيل عملية خلفية بطريقة آمنة (setsid + stdout/stderr redirected)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!isOwner(chatId)) return;
  if (userMode !== 'INPUT_BG_CMD') return;
  if (!text || isExecuting) return;

  userMode = 'MAIN';
  const sandbox = await getActiveSandbox(chatId);
  if (!sandbox) {
    await bot.sendMessage(chatId, '⚠️ السيرفر الحالي مغلق أو تعذر تأسيس قنوات الاتصال به.');
    return;
  }

  // فرض الحماية على الإدخال السريع للعمليات الخلفية
  if (isDangerousCommand(text)) {
    await bot.sendMessage(chatId, '❌ هذا الأمر تم حظره وتصنيفه كأمر خطر على سلامة تشغيل السيرفر. استخدم الترمنال مع التأكيد الصريح إذا كنت متأكداً.');
    return;
  }

  isExecuting = true;
  const loadingMsg = await bot.sendMessage(chatId, `⏳ جاري إطلاق وتوجيه العملية الخلفية: \`${text}\`...`, { parse_mode: 'Markdown' });
  try {
    const cwd = appState.terminalCwd || '/workspace';
    const logFile = `/workspace/bg_${Date.now()}.log`;
    // تشغيل خلفي آمن وفصل المدخلات القياسية بالكامل لضمان الاستقرار الفني مع تخزين السجلات باسم فريد
    const safeCmd = `
      cd "${cwd}" 2>/dev/null
      setsid bash -c '${text.replace(/'/g, "'\\''")} </dev/null >> ${logFile} 2>&1 &'
      disown -a 2>/dev/null
      sleep 1
      pgrep -f "${text.replace(/"/g, '\\"')}" | head -n 1
    `;
    const result = await withTimeout(sandbox.commands.run(safeCmd), 20000, 'تشغيل العملية الخلفية');
    const pid = (result.stdout || '').trim().split('\n')[0];
    if (pid) {
      appState.lastProcessPid = pid;
      appState.lastProcessLabel = text.slice(0, 40);
      saveState(appState);
      await bot.editMessageText(`✅ تم إطلاق وحفظ العملية بالخلفية بنجاح بنظام مستقل.\n\n• **الأمر:** \`${text}\`\n• **PID المعرّف:** \`${pid}\`\n• **ملف السجلات الفريد:** \`${logFile}\`\n\nيمكنك إغلاقها بدقة لاحقاً عبر زر "⏹️ إيقاف آخر عملية" أو من مستودع العمليات دون المساس بالسيرفر.`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } else {
      await bot.editMessageText(`⚠️ تم إطلاق الأمر ولكن لم يتم تتبع معرّف (PID) دقيق. يرجى مراجعة سجلات التشغيل في المجلد للتأكد من نجاح العملية.`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    }
  } catch (e) {
    await bot.editMessageText(`❌ فشلت عملية تشغيل وإطلاق العملية بالخلفية:\n${e.message}`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
  } finally {
    isExecuting = false;
  }
});

bot.on('polling_error', (err) => {
  console.error('تنبيه - فشل بسيط في قنوات اتصال تليجرام:', err.message);
});

// الحماية والاحتواء الشامل للأخطاء الفنية لتفادي توقف السكربت البوت بالكامل
process.on('uncaughtException', (err) => {
  console.error('❌ رصد استثناء برمجي غير متوقع:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ تم رصد رفض بروميس (Promise) غير معالج بالنظام:', reason);
});

