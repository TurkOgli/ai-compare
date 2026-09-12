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
  grok: 'grok-4.5'
};

const REQUEST_TIMEOUT = 90000;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 12000;

if (!API_KEY) {
  console.error('❌ AVALAI_API_KEY داخل .env پیدا نشد.');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));


/* =========================================================
   VALIDATION
========================================================= */

function validateMessages(messages) {

  if (!Array.isArray(messages)) {
    return {
      valid: false,
      error: 'تاریخچه مکالمه نامعتبر است.'
    };
  }

  if (messages.length > MAX_MESSAGES) {
    return {
      valid: false,
      error: `حداکثر ${MAX_MESSAGES} پیام مجاز است.`
    };
  }

  for (const message of messages) {

    if (!message || typeof message !== 'object') {
      return {
        valid: false,
        error: 'ساختار پیام نامعتبر است.'
      };
    }

    if (!['user', 'assistant', 'system'].includes(message.role)) {
      return {
        valid: false,
        error: 'نقش پیام نامعتبر است.'
      };
    }

    if (typeof message.content !== 'string') {
      return {
        valid: false,
        error: 'محتوای پیام باید متن باشد.'
      };
    }

    if (message.content.length > MAX_MESSAGE_LENGTH) {
      return {
        valid: false,
        error: 'پیام بیش از حد طولانی است.'
      };
    }
  }

  return {
    valid: true
  };
}


/* =========================================================
   ASK MODEL
========================================================= */

async function askModel(modelKey, messages) {

  const requestedModel =
    MODELS[modelKey];

  const validation =
    validateMessages(messages);

  if (!validation.valid) {

    return {
      success: false,
      error: validation.error,
      requestedModel
    };

  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

  try {

    const response =
      await fetch(
        BASE_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${API_KEY}`
          },

          body: JSON.stringify({
            model: requestedModel,
            messages
          }),

          signal:
            controller.signal
        }
      );


    const text =
      await response.text();


    let data;

    try {

      data =
        JSON.parse(text);

    } catch {

      console.error(
        `[${modelKey}] پاسخ JSON نبود:`,
        text
      );

      return {
        success: false,
        error:
          'پاسخ نامعتبر از API دریافت شد.',
        requestedModel
      };

    }


    /* -----------------------------------------
       API ERROR
    ----------------------------------------- */

    if (!response.ok) {

      console.error(
        `[${modelKey}] ${response.status}:`,
        JSON.stringify(data)
      );

      return {
        success: false,

        error:
          data?.error?.message ||
          data?.message ||
          `خطای API (${response.status})`,

        requestedModel,

        apiModel:
          data?.model ||
          data?.model_id ||
          null
      };

    }


    /* -----------------------------------------
       CONTENT
    ----------------------------------------- */

    const content =
      data?.choices?.[0]?.message?.content;


    if (
      content === undefined ||
      content === null ||
      content === ''
    ) {

      return {
        success: false,

        error:
          'API پاسخ متنی برنگرداند.',

        requestedModel,

        apiModel:
          data?.model ||
          data?.model_id ||
          null
      };

    }


    /* -----------------------------------------
       REAL MODEL NAME
       
       اولویت:
       1. choices[0].model
       2. data.model
       3. data.model_id
       4. مدل درخواستی
    ----------------------------------------- */

    const actualModel =
      data?.choices?.[0]?.model ||
      data?.model ||
      data?.model_id ||
      requestedModel;


    console.log(
      `✅ ${modelKey}`
    );

    console.log(
      `   Requested: ${requestedModel}`
    );

    console.log(
      `   Actual:    ${actualModel}`
    );


    return {
      success: true,

      content,

      requestedModel,

      actualModel,

      providerModel:
        data?.model ||
        data?.model_id ||
        null,

      usage:
        data?.usage ||
        null

    };


  } catch (error) {

    console.error(
      `[${modelKey}]`,
      error
    );


    if (
      error.name ===
      'AbortError'
    ) {

      return {
        success: false,

        error:
          'زمان پاسخ‌گویی مدل تمام شد.',

        requestedModel
      };

    }


    return {
      success: false,

      error:
        'خطا در ارتباط با API.',

      requestedModel
    };


  } finally {

    clearTimeout(timeout);

  }

}


/* =========================================================
   ASK ALL
========================================================= */

app.post(
  '/ask',
  async (req, res) => {

    const {
      histories
    } = req.body;


    if (
      !histories ||
      typeof histories !== 'object'
    ) {

      return res
        .status(400)
        .json({
          error:
            'داده مکالمه ناقص است.'
        });

    }


    const modelKeys =
      Object.keys(MODELS);


    const resultsArray =
      await Promise.allSettled(

        modelKeys.map(
          key =>
            askModel(
              key,
              histories[key]
            )
        )

      );


    const results = {};


    modelKeys.forEach(
      (key, index) => {

        const result =
          resultsArray[index];


        if (
          result.status ===
          'fulfilled'
        ) {

          results[key] =
            result.value;

        } else {

          results[key] = {

            success: false,

            error:
              'خطای غیرمنتظره در سرور.',

            requestedModel:
              MODELS[key]

          };

        }

      }
    );


    /*
      مدل پیش‌فرضی که درخواست شده
    */
    const requestedModels = {};


    /*
      مدل واقعی‌ای که API گزارش کرده
    */
    const actualModels = {};


    modelKeys.forEach(key => {

      requestedModels[key] =
        results[key]?.requestedModel ||
        MODELS[key];


      actualModels[key] =
        results[key]?.actualModel ||
        results[key]?.providerModel ||
        results[key]?.requestedModel ||
        MODELS[key];

    });


    res.json({

      results,

      /*
        برای نمایش در UI
      */
      models: actualModels,

      /*
        برای دیباگ و بررسی
      */
      requestedModels,

      actualModels

    });

  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/health',
  (req, res) => {

    res.json({

      status: 'ok',

      models: MODELS

    });

  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `🚀 Server running: http://localhost:${PORT}`
    );

    console.log(
      '🤖 Requested models:'
    );

    console.table(
      MODELS
    );

  }
);