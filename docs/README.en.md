<p align="center">
  <a href="../README.md">中文</a> |
  <strong>English</strong>
</p>

<div align="center">

<img src="./logo.png" alt="Toonflow Logo" height="120"/>

# Toonflow

  <p align="center">
    <b>
      AI Short Drama Factory
      <br />
      Turn novels into episodes with just a tap!
      <br />
      AI Script × AI Visuals × Rapid Generation 🔥
    </b>
  </p>
  <p align="center">
    <a href="https://github.com/HBAI-Ltd/Toonflow-app/stargazers">
      <img src="https://img.shields.io/github/stars/HBAI-Ltd/Toonflow-app?style=for-the-badge&logo=github" alt="Stars Badge" />
    </a>
    <a href="https://www.gnu.org/licenses/agpl-3.0" target="_blank">
      <img src="https://img.shields.io/badge/License-AGPL-blue.svg?style=for-the-badge" alt="AGPL License Badge" />
    </a>
    <a href="https://github.com/HBAI-Ltd/Toonflow-app/releases">
      <img alt="release" src="https://img.shields.io/github/v/release/HBAI-Ltd/Toonflow-app?style=for-the-badge" />
    </a>
  </p>
  
  > 🚀 **One-stop Short Drama Production**: From text to characters, from storyboards to videos, zero-barrier full-process AI automation, boosting creative efficiency by 10x+!
</div>

---

# 🌟 Main Features

Toonflow is an AI tool that leverages AI technology to automatically convert novels into scripts, combined with AI-generated images and videos for efficient short drama creation. With Toonflow, you can easily complete the entire workflow from text to visuals, making short drama production smarter and more convenient.

- ✅ **Character Generation**  
   Automatically analyzes original novel text, intelligently identifies and generates character settings including appearance, personality, identity, and other detailed information, providing a reliable foundation for subsequent script and visual creation.
- ✅ **Script Generation**  
   Based on selected events and chapters, the system automatically generates structured scripts covering dialogue, scene descriptions, and plot progression, achieving efficient conversion from literary text to film scripts.
- ✅ **Storyboard Production**  
   Based on script content, intelligently generates storyboard prompts and visual designs, detailing foreground, midground, background, character dynamics, prop settings, and scene layouts. Automatically generates storyboards from scripts, providing a complete blueprint for video production.
- ✅ **Video Synthesis**  
   Integrates AI image and video technology, enabling AI-generated video clips. Incorporates online editing with support for personalized output adjustments, making film production efficient and streamlined.

---

# 📦 Application Scenarios

- Short video content creation
- Novel-to-film experimentation
- AI Literary Adaptation Tools
- Script development and rapid prototyping
- Video material generation

---

# 🚀 Installation and Usage Guide

## Prerequisites

Before installing and using this software, please prepare the following:

- ✅ Large Language Model AI service API endpoint.
- ✅ Sora or Doubao video service API endpoint
- ✅ Nano Banana Pro image generation model service API endpoint

## Local Installation

### 1. Download and Install

| Operating System | Download Link                                                 | Description                     |
| :--------------: | :------------------------------------------------------------ | :------------------------------ |
|     Windows      | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases)  | Official release package, click to download |
|      Linux       | ⚙️ Coming Soon                                                | Coming soon, stay tuned         |
|      macOS       | ⚙️ Coming Soon                                                | Coming soon, stay tuned         |

> Note: Currently only Windows version is supported, other systems will be available soon.

### 2. Start Service

After installation, launch the program to start using the service.

## Cloud Deployment

Cloud installation and deployment tutorials are being prepared, stay tuned.

---

# 🔧 Development Process Guide

## Development Environment Setup

- **Node.js**: Version 23.11.1 or above required
- **Yarn**: Recommended as the project package manager

## Quick Start

1. **Install Dependencies**

   Please first run the following command in the project root directory to install dependencies:

   ```bash
   yarn install
   ```

