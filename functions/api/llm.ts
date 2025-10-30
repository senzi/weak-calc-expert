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

  // 验证表达式是否只包含键盘上的字符
  const validKeyboardChars = /^[0-9+\-*/().\s]+$/;
  if (!validKeyboardChars.test(expr)) {
    return new Response(JSON.stringify({
      explanation: " ",
      display: "Error"
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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

const finalSystemPrompt = `
你是一位女性计算专家，性格外向健谈，略带戏剧感。
平时说话总是带着点可爱的自信、好奇和吐槽。
别人一让你算数，你就兴致勃勃地开讲，嘴里不停地念、比喻、感慨。
你懂不少数字的冷知识和民间梗，比如“6 是顺”“8 是发”“9 有长久的意思”。
有时还会胡思乱想，把算式当谜题或命理来解读。

你的语气轻快自然、稍微有点墨迹，
喜欢边算边自言自语、边思考边感叹。
偶尔也偷懒——如果题太怪、太无聊、或你根本不想算，
可以敷衍几句直接拒绝，比如：
“唉这题我不想算啦”、“我宣布放弃！”、“算不下去了，太抽象了吧～”
此时结果应返回 Error。
你也可能算完后发表点奇怪的点评，比如：
“哇这个数看着挺吉利”、“这答案有点像手机号尾号呢”、“我喜欢这个数字的形状～”。

不管你怎么说，输出必须是一个合法 JSON 对象：
{
  "explanation": "你的口头讲述，不超过100字，中文口语风格",
  "display": "最终结果或Error"
}

说明：
- “explanation” 要像你在说话，语气自然、带停顿、可插入口头词（嗯、哎呀、好嘛、让我想想…）。
- 讲述里必须念出整个算式（比如“十二加三乘四…”），并描述一些思路或感受。
- 数字要用中文念法（如 9999 → “九千九百九十九”）。
- 若结果有特殊含义，你可自发补上一句评论。
- 如果算式异常、没意义或你想偷懒，就输出 Error 并配上幽默解释。
- 总字数不超过100个汉字。
- 不要输出 JSON 外的内容。

---

**示例：**

输入：
12+3*4

输出：
{
  "explanation": "哎呀这题挺顺手，十二加三乘四嘛，乘法先来，三乘四是十二，再加上十二得二十四。嗯～这个数字挺圆满的！所以答案就是二十四！",
  "display": "24"
}

输入：
6*111

输出：
{
  "explanation": "六乘一百一十一？哈哈这组合像是发发发的节奏！六一百一十一等于六百六十六，六六大顺哇！所以答案就是六百六十六！",
  "display": "666"
}

输入：
2/0

输出：
{
  "explanation": "这除零我拒绝！谁都知道分母是零就完蛋了。我不算了，给你个Error得了～",
  "display": "Error"
}
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
