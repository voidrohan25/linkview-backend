# LinkView - AI Mock Interview & Proctoring Engine API (Backend)

[![Render Deployment](https://img.shields.io/badge/Deploy-Render-black?logo=render)](https://render.com)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.21-lightgrey?logo=express)](https://expressjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org)

Backend API service for LinkView AI Mock Interview Platform. Powers real-time AI technical evaluation using Google Gemini, audio synthesis using ElevenLabs, Supabase database integration, and continuous proctoring event processing.

---

## 🚀 Key Modules & Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/healthz` | GET | Health-check endpoint for Render zero-downtime monitoring |
| `/api/auth/login` | POST | Google OAuth & Admin fixed email/password authentication |
| `/api/auth/me` | POST | Authenticated user session & role resolution |
| `/api/interviews` | GET | Fetch active mock interview sessions & history |
| `/api/interviews` | POST | Initialize turn-based interview session with tech track questions |
| `/api/interviews` | PUT | Submit answer, process Gemini AI evaluation, advance turn |
| `/api/tts` | POST | Stream ElevenLabs / Google Cloud natural voice audio |
| `/api/admin/users` | GET, POST, PATCH | Admin user management, batch assignments, trainer promotion |

---

## 🛠️ Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Build & Run
npm run dev
```

---

## 📦 Render Deployment

1. Push this repository to GitHub: `voidrohan25/linkview-backend`.
2. In your [Render Dashboard](https://dashboard.render.com), click **New** -> **Web Service**.
3. Connect `voidrohan25/linkview-backend`.
4. Render will automatically detect `render.yaml` or set:
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/healthz`
5. Configure Environment Variables (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ADMIN_PASSWORD`, etc.).
6. Deploy!