2. **Start Development Environment**

   - Run development service with Node.js:

     ```bash
     yarn dev #port 60000
     ```

   - Run development service quickly with Bun:

     ```bash
     yarn bun:dev #port 60000
     ```

3. **Project Build**

   - Compile and generate TypeScript files:

     ```bash
     yarn build
     ```

   - Package as Windows platform executable:

     ```bash
     yarn dist:win
     ```

4. **Code Quality Check**

   - Perform global syntax and standard checks:

     ```bash
     yarn lint
     ```

## Project Structure

```
📂 docs/                    # Documentation resources
📂 scripts/                 # Build scripts and static resources
📂 src/
├─ 📂 agents/              # AI Agent modules
├─ 📂 lib/                 # Common libraries (database initialization, response format)
├─ 📂 middleware/          # Middleware
├─ 📂 routes/              # Route modules
│  ├─ 📂 assets/           # Asset management
│  ├─ 📂 index/            # Homepage
│  ├─ 📂 novel/            # Novel management
│  ├─ 📂 other/            # Other features
│  ├─ 📂 outline/          # Outline management
│  ├─ 📂 project/          # Project management
│  ├─ 📂 prompt/           # Prompt management
│  ├─ 📂 script/           # Script generation
│  ├─ 📂 setting/          # System settings
│  ├─ 📂 storyboard/       # Storyboard management
│  ├─ 📂 task/             # Task management
│  ├─ 📂 user/             # User management
│  └─ 📂 video/            # Video generation
├─ 📂 types/               # TypeScript type declarations
├─ 📂 utils/               # Utility functions
├─ 📄 app.ts               # Application entry
├─ 📄 core.ts              # Route core
├─ 📄 env.ts               # Environment variable handling
├─ 📄 err.ts               # Error handling
├─ 📄 router.ts            # Route registration
└─ 📄 utils.ts             # General utilities
📂 uploads/                 # Upload file directory
📄 LICENSE                  # License
📄 NOTICES.txt              # Third-party dependency declarations
📄 package.json             # Project configuration
📄 README.md                # Project description
📄 tsconfig.json            # TypeScript configuration
```

---

# 📝 Development Roadmap

We are continuously optimizing the product. Here are the recent development priorities:

1. Core Feature Upgrades

- `🧩 Prompt Enhancement Generation Agent` AI-powered intelligent video prompt enhancement, automatic storyboard script decomposition, supporting multi-shot intelligent fusion and smooth transitions
- `📄 Multi-format Text Support` Extending intelligent parsing beyond novels to scripts, comic scripts, game dialogue texts, and other formats

2. Production Workflow Optimization

- `👗 Character Costume and Props Management` Strengthen costume, makeup, and prop consistency for long-form content, supporting multi-episode associated memory and automatic outfit generation
- `📦 Batch Processing/Task Queue` Support multi-chapter simultaneous processing, background task management, real-time progress monitoring, and interruption recovery

3. Visual Generation Enhancement

- `🎭 Multi-style Template Library` Built-in multiple visual style packages, supporting one-click style conversion and user-defined style saving
- `⏱️ Intelligent Rhythm Analysis/Optimization` Analyze plot emotion curves, automatically suggest climax points and rhythm changes, optimize storyboard arrangement and production workflow

---

# 📜 License

Toonflow is open-sourced under the AGPL-3.0 license. License details: https://www.gnu.org/licenses/agpl-3.0.html

You may use Toonflow for various purposes including commercial use, in compliance with the terms and conditions of AGPL-3.0.

For proprietary commercial licenses exempt from AGPL-3.0 restrictions, please contact us via email.

---

# 💌 Contact Us

📧 Email: [ltlctools@outlook.com](mailto:ltlctools@outlook.com?subject=Toonflow Inquiry)

---

# ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=HBAI-Ltd/Toonflow-app&type=Date)](https://star-history.com/#HBAI-Ltd/Toonflow-app&Date)

# Third-party Dependency List

Please refer to `NOTICES.txt`