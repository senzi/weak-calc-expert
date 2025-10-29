import type { PagesFunction } from '@cloudflare/workers-types';

// Environment variable typings
interface Env {
  TTS_API_KEY: string;
  TTS_GROUP_ID: string;
}

// Request body typings
interface RequestBody {
  text: string;
  trace_id?: string;
}

// MiniMax API response typings (partial)
interface MiniMaxResponse {
  data?: {
    audio: string;
  };
  extra_info?: {
    audio_length: number;
  };
  trace_id: string;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
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

/**
 * Converts a hexadecimal string to a Base64 string.
 * @param hex The hexadecimal string.
 * @returns The Base64 encoded string.
 */
function hexToBase64(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  // In a Worker environment, btoa is available globally.
  return btoa(str);
}

// The onRequestPost handler for the /api/tts endpoint.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  let body: RequestBody;

  try {
    body = await request.json();
  } catch (e) {
    return jsonError("INVALID_REQUEST_BODY", 400);
  }

  const { text, trace_id } = body;

  if (!text) {
    return jsonError("MISSING_TEXT", 400, trace_id);
  }

  const { TTS_API_KEY: apiKey, TTS_GROUP_ID: groupId } = env;

  if (!apiKey || !groupId) {
    console.error("TTS_API_KEY or TTS_GROUP_ID environment variables not set.");
    return jsonError("TTS_MISCONFIGURED", 500, trace_id);
  }

  const ttsApiUrl = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;

  const requestBody = {
    "model": "speech-2.5-hd-preview",
    "text": text,
    "timbre_weights": [{ "voice_id": "Chinese (Mandarin)_Laid_BackGirl", "weight": 1 }],
    "voice_setting": { "voice_id": "", "speed": 0.95, "pitch": 0, "vol": 1.5, "emotion": "neutral" },
    "audio_setting": { "sample_rate": 32000, "bitrate": 128000, "format": "mp3" },
    "language_boost": "Chinese"
  };

  try {
    const ttsResponse = await fetch(ttsApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!ttsResponse.ok) {
      console.error(`TTS API request failed with status: ${ttsResponse.status}`);
      return jsonError("TTS_FAILED", 502, trace_id);
    }

    const ttsResult = await ttsResponse.json() as MiniMaxResponse;

    if (ttsResult.base_resp?.status_code !== 0 || !ttsResult.data?.audio) {
      console.error("TTS API returned an error or no audio data:", ttsResult.base_resp?.status_msg);
      return jsonError("TTS_FAILED", 502, trace_id);
    }

    const audioBase64 = hexToBase64(ttsResult.data.audio);
    const dataUrl = `data:audio/mp3;base64,${audioBase64}`;

    const responsePayload = {
      dataUrl: dataUrl,
      length: ttsResult.extra_info?.audio_length || 0,
      trace_id: ttsResult.trace_id || trace_id,
      ver: "1",
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("TTS API call failed:", error);
    return jsonError("TTS_FAILED", 502, trace_id);
  }
};
