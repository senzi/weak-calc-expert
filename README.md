# Weak Calc Expert - 弱计算器专家

"Weak Calc Expert" 是一个概念独特的计算器应用，它将简单的数学表达式交给一个“不那么靠谱”的 AI 专家来处理。这个专家不仅会给出计算结果，还会用语音解释它的计算过程——尽管这个过程可能出人意料，甚至完全错误。

该项目旨在探索一种有趣的人机交互形式，将传统工具与生成式 AI 相结合，创造出一种轻松、幽默的用户体验。

## 特性

- **AI 驱动的计算**：所有计算都通过一个大型语言模型（LLM）完成，结果充满了“惊喜”。
- **语音解释**：计算的“思路”会通过文本转语音（TTS）技术播放出来，让你一窥专家的“智慧”。
- **复古未来感设计**：界面设计灵感来源于经典的计算器，同时融入了现代 UI 元素。
- **趣味音效**：为按键和特殊事件（如专家计算失败）配备了有趣的音效。
- **完全前端实现**：借助 Cloudflare Workers，所有后端逻辑（LLM 和 TTS）都通过 serverless functions 实现，无需独立的后端服务器。

## 技术栈

- **前端**: [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/)
- **后端 (Serverless)**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **AI**:
  - **LLM**: 通过 Cloudflare AI Gateway 调用
  - **TTS**: 通过 Cloudflare AI Gateway 调用
- **部署**: [Cloudflare Pages](https://pages.cloudflare.com/)

## 如何运行

1. **克隆仓库**:
   ```bash
   git clone https://github.com/senzi/weak-calc-expert.git
   cd weak-calc-expert
   ```

2. **安装依赖**:
   ```bash
   npm install
   ```

3. **本地开发**:
   ```bash
   npm run dev
   ```
   这将在本地启动一个开发服务器。

4. **部署**:
   该项目已配置为通过 Cloudflare Pages 进行一键部署。

## 许可

本项目基于 [MIT License](LICENSE) 授权。
