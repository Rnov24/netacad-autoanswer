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
        "mercuryApiKey",
        "useDecisionModelForMcq",
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
          openrouter: "inception/mercury-decide:free",
        };

        resolve({
          provider,
          apiKey: res[keyField] || "",
          model: res[modelField] || defaults[provider] || "",
          geminiApiKey: res.geminiApiKey || "",
          geminiModel: res.geminiModel || defaults.gemini,
          openrouterApiKey: res.openrouterApiKey || (provider === "openrouter" ? res[keyField] : ""),
          openrouterModel: res.openrouterModel || defaults.openrouter,
          mercuryApiKey: res.mercuryApiKey || "",
          useDecisionModelForMcq: res.useDecisionModelForMcq === true,
        });
      }
    );
  });
}

/**
 * Infer the course subject from the browser page title.
 * Returns a short string used in the system prompt to orient the AI.
 */
function inferCourseSubject() {
  try {
    if (typeof document === "undefined") return "Cisco networking";
    const title = (document.title || "").toLowerCase();
    if (title.includes("python") || title.includes("pcap") || title.includes("pcep")) return "Python programming";
    if (title.includes("cyber") || title.includes("security") || title.includes("ensa")) return "Cisco cybersecurity / ENSA";
    if (title.includes("devnet") || title.includes("devasc")) return "Cisco DevNet / network automation";
    if (title.includes("linux") || title.includes("ndg")) return "Linux / NDG";
    if (title.includes("itn") || title.includes("ccna")) return "Cisco CCNA networking";
    if (title.includes("srwe") || title.includes("ensa")) return "Cisco networking and security";
  } catch (_) {}
  return "Cisco networking";
}

function buildSinglePrompt(question, answers, questionType = null) {
  const isMatching = question.toLowerCase().includes("matching question") || question.toLowerCase().includes("order");
  const inferredType = isMatching ? "OBJECT_MATCHING" : (questionType || "MCQ_SINGLE");
  const subject = inferCourseSubject();
  return `You are an expert in ${subject}. Analyze the question type and determine the correct answer.

Question:
${question}

Options / Available items:
${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}

INSTRUCTIONS:
1. The DOM-detected question input type is: "${inferredType}". Use this as a strong hint.
   Confirm or adjust based on question wording. Valid types:
   - "MCQ_SINGLE" (radio buttons — exactly one correct answer)
   - "MCQ_MULTIPLE" (checkboxes — one or more correct answers; select ALL that apply)
   - "OBJECT_MATCHING" (matching/connecting category circles A, B, C... to option items)
   - "FILL_IN_BLANK" (text input question)

2. Determine the correct answer(s) into "answer":
   - For MCQ_SINGLE: exact option text of the single correct answer.
   - For MCQ_MULTIPLE: ALL correct option texts, each separated by ' /// '.
   - For OBJECT_MATCHING: 'A: <exact text> /// B: <exact text> /// C: <exact text>'. Use exact text from options list.
   - For FILL_IN_BLANK: the answer text to type.
   - For questions involving numbers, IP addresses, subnet masks, or technical notation: return the EXACT string as shown in the option list, including all digits, dots, slashes, and units. Do NOT paraphrase or round.
   - For code snippet / math questions: carefully check return types (list vs tuple) and operators (e.g. x**x exponentiation vs x*x multiplication).

3. Output your answer in structured JSON format with keys "type" and "answer":
{
  "type": "${inferredType}",
  "answer": "exact answer string"
}
Return ONLY valid JSON.`;
}

