export const rateLimitConfig = {
  initialTokens: 15,
  refillRate: 5, // 每分钟 +5
  maxTokens: 15,
  consumePerCall: 1,
  cooldownOnEmpty: 3000, // 毫秒
  busySound: '/sfx/expert_busy.mp3',
  busyText: '专家正忙，稍等片刻再算。'
};
