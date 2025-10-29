<script setup>
import { ref, computed, onMounted } from 'vue';
import { rateLimitConfig } from './rateLimitConfig';

// --- Token Bucket State ---
const tokens = ref(rateLimitConfig.initialTokens);
const isRateLimited = ref(false);

// --- Enums for State Management ---
const STATUS = {
  IDLE: 'idle', // 空白待输入
  EDITING: 'editing', // 编辑中
  LOADING: 'loading', // 专家派单中
  RESULT: 'result', // 结果可播放
  FAILED: 'failed', // 专家失败
};

// --- Reactive State ---
const expression = ref('');
const resultText = ref('');
const audioUrl = ref('');
const status = ref(STATUS.IDLE);
const lastSoundPlayTime = ref(0);
const audioCache = ref({});

// --- UI Text & Messages ---
const uiText = {
  loading: '正在转给专家计算...',
  failed: '实在抱歉专家算了半天没算出来',
};

// --- Computed Properties ---
const displayExpression = computed(() => {
  if (status.value === STATUS.IDLE) return '0';
  return expression.value || '0';
});

const displayResult = computed(() => {
  if (isRateLimited.value) {
    return rateLimitConfig.busyText;
  }
  switch (status.value) {
    case STATUS.LOADING:
      return uiText.loading;
    case STATUS.FAILED:
      return uiText.failed;
    case STATUS.RESULT:
      return resultText.value;
    default:
      return '';
  }
});

const isLoading = computed(() => status.value === STATUS.LOADING);
const isEqualsDisabled = computed(() => status.value === STATUS.LOADING || isRateLimited.value);
const canInput = computed(() => status.value !== STATUS.LOADING);

// --- Audio Preloading Helper ---
const preloadAudio = (url) => {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.addEventListener('canplaythrough', () => resolve(audio), { once: true });
    audio.addEventListener('error', () => reject(new Error(`Failed to load audio: ${url}`)), { once: true });
    // A timeout in case 'canplaythrough' never fires
    setTimeout(() => reject(new Error(`Timeout loading audio: ${url}`)), 5000);
    audio.load();
  });
};

// --- Token Bucket Logic & Sound Preloading ---
onMounted(async () => {
  // Refill tokens periodically
  const refillInterval = 60000 / rateLimitConfig.refillRate;
  setInterval(() => {
    if (tokens.value < rateLimitConfig.maxTokens) {
      tokens.value = Math.min(tokens.value + 1, rateLimitConfig.maxTokens);
    }
  }, refillInterval);

  // Preload all sounds for instant feedback
  console.log('Starting audio preload...');
  const soundPaths = [
    ...new Set(buttons.map(btn => btn.sound).filter(Boolean)),
    rateLimitConfig.busySound,
    '/sfx/expert_failed.mp3',
    '/sfx/keys/key_press.mp3' // Generic fallback
  ];

  const preloadPromises = soundPaths.map(path => {
    if (!path) return Promise.resolve();
    return preloadAudio(path)
      .then(audio => {
        audioCache.value[path] = audio;
      })
      .catch(error => {
        console.warn(error.message); // Use warn to avoid console errors for non-critical failures
      });
  });

  await Promise.all(preloadPromises);
  console.log('Audio preload finished.');
});

// --- Audio Handling ---
const playSound = (soundPath, force = false) => {
  const now = Date.now();
  if (!force && now - lastSoundPlayTime.value < 60) {
    return; // Debounce key sounds
  }
  lastSoundPlayTime.value = now;

  const audio = audioCache.value[soundPath];
  if (audio) {
    audio.currentTime = 0; // Rewind to start for re-play
    audio.play().catch(err => console.error(`Failed to play sound from cache: ${soundPath}`, err));
  } else {
    // Fallback if a sound wasn't preloaded or is missing
    const fallbackAudio = audioCache.value['/sfx/keys/key_press.mp3'];
    if (fallbackAudio) {
      console.warn(`Sound not in cache: ${soundPath}. Using fallback.`);
      fallbackAudio.currentTime = 0;
      fallbackAudio.play().catch(err => console.error('Fallback sound failed to play.', err));
    } else {
      console.error('Critical: Fallback sound is not available in cache.');
    }
  }
};

