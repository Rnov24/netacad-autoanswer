// Multi-Provider AI Engine for NetAcad AutoAnswer (Structured Output & Question Type Analysis)

function getProviderConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      [
        "aiProvider",
        "geminiApiKey", "geminiModel",
        "groqApiKey", "groqModel",
        "openaiApiKey", "openaiModel",
        "anthropicApiKey", "anthropicModel",
        "openrouterApiKey", "openrouterModel",
      ],
      (res) => {
        const provider = res.aiProvider || "gemini";
        const keyField = `${provider}ApiKey`;
        const modelField = `${provider}Model`;

        const defaults = {
          gemini: "gemini-3.6-flash",
          groq: "llama-3.3-70b-versatile",
          openai: "gpt-4o-mini",
          anthropic: "claude-3-5-haiku-latest",
          openrouter: "google/gemini-2.5-flash",
        };

        resolve({
          provider,
          apiKey: res[keyField] || "",
          model: res[modelField] || defaults[provider] || "",
        });
      }
    );
  });
}

function buildSinglePrompt(question, answers) {
  const isMatching = question.toLowerCase().includes("matching question") || question.toLowerCase().includes("order");
  return `You are a Cisco CCNA networking expert. Analyze the question type and determine the correct answer.

Question:
${question}

Options / Available items:
${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}

INSTRUCTIONS:
1. Analyze and classify the question type into "type":
   - "MCQ_SINGLE" (single choice multiple-choice question)
   - "MCQ_MULTIPLE" (multiple select question)
   - "OBJECT_MATCHING" (matching/connecting category circles A, B, C... to option items)
   - "FILL_IN_BLANK" (text input question)

2. Determine the correct answer(s) into "answer":
   - For MCQ_SINGLE: exact option text.
   - For MCQ_MULTIPLE: exact option texts separated by ' /// '.
   - For OBJECT_MATCHING: 'A: <exact text> /// B: <exact text> /// C: <exact text>'. Use exact text from options list without paraphrasing.

3. Output your answer in structured JSON format with keys "type" and "answer":
{
  "type": "${isMatching ? "OBJECT_MATCHING" : "MCQ_SINGLE"}",
  "answer": "exact answer string"
}
Return ONLY valid JSON.`;
}

function buildBatchPrompt(questionsWithAnswers) {
  const formattedQuestions = questionsWithAnswers
    .map((q, idx) => {
      const isMatching = q.question.toLowerCase().includes("matching question") || q.question.toLowerCase().includes("order");
      return `[QUESTION ${idx + 1}] ${isMatching ? "(TYPE: OBJECT_MATCHING)" : ""}
${q.question}
Options / Items:
${q.answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
    })
    .join("\n\n");

  return `You are a Cisco CCNA networking expert answering quiz questions.

For each question below:
1. Analyze the question type ("MCQ_SINGLE", "MCQ_MULTIPLE", "OBJECT_MATCHING", or "FILL_IN_BLANK").
2. Determine the correct answer.

${formattedQuestions}

CRITICAL INSTRUCTIONS:
- Return a JSON object containing key "results" with an array of objects for each question in exact order:
{
  "results": [
    {
      "type": "MCQ_SINGLE",
      "answer": "answer for question 1"
    },
    {
      "type": "OBJECT_MATCHING",
      "answer": "A: text /// B: text"
    }
  ]
}
- For normal MCQ: return exact option text. If multiple apply, separate with ' /// '.
- For OBJECT_MATCHING: output ALL pairs on one line: 'A: <exact option text> /// B: <exact option text>'. Use exact text from items list.
- Return ONLY valid JSON object with no extra text outside JSON.`;
}

// Robust JSON Extractor & Sanitizer
function safeParseJsonResponse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty response received from AI provider.");
  }

  let clean = rawText.trim();
  if (clean.includes("```")) {
    clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  }

  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  const firstBracket = clean.indexOf("[");
  const lastBracket = clean.lastIndexOf("]");

  let jsonStr = clean;
  if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    jsonStr = clean.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1) {
    jsonStr = clean.slice(firstBracket, lastBracket + 1);
  }

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("NetAcad API Engine: Failed to parse JSON response:", rawText);
    throw new Error(`Invalid JSON output from AI provider: ${err.message}`);
  }
}

// --- Provider Implementations with Structured Output (JSON mode) ---

