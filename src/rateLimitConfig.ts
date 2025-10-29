export const rateLimitConfig = {
  initialTokens: 10,
  refillRate: 2, // 每分钟 +2
  maxTokens: 10,
  consumePerCall: 1,
  cooldownOnEmpty: 5000, // 毫秒
  busySound: '/sfx/expert_busy.mp3',
  busyText: '专家正忙，稍等片刻再算。'
};
