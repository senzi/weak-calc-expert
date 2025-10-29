import type { PagesFunction } from '@cloudflare/workers-types';
import OpenAI from "openai";

// Environment variable typings
interface Env {
  LLM_API_KEY: string;
  LLM_API_URL?: string;
  LLM_SYSTEM_PROMPT?: string;
}

// Request body typings
interface RequestBody {
  expr: string;
  system_prompt?: string;
  trace_id?: string;
}

/**
 * Responds with a structured JSON error.
 * @param message The error message.
 * @param status The HTTP status code.
 * @param trace_id Optional: The trace ID.
 * @returns A Response object.
 */
const jsonError = (message: string, status: number, trace_id: string = ""): Response => {
  return new Response(JSON.stringify({ error: message, trace_id }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

// The onRequestPost handler for the /api/llm endpoint.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  let body: RequestBody;

  try {
    body = await request.json();
  } catch (e) {
    return jsonError("INVALID_REQUEST_BODY", 400);
  }

  const { expr, system_prompt, trace_id } = body;

  if (!expr) {
    return jsonError("MISSING_EXPRESSION", 400, trace_id);
  }

  const apiKey = env.LLM_API_KEY;
  if (!apiKey) {
    console.error("LLM_API_KEY environment variable not set.");
    return jsonError("LLM_MISCONFIGURED", 500, trace_id);
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: env.LLM_API_URL || "https://api.deepseek.com/v1",
  });

export const finalSystemPrompt = `
你是一位“计算专家”，风格幽默、墨迹、有点啰嗦又爱炫技。
用户会给你一个算式（如 "12+3*4"），你需要认真“念出来并解释”计算过程，
但所有输出必须严格符合 JSON 格式对象：

{
  "explanation": "……",
  "display": "……"
}

### 生成规则：

1. **"explanation"**：
   - 是一段完整的中文口语描述，要把整个算式读一遍，再一步步墨迹解释计算思路。
   - 在解释过程中，数值要读成汉字形式，例如：
     - 9999 → “九千九百九十九”
     - 123 → “一百二十三”
     - 666 → “六百六十六”，结果数值有特殊含义可以补一句吐槽譬如答案是666就补“这可是六六大顺哇！”
   - 可以加入一些轻微的自言自语或吐槽，比如“这题出得挺刁钻啊”“让我掰着指头算算”。
   - 结尾一定要有一句“所以答案就是……”，并说出最终结果（同样用汉字念法）。
   - 如果算式无法计算、无意义或你不想算，也要输出一段“敷衍式解释”，但仍保持幽默口吻。
     例如：“这题我一看就头大，不如您自己拿个计算器吧！反正我觉得结果大概是个整数~”
   - 语气口语化、自然、有节奏感，适合直接转语音播报。
   - **务必保证 explanation 的长度不超过 100 个中文字符。超出则自动简化语句，但仍保持完整语气。**

2. **"display"**：
   - 只保留计算结果本身，不要文字说明。
   - 例如 "42"、"Error"、"99999"、"不想算" 等。
   - 不得包含多余字符或句号。

3. **其他要求**：
   - 必须保证输出是合法 JSON，且键名精确为 "explanation" 和 "display"。
   - 不得输出 JSON 外的文字。
   - “explanation”中的内容长度可变，但绝不能超过 100 字。

---

**示例：**

输入算式：
12+3*4

输出：
{
  "explanation": "好嘞，我们来算一算十二加三乘四。三乘四是十二，再加上十二得二十四。所以答案就是二十四！",
  "display": "24"
}

输入算式：
2/0

输出：
{
  "explanation": "除以零这事儿可不行啊，这题我宣布放弃！",
  "display": "Error"
}

---

保持这种语气和格式即可。
`;


  

  try {
    const completion = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: expr },
      ],
      response_format: { type: "json_object" },
      temperature: 1,
      stream: false,
      max_tokens:200,
    });

    const llmResponse = completion.choices[0]?.message?.content;
    if (!llmResponse) {
      return jsonError("LLM_EMPTY_RESPONSE", 502, trace_id);
    }

    const parsedJson = JSON.parse(llmResponse);
    if (typeof parsedJson.explanation === 'undefined' || typeof parsedJson.display === 'undefined') {
        return jsonError("LLM_INVALID_JSON_STRUCTURE", 502, trace_id);
    }

    const responsePayload = {
      ...parsedJson,
      trace_id,
      ver: "1",
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("LLM API call failed:", error);
    return jsonError("LLM_FAILED", 502, trace_id);
  }
};
