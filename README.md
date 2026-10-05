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
- 🔐 **Multi-Provider Authentication**: Support for Google OAuth, Apple Sign-In, and Email/Password with secure JWT tokens.
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

## 🎙️ Speech-to-Text Integration (Gnani Prisma v2.5)

Speak2Split uses **Gnani Prisma v2.5** (`https://api.vachana.ai/stt/v3`) as the Speech-to-Text (STT) provider for the voice expense flow.

### 1. How to Obtain a Gnani API Key
1. Register/Sign in at the official Gnani portal ([api.vachana.ai](https://api.vachana.ai)).
2. Generate an API key under your developer dashboard.
3. Use the key in your backend `.env` file (`GNANI_API_KEY`). The API key is kept strictly on the backend and is never exposed to the mobile client.

### 2. Required Backend Environment Variables
Add the following to your backend `.env`:
```env
STT_PROVIDER=gnani
GNANI_API_KEY=your_gnani_api_key_here
GNANI_LANGUAGE_CODE=en-IN
```
*Note*: Initially configured for `en-IN`, with architecture supporting Indian languages like `hi-IN` (Hindi), `gu-IN` (Gujarati), `kn-IN` (Kannada), etc.

### 3. How to Run the Backend
```bash
npm run dev:api
```

### 4. How to Test the Voice Expense Flow
1. **Automated Unit Tests**:
   ```bash
   npm --prefix apps/api test
   ```
   Runs mocked tests verifying Gnani STT service, `X-API-Key-ID` header passing, language parameters, rate limits, error handling, and key sanitization without consuming real API credits.
2. **Voice Expense Flow**:
   - User taps Voice / Speak in the app or sends a POST request with an audio recording to `/voice/transcribe`.
   - Backend sends audio to `https://api.vachana.ai/stt/v3` with `X-API-Key-ID`.
   - Gnani Prisma v2.5 transcribes audio and returns the text transcript.
   - The transcript is processed by the existing Speak2Split NLP expense parser (`/expenses/parse`).
   - The expense creation and split calculation pipeline executes as normal.


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
