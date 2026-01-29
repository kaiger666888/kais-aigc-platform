<p align="center">
  <strong>中文</strong> | 
  <a href="./docs/README.en.md">English</a>
</p>

<div align="center">

<img src="./docs/logo.png" alt="Toonflow Logo" height="120"/>

# Toonflow

  <p align="center">
    <b>
      AI短剧工厂
      <br />
      动动手指，小说秒变剧集！
      <br />
      AI剧本 × AI影像 × 极速生成 🔥
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
  
  > 🚀 **一站式短剧工程**：从文本到角色，从分镜到视频，0门槛全流程AI化，创作效率提升10倍+！
</div>

---

# 🌟 主要功能

Toonflow 是一款 AI 工具，能够利用 AI 技术将小说自动转化为剧本，并结合 AI 生成的图片和视频，实现高效的短剧创作。借助 Toonflow，可以轻松完成从文字到影像的全流程，让短剧制作变得更加智能与便捷。

- ✅ **角色生成**  
   自动分析原始小说文本，智能识别并生成角色设定，包括外貌、性格、身份等详细信息，为后续剧本与画面创作提供可靠基础。
- ✅ **剧本生成**  
   基于选定事件和章节，系统自动生成结构化剧本，涵盖对白、场景描述、剧情走向，实现从文学文本到影视剧本的高效转换。
- ✅ **分镜制作**  
   根据剧本内容，智能生成分镜提示词与画面设计，细化前中后景、角色动态、道具设定和场景布局，自动根据剧本生成分镜，为视频制作提供完整路线蓝图。
- ✅ **视频合成**  
   集成 AI 图像与视频技术，可使用 AI 生成视频片段。整合在线编辑，支持个性化调整输出，让影视创作高效协同、快捷落地。

---

# 📦 应用场景

- 短视频内容创作
- 小说影视化实验
- AI 文学 Adaptation 工具（改编工具）
- 剧本开发与快速原型
- 视频素材生成

---

# 🚀 安装与使用指南

## 前置条件

在安装和使用本软件之前，请准备以下内容：

- ✅ 大语言模型 AI 服务接口地址。
- ✅ Sora 或豆包视频服务接口地址
- ✅ Nano Banana Pro 图片生成模型服务接口

## 本机安装

### 1. 下载与安装

| 操作系统 | 下载链接                                                 | 说明                     |
| :------: | :------------------------------------------------------- | :----------------------- |
| Windows  | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases) | 官方发布安装包，点击下载 |
|  Linux   | ⚙️ 敬请期待                                              | 即将发布，请持续关注     |
|  macOS   | ⚙️ 敬请期待                                              | 即将发布，请持续关注     |

> 注意：目前仅支持 Windows 版本，其他系统将陆续开放。

### 2. 启动服务

安装完成后，启动程序即可开始使用本服务。

## 云端部署

云端安装及部署教程正在整理中，敬请期待。

---

# 🔧 开发流程指南

## 开发环境准备

- **Node.js**：版本要求 23.11.1 及以上
- **Yarn**：推荐作为项目包管理器

## 快速启动项目

1. **安装依赖**

   请先在项目根目录下执行以下命令以安装依赖项：

   ```bash
   yarn install
   ```

2. **启动开发环境**

   - 使用 Node.js 运行开发服务：

     ```bash
     yarn dev #端口60000
     ```

   - 使用 Bun 快速运行开发服务：

     ```bash
     yarn bun:dev #端口60000
     ```

3. **项目打包**

   - 编译并生成 TypeScript 文件：

     ```bash
     yarn build
     ```

   - 打包为 Windows 平台可执行程序：

     ```bash
     yarn dist:win
     ```

4. **代码质量检查**

   - 进行全局语法和规范检查：

     ```bash
     yarn lint
     ```

## 项目结构

```
📂 docs/                    # 文档资源
📂 scripts/                 # 构建脚本与静态资源
📂 src/
├─ 📂 agents/              # AI Agent 模块
├─ 📂 lib/                 # 公共库（数据库初始化、响应格式）
├─ 📂 middleware/          # 中间件
├─ 📂 routes/              # 路由模块
│  ├─ 📂 assets/           # 素材管理
│  ├─ 📂 index/            # 首页
│  ├─ 📂 novel/            # 小说管理
│  ├─ 📂 other/            # 其他功能
│  ├─ 📂 outline/          # 大纲管理
│  ├─ 📂 project/          # 项目管理
│  ├─ 📂 prompt/           # 提示词管理
│  ├─ 📂 script/           # 剧本生成
│  ├─ 📂 setting/          # 系统设置
│  ├─ 📂 storyboard/       # 分镜管理
│  ├─ 📂 task/             # 任务管理
│  ├─ 📂 user/             # 用户管理
│  └─ 📂 video/            # 视频生成
├─ 📂 types/               # TypeScript 类型声明
├─ 📂 utils/               # 工具函数
├─ 📄 app.ts               # 应用入口
├─ 📄 core.ts              # 路由核心
├─ 📄 env.ts               # 环境变量处理
├─ 📄 err.ts               # 错误处理
├─ 📄 router.ts            # 路由注册
└─ 📄 utils.ts             # 通用工具
📂 uploads/                 # 上传文件目录
📄 LICENSE                  # 许可证
📄 NOTICES.txt              # 第三方依赖声明
📄 package.json             # 项目配置
📄 README.md                # 项目说明
📄 tsconfig.json            # TypeScript 配置
```

---

# 📝 开发计划

我们正持续优化产品，以下为近期开发重点：

1. 核心功能升级

- `🧩 提示词润色生成 Agent` 基于 AI 智能润色视频提示词，自动拆解生成分镜脚本，支持多镜头智能融合与平滑过渡
- `📄 多格式文本支持` 扩展小说以外的剧本、漫画脚本、游戏对话文本等多种格式的智能解析

2. 生产流程优化

- `👗 角色服化道管理` 强化长篇内容中角色的服装、化妆、道具一致性，支持多剧集关联记忆和着装自动生成
- `📦 批量处理/任务队列` 支持多章节同时处理，后台任务管理，进度实时监控和中断恢复

3. 视觉生成增强

- `🎭 多风格模板库` 内置多种视觉风格包，支持一键风格转换和用户自定义风格保存
- `⏱️ 智能节奏分析/优化` 分析剧情情绪曲线，自动建议高潮点和节奏变化，优化分镜安排生产流程优化

---

# 📜 许可证

Toonflow 基于 AGPL-3.0 协议开源发布，许可证详情：https://www.gnu.org/licenses/agpl-3.0.html

您可以在遵循 AGPL-3.0 相关条款与条件的情况下，将 Toonflow 用于包括商业目的在内的各类用途。

如需获得免于 AGPL-3.0 限制的专有商业许可，请通过邮箱与我们联系。

---

# 💌 联系我们

📧 邮箱：[ltlctools@outlook.com](mailto:ltlctools@outlook.com?subject=Toonflow咨询)

---

# ⭐️ 星标历史

[![Star History Chart](https://api.star-history.com/svg?repos=HBAI-Ltd/Toonflow-app&type=Date)](https://star-history.com/#HBAI-Ltd/Toonflow-app&Date)

# 第三方依赖清单

请查阅`NOTICES.txt`
