# 🎙️ Speak2Split

<div align="center">

![Speak2Split Banner](https://img.shields.io/badge/Speak2Split-Expense%20Management-2563EB?style=for-the-badge&logo=expocounter&logoColor=white)

**"Say it. Split it. Settle it."**

*A context-aware, AI-powered shared expense management platform built for flatmates, trips, families, and groups with real-time sync, voice input, receipt OCR, and debt minimization.*

[![React Native](https://img.shields.io/badge/React_Native-0.74-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-v51-000000?style=flat-square&logo=expo&logoColor=white)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

## 🌟 Overview

**Speak2Split** goes beyond basic bill-splitting calculators. It provides a complete shared financial management workspace featuring an intelligent natural-language processing (NLP) engine, automatic contact identity resolution, voice & receipt entry, real-time WebSocket state synchronization, and automated debt minimization.

Whether managing flatmate utility bills, splitting group trip expenses, or keeping track of recurring household costs, Speak2Split handles the math, notifications, settlement reports, and real-time member updates instantly.

---

## ✨ Key Features

- 🗣️ **Voice & Natural Language Expense Input**: Speak or type natural sentences (e.g. *"I paid ₹2,400 for electricity split between me, Vanshika, and Ishika"*). The AI NLP engine parses amounts, titles, categories, and resolves user mentions automatically.
- 🔍 **Ambiguity-Free Name & Contact Matching**: Intelligent entity resolution system prevents duplicate users or silent misattributions when two contacts share the same name.
- 📸 **Receipt OCR Scanning**: Upload photo receipts to extract merchant names, total amounts, itemized lists, and categories automatically.
- ⚡ **Real-Time Group Synchronization**: Powered by Socket.IO for instant live balance and expense updates across all group members' devices.
- 🎨 **Premium Modern UI/UX**: Designed with a sleek aesthetic, Plus Jakarta Sans geometric typography, category emoji badges, soft pill buttons, and color-coded balances (Green for positive, Coral Red for owed).
- 🔐 **Multi-Provider Authentication**: Support for Google OAuth (fully configured for Android intents and Web), Apple Sign-In, and Email/Password with secure JWT tokens.
- 📊 **Smart Debt Minimization**: Built-in settlement algorithm calculates the optimal minimum number of peer-to-peer payments needed to settle group debts completely.
- 📄 **PDF Financial Reports**: Instant PDF export with branded headers, member summary tables, itemized expense histories, and settlement instructions.
- 🔔 **Multi-Channel Notifications**: Real-time in-app alerts, Expo Push Notifications, Email (Resend), and WhatsApp message integration.
- 🛍️ **Shared Group Utilities**: Group Shopping Lists, Shared Expense Templates, and Document Storage.

---

## 🏗️ Tech Stack & Architecture

### **Mobile Client (`apps/mobile`)**
- **Framework**: Expo (React Native v0.74, Expo Router v3)
- **State & Data Fetching**: TanStack Query (React Query v5), Zustand, Expo SecureStore
- **Styling & Icons**: Custom Design Token System, Lucide React Native Icons, Plus Jakarta Sans typography
- **Audio & Media**: Expo AV, Expo ImagePicker, Expo FileSystem, Expo Sharing

### **Backend API (`apps/api`)**
- **Runtime**: Node.js v20+, Express.js, TypeScript
- **Database**: MongoDB with Mongoose ODM (MongoDB Atlas in Production)
- **Real-Time**: Socket.IO WebSockets
- **Services & Tools**: PDFKit, node-cron scheduler, Expo Push Server API

### **Shared Engine (`packages/shared`)**
- **Zero-Dependency Core**: Pure TypeScript engine shared between mobile and API.
- Contains the split calculation engine, balance algorithm, greedy debt minimizer, receipt parser, NLP parser, and contact deduplication logic (46+ unit tests passing).

---

## 📁 Repository Structure

```
speak2split/
├── apps/
│   ├── api/                   # Express.js REST & WebSocket API backend
│   │   ├── src/
│   │   │   ├── auth/          # Google, Apple, and JWT Auth routers
│   │   │   ├── db/            # Mongoose models & database connection
│   │   │   ├── expenses/      # Expense management & NLP parsing API
│   │   │   ├── groups/        # Group & member management API
│   │   │   ├── receipts/      # OCR scanning service & router
│   │   │   ├── realtime/      # Socket.IO WebSocket handler
│   │   │   ├── settlements/   # Settlement and balance calculation API
│   │   │   └── exports/       # PDF report generator service
│   │   └── package.json
│   └── mobile/                # Expo Router mobile app
│       ├── app/               # Expo file-based routing screens
│       │   ├── (auth)/        # Login & Registration flows
│       │   └── (tabs)/        # Dashboard, Groups, Add Expense, Notifications, Search, Profile
│       ├── lib/               # API client, Theme tokens, Realtime hooks, OAuth helpers
│       ├── store/             # Zustand persistent Auth store
│       └── package.json
├── packages/
│   └── shared/                # Core split math, NLP resolver, and balance engine
│       ├── src/               # Pure business logic & algorithms
│       └── test/              # 46 Jest unit tests
├── .env.example               # Complete environment variable blueprint
├── API.md                     # Full API route documentation
├── ARCHITECTURE.md            # In-depth architectural design decisions
├── DEPLOYMENT.md              # Deployment guide (Render, Atlas, EAS)
├── SECURITY.md                # Security specifications & credential auditing
└── package.json               # Root monorepo configuration & workspaces
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `>= 20.0.0`
- **npm**: `>= 10.0.0`
- **MongoDB**: Local MongoDB instance or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster.

### 2. Environment Configuration
Clone the repository and set up environment files:

```bash
git clone https://github.com/thakkerstuti/Speak2Split.git
cd Speak2Split
cp .env.example .env
```

Ensure your `.env` contains your `MONGODB_URI` and `JWT_SECRET`:
```env
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/speak2split?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-jwt-key
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
```

### 3. Installation & Verification
Install dependencies across all workspace packages:

```bash
npm install
```

Run test suites to verify business logic and shared engine:
```bash
# Run 46/46 unit tests in shared package
npm test --workspace=@speak2split/shared

# Type-check mobile and API projects
npm run typecheck --workspace=@speak2split/mobile
npm run build
```

### 4. Running Locally

**Start Backend API:**
```bash
npm run dev:api
```
*(Server listens on `http://localhost:3000` with WebSockets enabled)*

**Start Mobile Application:**
```bash
npm run dev:mobile
```
*(Scan the QR code with Expo Go on Android/iOS or press `a` for Android Emulator)*

---

## 🎙️ Speech-to-Text Integration (AssemblyAI → Groq → Gemini)

The voice expense flow transcribes audio on the backend (`POST /voice/transcribe`) with this provider order:

| Order | Provider | Model | Env var |
|---|---|---|---|
| 1 (primary) | **AssemblyAI** pre-recorded API | Universal-2 (`speech_models: ["universal-2"]`, automatic language detection, 99 languages) | `ASSEMBLYAI_API_KEY` |
| 2 | **Groq** | Whisper `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| 3 | **Gemini** | `gemini-2.5-flash` (override with `GEMINI_STT_MODEL`) | `GEMINI_API_KEY` |

Providers without a key are skipped. If a provider fails (network error, timeout, HTTP error, empty transcript), the next one is tried. OpenAI Whisper and Google Speech-to-Text are still implemented but are **never** used by the default cascade (they have no free tier); they run only if explicitly pinned with `STT_PROVIDER=whisper|google`.

### 💸 Free tier only — no paid usage

This project is configured to run on free allowances only. The code contains no billing or payment logic and never upgrades an account.

**AssemblyAI**
- New accounts get **$50 of free credits** (no expiry), usable for pre-recorded and streaming transcription. AssemblyAI advertises this as roughly 185 hours pre-recorded / 333 hours streaming; the exact hours depend on the model's current per-hour price (see [assemblyai.com/pricing](https://www.assemblyai.com/pricing)). Only **pre-recorded** transcription is used here. The allowance is finite — it is not unlimited.
- **Do not add a credit card and do not enable auto-pay.** Without a card, AssemblyAI pauses API access when the balance reaches $0; it does not bill you.
- When AssemblyAI reports an exhausted balance (HTTP 400 *"Your current account balance is negative…"*, or HTTP 402) or rejects the key (HTTP 401), the backend **switches AssemblyAI off for the rest of the server process** and goes straight to Groq/Gemini — it does not keep retrying. The log shows `[STT] Disabling AssemblyAI until server restart: …`. After a restart it is tried once more and switched off again if still exhausted.
- A transcript job is submitted **at most once** per recording (submission is never retried), so a recording cannot be billed twice. AssemblyAI does not charge for failed transcripts.
- Emergency switch: set `ASSEMBLYAI_ENABLED=false` to stop all AssemblyAI calls without removing the key.

**Monitor AssemblyAI usage** in the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard):
- *Workspace → Settings → Billing*: remaining credit balance.
- *Workspace → Manage → Cost and Usage*: hours transcribed and spend.
- *Workspace → Settings → Alerts*: set a low-balance alert email.

**Groq**: use the free plan (rate-limited, no card) and do not upgrade to a paid tier. When the free rate limit is hit, Groq returns HTTP 429 and the request falls through to Gemini.

**Gemini**: create the key in [Google AI Studio](https://aistudio.google.com/apikey) on a Google Cloud project **without billing enabled**, which keeps it on the rate-limited free tier. If billing is enabled on that project, usage becomes paid.

### Backend environment variables
```env
STT_PROVIDER=                 # empty = AssemblyAI -> Groq -> Gemini cascade
ASSEMBLYAI_API_KEY=your_assemblyai_key
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
# Optional
ASSEMBLYAI_ENABLED=           # "false" disables AssemblyAI
ASSEMBLYAI_MAX_WAIT_MS=45000  # max wait for an AssemblyAI transcript before falling back
GEMINI_STT_MODEL=gemini-2.5-flash
```
All keys stay on the backend and are never sent to the mobile app.

### How it works
1. The user taps the center **Speak** button (no group selection needed) and talks; recording stops automatically when they finish, and the app uploads the audio (m4a / mp4 / wav) to `/voice/transcribe`.
2. AssemblyAI: the audio is uploaded (`POST /v2/upload`), a Universal-2 job is submitted (`POST /v2/transcript`), and the job is polled (`queued → processing → completed | error`) for up to `ASSEMBLYAI_MAX_WAIT_MS`. Transient poll errors are retried at most 3 times.
3. On any AssemblyAI failure the backend tries Groq, then Gemini.
4. The response is always `{ transcript, languageDetected? }`. The app sends the transcript to `/expenses/parse` without a group; the server infers the group (spoken group name, then the people mentioned, then recency). The user reviews one card (group, amount, title, category, payer, per-person split), resolves any ambiguous names, and saves.

### Testing
```bash
npm --prefix apps/api test
```
These are **mocked** tests (no real API calls, no credits used). They cover AssemblyAI success, missing key, upload failure, transcription failure, quota exhaustion, poll retries and timeouts, fallback to Groq and Gemini, all providers failing, and key redaction.


---

## 🌐 Production Deployment

- **Backend Service**: Deployed on [Render](https://render.com) (`https://speak2split.onrender.com`)
- **Database**: Hosted on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- **Mobile Client**: Built with [Expo Application Services (EAS)](https://expo.dev/eas)

For detailed deployment instructions, refer to [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 🧪 Testing & Validation

```bash
# Run unit test suite
npm run test

# Run TypeScript compilation check
npx tsc --noEmit --workspace=@speak2split/mobile
```

All 46 core logic unit tests pass, covering:
- ✅ Equal, Exact, Percentage, and Shares split math.
- ✅ Debt minimization matrix solver.
- ✅ NLP mention extraction & ambiguous contact resolution.
- ✅ Duplicate phone/email contact deduplication guards.

---

## 📚 Documentation Links

- 📖 [API Documentation](./API.md) — Comprehensive API endpoint reference
- 🏗️ [Architecture Deep-Dive](./ARCHITECTURE.md) — System design & database schemas
- 🚀 [Deployment Guide](./DEPLOYMENT.md) — Production setup on Render & EAS
- 🔒 [Security Policy](./SECURITY.md) — Security specs & authentication guidelines
- 📝 [Changelog](./CHANGELOG.md) — Development history & release notes

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">

Made with ❤️ by the Speak2Split Team

</div>
