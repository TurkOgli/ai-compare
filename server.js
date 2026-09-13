const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AVALAI_API_KEY;

const BASE_URL = 'https://api.avalai.ir/v1/chat/completions';

const MODELS = {
  chatgpt: 'gpt-6-astra',
  claude: 'claude-opus-5',
  gemini: 'gemini-3.7-flash',
  grok: 'grok-4.5',
};

const JUDGE_MODEL = 'gpt-6-astra';

const REQUEST_TIMEOUT = 90000;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 12000;

if (!API_KEY) {
  console.error('❌ AVALAI_API_KEY پیدا نشد');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return { valid: false, error: 'تاریخچه نامعتبر است' };
  }

  if (messages.length > MAX_MESSAGES) {
    return { valid: false, error: 'تعداد پیام زیاد است' };
  }

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'پیام نامعتبر' };
    }

    if (!['user', 'assistant', 'system'].includes(message.role)) {
      return { valid: false, error: 'role نامعتبر' };
    }

    if (typeof message.content !== 'string') {
      return { valid: false, error: 'متن پیام نامعتبر' };
    }

    if (message.content.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: 'پیام خیلی طولانی است' };
    }
  }

  return { valid: true };
}

async function askModel(modelKey, messages) {
  const requestedModel = modelKey === 'judge' ? JUDGE_MODEL : MODELS[modelKey];

  const validation = validateMessages(messages);

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      requestedModel,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: requestedModel,
        messages,
      }),
      signal: controller.signal,
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: 'پاسخ API JSON نبود',
        requestedModel,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: data?.error?.message || 'خطای API',
        requestedModel,
      };
    }

    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error: 'پاسخ خالی',
        requestedModel,
      };
    }

    return {
      success: true,
      content,
      requestedModel,
      actualModel: data?.model || requestedModel,
    };
  } catch (error) {
    return {
      success: false,
      error: error.name === 'AbortError' ? 'زمان پاسخ تمام شد' : 'خطا در ارتباط API',
      requestedModel,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function judgeAnswers(question, answers) {
  const prompt = `
تو داور حرفه‌ای AI Arena هستی.

چهار پاسخ هوش مصنوعی زیر را مقایسه کن.

سوال کاربر:
${question}

پاسخ ChatGPT:
${answers.chatgpt}

پاسخ Claude:
${answers.claude}

پاسخ Gemini:
${answers.gemini}

پاسخ Grok:
${answers.grok}

معیارهای ارزیابی:
- دقت
- استدلال
- کامل بودن
- کاربردی بودن
- کیفیت نوشتار

فقط JSON معتبر برگردان:
{
"winner":"chatgpt",
"scores":{
"chatgpt":0,
"claude":0,
"gemini":0,
"grok":0
},
"reason":"",
"summary":""
}

امتیازها از 0 تا 10 باشند.
`;

  const result = await askModel('judge', [{ role: 'user', content: prompt }]);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  try {
    const cleaned = result.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const data = JSON.parse(cleaned);

    const modelKeys = Object.keys(MODELS);
    const validWinner = modelKeys.includes(data.winner) ? data.winner : null;

    const scores = {};
    modelKeys.forEach((key) => {
      const raw = Number(data.scores?.[key]);
      scores[key] = Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0;
    });

    return {
      success: true,
      data: {
        winner: validWinner,
        scores,
        reason: typeof data.reason === 'string' ? data.reason : '',
        summary: typeof data.summary === 'string' ? data.summary : '',
      },
    };
  } catch {
    return { success: false, error: 'خروجی داور JSON معتبر نبود' };
  }
}

app.post('/ask', async (req, res) => {
  try {
    const { histories } = req.body;

    if (!histories || typeof histories !== 'object') {
      return res.status(400).json({ error: 'داده مکالمه ناقص است' });
    }

    const modelKeys = Object.keys(MODELS);

    const responses = await Promise.allSettled(
      modelKeys.map((key) => askModel(key, histories[key]))
    );

    const results = {};

    modelKeys.forEach((key, index) => {
      const item = responses[index];

      if (item.status === 'fulfilled') {
        results[key] = item.value;
      } else {
        results[key] = { success: false, error: 'خطای داخلی' };
      }
    });

    const actualModels = {};

    modelKeys.forEach((key) => {
      actualModels[key] = results[key]?.actualModel || MODELS[key];
    });

    let question = '';

    Object.values(histories).forEach((history) => {
      const lastUser = history.filter((m) => m.role === 'user').pop();
      if (lastUser) {
        question = lastUser.content;
      }
    });

    const answers = {};

    modelKeys.forEach((key) => {
      answers[key] = results[key]?.content || 'پاسخی دریافت نشد';
    });

    const judge = await judgeAnswers(question, answers);

    res.json({
      results,
      models: actualModels,
      actualModels,
      judge,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    models: MODELS,
    judge: JUDGE_MODEL,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
  console.table(MODELS);
});