// --- Input Handling ---
const handleInput = (key) => {
  if (status.value === STATUS.RESULT || status.value === STATUS.FAILED) {
    clear();
  }

  status.value = STATUS.EDITING;

  if (['+', '-', '*', '/'].includes(key)) {
    // Allow operator chaining
    expression.value += key;
  } else if (key === '.') {
    // Avoid multiple decimals in a row
    const segments = expression.value.split(/[\+\-\*\/]/);
    if (!segments[segments.length - 1].includes('.')) {
      expression.value += key;
    }
  } else {
    expression.value += key;
  }
};

const backspace = () => {
  if (expression.value.length > 0) {
    expression.value = expression.value.slice(0, -1);
  }
  if (expression.value.length === 0) {
    status.value = STATUS.IDLE;
  }
};

const clear = () => {
  expression.value = '';
  resultText.value = '';
  audioUrl.value = '';
  status.value = STATUS.IDLE;
};

// --- Calculation Logic ---
const handleEquals = async () => {
  if (expression.value.length === 0 || isEqualsDisabled.value) return;

  // 1. Check token bucket
  if (tokens.value < rateLimitConfig.consumePerCall) {
    isRateLimited.value = true;
    status.value = STATUS.EDITING; // Keep editing state
    resultText.value = rateLimitConfig.busyText; // Show busy text
    playSound(rateLimitConfig.busySound, true);

    setTimeout(() => {
      isRateLimited.value = false;
      if (status.value !== STATUS.RESULT && status.value !== STATUS.FAILED) {
         resultText.value = '';
      }
    }, rateLimitConfig.cooldownOnEmpty);
    return;
  }

  // 2. Consume token and proceed
  playSound('/sfx/keys/key_eq.mp3');
  tokens.value -= rateLimitConfig.consumePerCall;

  // --- Expert Calculation (Backend) ---
  // No more pre-calculation, send directly to LLM.
  status.value = STATUS.LOADING;
  const traceId = crypto.randomUUID();

  try {
    // 1. Call LLM API
    const llmResponse = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expr: expression.value, trace_id: traceId }),
    });

    if (!llmResponse.ok) throw new Error('LLM_API_FAILED');
    const llmData = await llmResponse.json();
    if (typeof llmData.display === 'undefined' || typeof llmData.explanation === 'undefined') {
      throw new Error('LLM_INVALID_RESPONSE');
    }

    resultText.value = llmData.display;

    // 2. Call TTS API
    const ttsResponse = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: llmData.explanation, trace_id: traceId }),
    });

    if (!ttsResponse.ok) throw new Error('TTS_API_FAILED');
    const ttsData = await ttsResponse.json();
    if (!ttsData.dataUrl) throw new Error('TTS_INVALID_RESPONSE');

    audioUrl.value = ttsData.dataUrl;
    status.value = STATUS.RESULT;

    // Auto-play the audio without showing a control
    const resultAudio = new Audio(ttsData.dataUrl);
    resultAudio.play();

  } catch (error) {
    console.error("Expert calculation failed:", error.message);
    status.value = STATUS.FAILED;
    playSound('/sfx/expert_failed.mp3', true);
  }
};