async function callGeminiApi(prompt, apiKey, modelName, useJsonMode = false) {
  const model = modelName || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  if (useJsonMode) {
    payload.generationConfig = { responseMimeType: "application/json" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Invalid response format from Gemini API.");
  return text.trim();
}

async function callGroqApi(prompt, apiKey, modelName, useJsonMode = false) {
  const model = modelName || "llama-3.3-70b-versatile";
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const payload = {
    model: model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  };

  if (useJsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Invalid response format from Groq API.");
  return text.trim();
}

async function callOpenAiApi(prompt, apiKey, modelName, useJsonMode = false) {
  const model = modelName || "gpt-4o-mini";
  const url = "https://api.openai.com/v1/chat/completions";

  const payload = {
    model: model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  };

  if (useJsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Invalid response format from OpenAI API.");
  return text.trim();
}

async function callAnthropicApi(prompt, apiKey, modelName, useJsonMode = false) {
  const model = modelName || "claude-3-5-haiku-latest";
  const url = "https://api.anthropic.com/v1/messages";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error("Invalid response format from Anthropic API.");
  return text.trim();
}

async function callOpenRouterApi(prompt, apiKey, modelName, useJsonMode = false) {
  const model = modelName || "openai/gpt-4o-mini";
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const payload = {
    model: model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  };

  if (useJsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://netacad.com",
      "X-Title": "NetAcad AutoAnswer",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Invalid response format from OpenRouter API.");
  return text.trim();
}

function parseRateLimitDelayMs(errorMsg) {
  if (!errorMsg || typeof errorMsg !== "string") return 6000;
  const matchSec = errorMsg.match(/try again in\s+([0-9\.]+)\s*s/i) || errorMsg.match(/in\s+([0-9\.]+)\s*s/i);
  if (matchSec && matchSec[1]) {
    const seconds = parseFloat(matchSec[1]);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 1000;
    }
  }
  return 6000;
}

async function queryAiProvider(prompt, overrideApiKey = null, useJsonMode = false, retries = 2) {
  const cfg = await getProviderConfig();
  const apiKey = overrideApiKey || cfg.apiKey;
  const provider = cfg.provider;
  const model = cfg.model;

  if (!apiKey) {
    throw new Error(`API Key for ${provider} is missing. Please set it in extension popup.`);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      switch (provider) {
        case "groq":
          return await callGroqApi(prompt, apiKey, model, useJsonMode);
        case "openai":
          return await callOpenAiApi(prompt, apiKey, model, useJsonMode);
        case "anthropic":
          return await callAnthropicApi(prompt, apiKey, model, useJsonMode);
        case "openrouter":
          return await callOpenRouterApi(prompt, apiKey, model, useJsonMode);
        case "gemini":
        default:
          return await callGeminiApi(prompt, apiKey, model, useJsonMode);
      }
    } catch (err) {
      const errMsg = err ? err.message || "" : "";
      const isRateLimit = errMsg.includes("429") || errMsg.toLowerCase().includes("rate_limit") || errMsg.toLowerCase().includes("rate limit");

      if (isRateLimit && attempt < retries) {
        const waitMs = parseRateLimitDelayMs(errMsg);
        const waitSec = Math.round(waitMs / 1000);
        console.warn(`NetAcad AI Engine: Rate limit hit for ${provider} (${model}). Retrying attempt ${attempt + 1}/${retries} in ${waitSec}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        if (isRateLimit) {
          const waitMs = parseRateLimitDelayMs(errMsg);
          const waitSec = Math.round(waitMs / 1000);
          throw new Error(`Rate limit exceeded for ${provider} (${model}). Please wait ~${waitSec}s or switch to Gemini 3.6 Flash in extension popup.`);
        }
        throw err;
      }
    }
  }
}

function cleanOptionPrefix(str) {
  if (!str || typeof str !== "string") return str;
  const trimmed = str.trim();
  if (/^[A-Z]:\s+/i.test(trimmed)) return trimmed;
  return trimmed.replace(/^(?:[0-9]+|[a-zA-Z])[\.\)\:\-]\s*/, "").replace(/^[\-\*]\s*/, "").trim();
}

async function getAiAnswer(questionText, answerTexts, overrideApiKey = null) {
  try {
    const prompt = buildSinglePrompt(questionText, answerTexts);
    const rawResponse = await queryAiProvider(prompt, overrideApiKey, true);

    try {
      const parsed = safeParseJsonResponse(rawResponse);
      if (parsed && typeof parsed === "object") {
        if (parsed.type) {
          console.debug(`NetAcad AI Engine: Analyzed Question Type "${parsed.type}"`);
        }
        if (typeof parsed.answer === "string") {
          return cleanOptionPrefix(parsed.answer);
        }
      }
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
        return cleanOptionPrefix(parsed[0]);
      }
    } catch (_) {
      return cleanOptionPrefix(rawResponse.replace(/```json/g, "").replace(/```/g, ""));
    }
    return cleanOptionPrefix(rawResponse.replace(/```json/g, "").replace(/```/g, ""));
  } catch (error) {
    console.error("NetAcad API Engine: Single question error:", error);
    return `Error calling AI API: ${error.message}`;
  }
}

async function getAiAnswersForBatch(questionsWithAnswers, overrideApiKey = null) {
  try {
    const prompt = buildBatchPrompt(questionsWithAnswers);
    const rawResponseText = await queryAiProvider(prompt, overrideApiKey, true);

    const parsed = safeParseJsonResponse(rawResponseText);
    let items = [];

    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && Array.isArray(parsed.results)) {
      items = parsed.results;
    } else if (parsed && Array.isArray(parsed.answers)) {
      items = parsed.answers;
    } else {
      throw new Error("AI response did not contain a valid results/answers array.");
    }

    const answersArray = items.map((item) => {
      if (item && typeof item === "object") {
        if (item.type) {
          console.debug(`NetAcad AI Engine: Analyzed Question Type "${item.type}"`);
        }
        if (typeof item.answer === "string") return cleanOptionPrefix(item.answer);
      }
      if (typeof item === "string") return cleanOptionPrefix(item);
      return cleanOptionPrefix(String(item || ""));
    });

    // Validate length matches — pad with error string if AI returned fewer answers
    while (answersArray.length < questionsWithAnswers.length) {
      answersArray.push("Error: AI did not return an answer for this question.");
    }

    return { answers: answersArray };
  } catch (error) {
    console.error("NetAcad API Engine: Batch question error:", error);
    return { error: `Error calling AI API: ${error.message}` };
  }
}

const apiExports = {
  getProviderConfig,
  getAiAnswer,
  getAiAnswersForBatch,
  queryAiProvider,
  safeParseJsonResponse,
};

if (typeof window !== "undefined") {
  Object.assign(window, apiExports);
}

if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, apiExports);
}
