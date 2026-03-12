# HCode AI

Built-in AI coding assistant for [HCode](https://github.com/hnanoto/vscode) — the open-source IDE.

## Providers Supported

| Provider | Free? | Private? | Setup |
|---------|-------|----------|-------|
| 🦙 **Ollama** | ✅ Free | ✅ 100% Local | Install [Ollama](https://ollama.ai), pull a model |
| 🌊 **Google Gemini** | ✅ Free tier | ☁️ Cloud | API key from [aistudio.google.com](https://aistudio.google.com) |
| 🤖 **OpenAI / Codex** | 💳 Paid | ☁️ Cloud | API key from [platform.openai.com](https://platform.openai.com) |
| 🧠 **Anthropic Claude** | 💳 Paid | ☁️ Cloud | API key from [console.anthropic.com](https://console.anthropic.com) |

## Features

- **Chat** — Ask anything about your code directly in the chat panel
- **Inline edits** — Refactor, fix, and generate code inline
- **Agentic tools** — Read files, run terminal commands, search code, check git status and diagnostics
- **Workspace memory** — AI remembers your project architecture across sessions (`.hcode/ai-memory/`)
- **Commit messages** — Generate conventional commit messages from staged changes

## Getting Started

1. Open HCode
2. Run `HCode AI: Configure Provider` from the command palette
3. Choose your preferred provider and enter API key if needed
4. Open chat (`Ctrl+Shift+I`) and start coding with AI!

## Recommended Ollama Models

```bash
ollama pull qwen2.5-coder:7b      # Best balance (recommended)
ollama pull deepseek-coder:6.7b   # Great reasoning
ollama pull codellama:13b         # Meta's coding model
ollama pull phi4:14b              # Microsoft Phi-4
```