function buildBatchPrompt(questionsWithAnswers) {
  const formattedQuestions = questionsWithAnswers
    .map((q, idx) => {
      const isMatching = q.question.toLowerCase().includes("matching question") || q.question.toLowerCase().includes("order");
      const typeHint = isMatching ? "OBJECT_MATCHING" : (q.questionType || "MCQ_SINGLE");
      return `[QUESTION ${idx + 1}] (DOM-DETECTED TYPE: ${typeHint})
${q.question}
Options / Items:
${q.answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
    })
    .join("\n\n");

  const subject = inferCourseSubject();
  return `You are an expert in ${subject} answering quiz questions.

For each question below:
1. Analyze the question type ("MCQ_SINGLE", "MCQ_MULTIPLE", "OBJECT_MATCHING", or "FILL_IN_BLANK").
2. Determine the correct answer.

${formattedQuestions}

CRITICAL INSTRUCTIONS:
- The "DOM-DETECTED TYPE" in each question header is a strong hint based on checkbox vs radio DOM analysis. Honor it unless question wording clearly contradicts it.
- For MCQ_SINGLE: return one exact option text.
- For MCQ_MULTIPLE: return ALL correct options separated by ' /// '. Select every answer that applies — do NOT limit to one.
- For OBJECT_MATCHING: output ALL pairs: 'A: <exact option text> /// B: <exact option text>'.
- For questions involving numbers, IP addresses, subnet masks, or technical notation: return the EXACT string as shown in the option list, including all digits, dots, slashes, and units. Do NOT paraphrase or round.
- For code snippet / math questions: carefully check return types (list vs tuple) and operators (e.g. x**x exponentiation vs x*x multiplication).
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
      max_tokens: 4096,
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
  const model = modelName || "google/gemini-2.5-flash";
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
  // Preserve object-matching pairs like "A: text" — never strip
  if (/^[A-Z]:\s+/i.test(trimmed)) return trimmed;
  // Only strip numbered list prefixes (1–2 digit number followed by ). or ]. or ): or -  then space)
  // NOT values like "128 bits", "10.0.0.1" etc.
  return trimmed
    .replace(/^\d{1,2}[\.\)\:\-]\s+/, "")  // "1. " "99) " etc — at most 2 digits
    .replace(/^[a-zA-Z][\.\)\:\-]\s+/, "") // "A. " "b) " etc — single letter
    .replace(/^[\-\*]\s+/, "")             // "- " "* " bullet points
    .trim();
}

// ─────────────────────────────────────────────
// OpenRouter Structured Decision Model Support (inception/mercury-decide:free)
// ─────────────────────────────────────────────

