<script setup>
import { ref, computed } from 'vue';

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
const canInput = computed(() => status.value !== STATUS.LOADING);

// --- Audio Handling ---
const playSound = (soundPath, force = false) => {
  const now = Date.now();
  if (!force && now - lastSoundPlayTime.value < 60) {
    return; // Debounce key sounds
  }
  lastSoundPlayTime.value = now;

  const audio = new Audio(soundPath);
  audio.onerror = () => {
    // If specific sound fails, play the generic fallback sound.
    if (soundPath !== '/sfx/keys/key_press.mp3') {
      console.warn(`Sound file not found: ${soundPath}. Using fallback.`);
      const fallbackAudio = new Audio('/sfx/keys/key_press.mp3');
      fallbackAudio.play().catch(err => console.error('Fallback sound failed to play.', err));
    } else {
      console.error('Fallback sound file /sfx/keys/key_press.mp3 is missing.');
    }
  };
  audio.play().catch(err => {
    // This catch is for play() rejections (e.g., user interaction needed),
    // while onerror handles loading failures.
    console.error(`Failed to play sound: ${soundPath}`, err);
  });
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
  if (expression.value.length === 0) return;

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
  if (!canInput.value && btn.key !== 'clear') {
    return;
  }
  playSound(btn.sound || '/sfx/keys/key_press.mp3');
  btn.action();
};

</script>

<template>
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
        :class="['btn', btn.class]"
        :style="{ gridArea: btn.key }"
        @click="handleButtonClick(btn)"
        :disabled="!canInput && btn.key !== 'clear'"
      >
        {{ btn.label }}
      </button>
    </div>
  </div>
</template>