// --- Button Layout & Sound Mapping ---
const buttons = [
  { key: 'clear',    label: 'C',  action: clear,                   sound: '/sfx/keys/key_clear.mp3', class: 'special' },
  { key: 'backspace',label: '⌫',  action: backspace,               sound: '/sfx/keys/key_del.mp3',   class: 'special' },
  { key: 'divide',   label: '/',  action: () => handleInput('/'),  sound: '/sfx/keys/key_div.mp3',   class: 'operator' },
  { key: 'multiply', label: '*',  action: () => handleInput('*'),  sound: '/sfx/keys/key_mul.mp3',   class: 'operator' },
  { key: 'n7',       label: '7',  action: () => handleInput('7'),  sound: '/sfx/keys/key_7.mp3' },
  { key: 'n8',       label: '8',  action: () => handleInput('8'),  sound: '/sfx/keys/key_8.mp3' },
  { key: 'n9',       label: '9',  action: () => handleInput('9'),  sound: '/sfx/keys/key_9.mp3' },
  { key: 'subtract', label: '-',  action: () => handleInput('-'),  sound: '/sfx/keys/key_minus.mp3', class: 'operator' },
  { key: 'n4',       label: '4',  action: () => handleInput('4'),  sound: '/sfx/keys/key_4.mp3' },
  { key: 'n5',       label: '5',  action: () => handleInput('5'),  sound: '/sfx/keys/key_5.mp3' },
  { key: 'n6',       label: '6',  action: () => handleInput('6'),  sound: '/sfx/keys/key_6.mp3' },
  { key: 'add',      label: '+',  action: () => handleInput('+'),  sound: '/sfx/keys/key_plus.mp3',  class: 'operator' },
  { key: 'n1',       label: '1',  action: () => handleInput('1'),  sound: '/sfx/keys/key_1.mp3' },
  { key: 'n2',       label: '2',  action: () => handleInput('2'),  sound: '/sfx/keys/key_2.mp3' },
  { key: 'n3',       label: '3',  action: () => handleInput('3'),  sound: '/sfx/keys/key_3.mp3' },
  { key: 'equals',   label: '=',  action: handleEquals,            sound: '/sfx/keys/key_eq.mp3',    class: 'equals' },
  { key: 'n0',       label: '0',  action: () => handleInput('0'),  sound: '/sfx/keys/key_0.mp3' },
  { key: 'dot',      label: '.',  action: () => handleInput('.'),  sound: '/sfx/keys/key_dot.mp3' },
];

const handleButtonClick = (btn) => {
  if (btn.key === 'equals') {
    // Sound is handled within handleEquals to respect rate limiting
    btn.action();
    return;
  }

  if (!canInput.value && btn.key !== 'clear') {
    return;
  }
  playSound(btn.sound || '/sfx/keys/key_press.mp3');
  btn.action();
};

</script>

<template>
  <div class="app-wrapper">
    <main>
      <div class="calculator">
    <div class="display">
      <div class="expression">{{ displayExpression }}</div>
      <div class="result">
        <div v-if="isLoading" class="loader"></div>
        <span>{{ displayResult }}</span>
        <!-- Audio player is now removed, playback is handled programmatically -->
      </div>
    </div>
    <div class="buttons">
      <button
        v-for="btn in buttons"
        :key="btn.key"
        :class="['btn', btn.class, { 'is-loading': btn.key === 'equals' && isLoading }]"
        :style="{ gridArea: btn.key }"
        @click="handleButtonClick(btn)"
        :disabled="(btn.key === 'equals' ? isEqualsDisabled : !canInput) && btn.key !== 'clear'"
      >
        <div v-if="btn.key === 'equals' && isLoading" class="loader-small"></div>
        <span v-else>{{ btn.label }}</span>
      </button>
      </div>
    </div>
    <footer class="app-footer">
      <a href="https://calc.closeai.moe" target="_blank" rel="noopener noreferrer">calc.closeai.moe</a>
      <br>
      <a href="https://github.com/senzi/weak-calc-expert" target="_blank" rel="noopener noreferrer">Github</a> · MIT · vibe coding
    </footer>
    </main>
  </div>
</template>

<style>
.app-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

main {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.app-footer {
  text-align: center;
  margin-top: 1.5rem;
  font-size: 0.9rem;
  color: #888;
  line-height: 1.6;
}

.app-footer a {
  color: #888;
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .app-footer {
    font-size: 0.8rem;
    margin-top: 1.5rem;
    text-align: center; /* Ensure footer text stays centered */
    width: 100%; /* Ensure footer takes full width */
  }
  main {
    align-items: flex-start; /* Align calculator to top on mobile */
    padding-top: 2rem;
  }
}

.loader-small {
  width: 24px;
  height: 24px;
  border: 3px solid #fff;
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  box-sizing: border-box;
  animation: rotation 1s linear infinite;
}

@keyframes rotation {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