async function callOpenRouterDecisionsApi(state, questionsDict, apiKey, modelName = "inception/mercury-decide:free") {
  const model = modelName || "inception/mercury-decide:free";
  const url = "https://openrouter.ai/api/alpha/decisions";

  const payload = {
    model: model,
    state: state,
    questions: questionsDict,
  };

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
    throw new Error(`OpenRouter Decisions API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

function buildDecisionCriteria(answers) {
  const criteria = {};
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  (answers || []).forEach((ans, idx) => {
    const l = letters[idx] || `opt_${idx + 1}`;
    criteria[`option_${l}`] = ans;
  });
  return criteria;
}

function extractDecisionConfidence(ansData) {
  if (!ansData || typeof ansData !== "object") return 0;
  if (typeof ansData.confidence === "number") return ansData.confidence;
  if (ansData.probabilities && typeof ansData.probabilities === "object") {
    const values = Object.values(ansData.probabilities).map(Number).filter((n) => !isNaN(n));
    if (values.length > 0) return Math.max(...values);
  }
  return 0;
}

function mapDecisionChoiceToAnswer(ansData, answers, criteria) {
  if (!ansData || !answers || answers.length === 0) return null;

  let choice = ansData.choice;
  if (!choice && ansData.probabilities && typeof ansData.probabilities === "object") {
    let maxP = -1;
    for (const [k, p] of Object.entries(ansData.probabilities)) {
      const val = Number(p);
      if (!isNaN(val) && val > maxP) {
        maxP = val;
        choice = k;
      }
    }
  }

  if (!choice || typeof choice !== "string") return null;
  const choiceTrimmed = choice.trim();
  const choiceLower = choiceTrimmed.toLowerCase();

  // Pattern 1: "option_a", "Option A", "a", "option a"
  const letterMatch = choiceLower.match(/^(?:option[_\s]*)?([a-z])\b/i);
  if (letterMatch) {
    const letter = letterMatch[1].toLowerCase();
    const idx = letter.charCodeAt(0) - 97;
    if (idx >= 0 && idx < answers.length) {
      return answers[idx];
    }
  }

  // Pattern 2: Criteria keys or values
  if (criteria && typeof criteria === "object") {
    for (const [k, v] of Object.entries(criteria)) {
      if (k.toLowerCase() === choiceLower || (typeof v === "string" && v.trim().toLowerCase() === choiceLower)) {
        return v;
      }
    }
  }

  // Pattern 3: Exact answer option
  for (const ans of answers) {
    if (ans.trim().toLowerCase() === choiceLower) {
      return ans;
    }
  }

  return null;
}

/**
 * Fallback to Gemini when confidence < 70% or when Decision Model fails.
 * Prefers direct Google Gemini API if key is present, otherwise falls back to Gemini via OpenRouter.
 */
async function answerWithGeminiFallback(question, answers, questionType = "MCQ_SINGLE", cfg = null, overrideApiKey = null) {
  const config = cfg || (await getProviderConfig());
  const prompt = buildSinglePrompt(question, answers, questionType);

  // 1. Native Gemini API
  if (config.geminiApiKey) {
    try {
      console.log("NetAcad Decision Engine: Falling back to native Google Gemini API...");
      const raw = await callGeminiApi(prompt, config.geminiApiKey, config.geminiModel || "gemini-3.6-flash", true);
      const parsed = safeParseJsonResponse(raw);
      if (parsed && typeof parsed.answer === "string") return cleanOptionPrefix(parsed.answer);
      if (typeof parsed === "string") return cleanOptionPrefix(parsed);
      return cleanOptionPrefix(raw);
    } catch (err) {
      console.warn("NetAcad Decision Engine: Direct Gemini API fallback failed, attempting OpenRouter Gemini...", err);
    }
  }

  // 2. OpenRouter Gemini Flash fallback
  const orKey = overrideApiKey || config.mercuryApiKey || config.openrouterApiKey || (config.provider === "openrouter" ? config.apiKey : "");
  if (orKey) {
    console.log("NetAcad Decision Engine: Falling back to Gemini via OpenRouter (google/gemini-2.5-flash)...");
    const raw = await callOpenRouterApi(prompt, orKey, "google/gemini-2.5-flash", true);
    const parsed = safeParseJsonResponse(raw);
    if (parsed && typeof parsed.answer === "string") return cleanOptionPrefix(parsed.answer);
    if (typeof parsed === "string") return cleanOptionPrefix(parsed);
    return cleanOptionPrefix(raw);
  }

  throw new Error("Gemini fallback failed: Neither Gemini nor OpenRouter API key is configured.");
}

async function getAiAnswer(questionText, answerTexts, overrideApiKey = null, questionType = null) {
  try {
    const cfg = await getProviderConfig();
    const isMcqSingle = (questionType === "MCQ_SINGLE" || !questionType) &&
                        answerTexts && answerTexts.length >= 2 &&
                        !questionText.toLowerCase().includes("matching question") &&
                        !questionText.toLowerCase().includes("order");

    const shouldUseDecision = isMcqSingle && (
      (cfg.provider === "openrouter" && (cfg.model || "").includes("decide")) ||
      cfg.useDecisionModelForMcq === true
    );

    if (shouldUseDecision) {
      const orApiKey = overrideApiKey || cfg.mercuryApiKey || cfg.openrouterApiKey || (cfg.provider === "openrouter" ? cfg.apiKey : "");
      if (orApiKey) {
        const decModel = (cfg.provider === "openrouter" && (cfg.model || "").includes("decide"))
          ? cfg.model
          : "inception/mercury-decide:free";
        const subject = inferCourseSubject();
        const state = `Cisco Networking Academy assessment for ${subject}. Evaluate the following technical multiple choice question against the criteria options to select the single strictly accurate answer.`;
        const criteria = buildDecisionCriteria(answerTexts);

        try {
          console.log(`NetAcad Decision Engine: Querying ${decModel} for multiple choice question...`);
          const decResult = await callOpenRouterDecisionsApi(
            state,
            {
              question_1: {
                type: "choice",
                instructions: questionText,
                criteria: criteria,
              },
            },
            orApiKey,
            decModel
          );

          const qAns = decResult.answers?.question_1 || Object.values(decResult.answers || {})[0];
          const confidence = extractDecisionConfidence(qAns);
          console.log(`NetAcad Decision Engine: Question confidence: ${(confidence * 100).toFixed(1)}%`);

          if (confidence >= 0.70) {
            const chosenAnswer = mapDecisionChoiceToAnswer(qAns, answerTexts, criteria);
            if (chosenAnswer) {
              console.log(`NetAcad Decision Engine: Answer accepted with ${(confidence * 100).toFixed(1)}% confidence: "${chosenAnswer}"`);
              return cleanOptionPrefix(chosenAnswer);
            }
          }

          console.log(`NetAcad Decision Engine: Confidence ${(confidence * 100).toFixed(1)}% is under 70% threshold. Falling back to Gemini...`);
          return await answerWithGeminiFallback(questionText, answerTexts, "MCQ_SINGLE", cfg, overrideApiKey);
        } catch (decErr) {
          console.warn("NetAcad Decision Engine: Decision API error, falling back to Gemini:", decErr);
          return await answerWithGeminiFallback(questionText, answerTexts, "MCQ_SINGLE", cfg, overrideApiKey);
        }
      }
    }

    const prompt = buildSinglePrompt(questionText, answerTexts, questionType);
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
    const cfg = await getProviderConfig();
    const isDecisionConfigured = (cfg.provider === "openrouter" && (cfg.model || "").includes("decide")) ||
                                 cfg.useDecisionModelForMcq === true;
    const orApiKey = overrideApiKey || cfg.mercuryApiKey || cfg.openrouterApiKey || (cfg.provider === "openrouter" ? cfg.apiKey : "");

    if (isDecisionConfigured && orApiKey) {
      const decModel = (cfg.provider === "openrouter" && (cfg.model || "").includes("decide"))
        ? cfg.model
        : "inception/mercury-decide:free";

      const subject = inferCourseSubject();
      const state = `Cisco Networking Academy assessment for ${subject}. Evaluate the following technical multiple choice question against the criteria options to select the single strictly accurate answer.`;

      // Partition questions into decision-eligible vs fallback
      const decisionEligible = [];
      const answersArray = new Array(questionsWithAnswers.length).fill(null);
      const questionsDict = {};

      questionsWithAnswers.forEach((q, idx) => {
        const isMcqSingle = (q.questionType === "MCQ_SINGLE" || !q.questionType) &&
                            q.answers && q.answers.length >= 2 &&
                            !q.question.toLowerCase().includes("matching question") &&
                            !q.question.toLowerCase().includes("order");
        if (isMcqSingle) {
          const criteria = buildDecisionCriteria(q.answers);
          const qKey = `question_${idx + 1}`;
          questionsDict[qKey] = {
            type: "choice",
            instructions: q.question,
            criteria: criteria,
          };
          decisionEligible.push({ idx, qKey, criteria, q });
        }
      });

      const fallbackIndices = [];

      // If we have questions eligible for decision model:
      if (decisionEligible.length > 0) {
        try {
          console.log(`NetAcad Decision Engine: Querying ${decModel} for ${decisionEligible.length} MCQ question(s)...`);
          const decResult = await callOpenRouterDecisionsApi(state, questionsDict, orApiKey, decModel);
          const ansDict = decResult.answers || {};

          for (const item of decisionEligible) {
            const qAns = ansDict[item.qKey];
            const confidence = extractDecisionConfidence(qAns);
            console.log(`NetAcad Decision Engine: Q${item.idx + 1} confidence: ${(confidence * 100).toFixed(1)}%`);

            if (confidence >= 0.70) {
              const chosen = mapDecisionChoiceToAnswer(qAns, item.q.answers, item.criteria);
              if (chosen) {
                console.log(`NetAcad Decision Engine: Q${item.idx + 1} decided: "${chosen}" (Confidence: ${(confidence * 100).toFixed(1)}%)`);
                answersArray[item.idx] = cleanOptionPrefix(chosen);
                continue;
              }
            }

            console.log(`NetAcad Decision Engine: Q${item.idx + 1} confidence ${(confidence * 100).toFixed(1)}% < 70%. Enqueuing for Gemini fallback.`);
            fallbackIndices.push(item.idx);
          }
        } catch (decErr) {
          console.warn("NetAcad Decision Engine: Batch Decision API error, routing all eligible to Gemini fallback:", decErr);
          decisionEligible.forEach((item) => fallbackIndices.push(item.idx));
        }
      }

      // Add non-MCQ questions (matching, fill-in-blank, multi-select) to fallback
      questionsWithAnswers.forEach((_, idx) => {
        if (!answersArray[idx] && !fallbackIndices.includes(idx)) {
          fallbackIndices.push(idx);
        }
      });

      // Execute Gemini fallback for questions that need it
      if (fallbackIndices.length > 0) {
        console.log(`NetAcad Decision Engine: Executing Gemini fallback for ${fallbackIndices.length} question(s)...`);
        for (const fIdx of fallbackIndices) {
          try {
            const q = questionsWithAnswers[fIdx];
            const ans = await answerWithGeminiFallback(q.question, q.answers, q.questionType, cfg, overrideApiKey);
            answersArray[fIdx] = cleanOptionPrefix(ans);
          } catch (fbErr) {
            console.error(`NetAcad Decision Engine: Gemini fallback failed for question ${fIdx + 1}:`, fbErr);
            answersArray[fIdx] = `Error: ${fbErr.message}`;
          }
        }
      }

      return { answers: answersArray };
    }

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
  callOpenRouterDecisionsApi,
  answerWithGeminiFallback,
  safeParseJsonResponse,
};

if (typeof window !== "undefined") {
  Object.assign(window, apiExports);
}

if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, apiExports);
}
