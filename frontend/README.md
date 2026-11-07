# Quarry Dashboard — Premium AI Lead Generation Interface

Quarry Dashboard is a high-performance, SaaS-oriented frontend designed for precision lead generation management. Built with React 18 and Tailwind CSS, it offers a data-rich, low-latency workspace for configuring, monitoring, and analyzing AI-driven outreach campaigns.

---

## 💎 User Experience & Design Philosophy

The dashboard is engineered for clarity and professional efficiency, featuring a high-contrast design system optimized for deep analytical work.

### 🌓 Synchronized Theme System
- **Unified Transitions**: A global transition engine ensures that all UI elements—including cards, sidebars, and data tables—toggle between light and dark modes in perfect synchronization.
- **Dark Mode Optimization**: Specifically tuned for reduced eye strain during long research sessions, utilizing a deep slate and indigo color palette.

### 📊 Multi-Dimensional Data Visualization
- **Lead Intelligence Views**: Users can toggle between a **High-Density Table View** for rapid scanning and a **Rich Intelligence Card View** for deep-diving into individual prospect firmographics.
- **Growth Signals & Match Scoring**: Visual indicators highlight the most promising leads based on AI-calculated relevance and real-time business signals (funding, leadership shifts).

### ⚡ Real-Time Pipeline Monitoring
- **Live Generation Feedback**: Integrated progress tracking provides instant visibility into the AI's search discovery, site classification, and extraction stages.
- **Dynamic Status Polling**: Automatic UI updates reflect pipeline completions and data enrichment without requiring manual page refreshes.

---

## ✨ Features & Capabilities

- **Universal Social Discovery**: One-click access to verified LinkedIn, X (Twitter), and Crunchbase profiles embedded directly into lead records.
- **Contextual Transparency**: View the exact AI-generated search prompts and the original Search Parameters used for every campaign.
- **High-Performance Grid**: Responsive 12-column workspace that adapts perfectly from ultra-wide monitors to standard laptops.
- **Glassmorphic Aesthetics**: Modern UI components utilizing backdrop-blurs, subtle gradients, and premium shadow systems.

---

## 🛠️ Tech Stack

- **Framework**: React 18 (Vite-powered for instant HMR)
- **Styling**: Tailwind CSS (JIT Engine)
- **Iconography**: Lucide React
- **Navigation**: React Router Dom v6
- **State Engine**: React Context API with custom hooks for Auth and Lead Management
- **Performance**: Optimized bundle sizes and lazy-loading for heavy assets

---

## 📦 Getting Started

### 1. Requirements
- Node.js 18+
- Active Quarry Backend Instance

### 2. Installation
```bash
cd frontend
npm install
```

### 3. Environment Config
Create a `.env` file in the root:
```env
VITE_API_URL=http://localhost:8000
```

### 4. Development Run
```bash
npm run dev
```
Access the dashboard at `http://localhost:5173`

---

## 📁 Workspace Architecture

```text
frontend/
├── src/
│   ├── components/     # High-level layout and global UI primitives
│   ├── context/        # Business logic providers (Auth, Leads, Theme)
│   ├── pages/          # Full-screen application views
│   │   ├── Dashboard.jsx        # Pipeline hub & stats
│   │   ├── CampaignDetails.jsx  # Intelligence analytical view
│   │   ├── History.jsx          # Generated Leads management
│   │   └── NewRequest.jsx       # AI parameter configuration
│   ├── index.css       # Core design system and Tailwind layers
│   └── App.jsx         # Component orchestration and routing
└── tailwind.config.js  # Brand identity and theme configuration
```
