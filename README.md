<div align="center">

![Riffado](.github/assets/banner.png)

**Open-source AI transcription companion for voice recorders.**

*Bring your own AI provider, own your transcripts, self-host or hosted.*

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://riffado.com/discord)
[![Sponsor](https://img.shields.io/badge/sponsor-riffado-EA4AAA?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/riffado)

[中文介绍](#中文介绍) • [Quick start](#quick-start) • [Documentation](https://riffado.com/docs) • [Discord](https://riffado.com/discord) • [Sponsor](https://github.com/sponsors/riffado)

</div>

---

> **OpenPlaud is now Riffado.** Same project, same code, same team, same license &mdash; renamed in May 2026 so the project isn't tied to one device vendor in its name. [Read the rebrand note &rarr;](https://riffado.com/rebrand)

Riffado is an open-source companion app for AI voice recorders. It syncs your recordings from the manufacturer's cloud, transcribes them with any OpenAI-compatible API (or in the browser, for free), and stores everything on infrastructure you control. **Currently supports the Plaud Note family — Note, Note Pro, and NotePin. More device support on the way.** AGPL-3.0.

## 中文介绍

Riffado 是面向录音设备的开源 AI 转写应用，可同步设备厂商云端的录音，使用自己选择的 AI 服务或浏览器本地模型进行转写，并管理录音、转写文本与摘要。目前支持 Plaud Note、Note Pro 和 NotePin。

- **自主选择 AI**：支持 OpenAI、Groq、OpenRouter 等服务，也可连接 Ollama、LM Studio 等本地服务。
- **浏览器本地转写**：通过 Transformers.js 运行 Whisper，无需付费转写 API。
- **自主存储**：支持本地文件系统及 S3 兼容存储，可在自己的设备或服务器上部署。
- **录音管理**：提供自动同步、播放、转写、AI 摘要及通知功能。
- **导出与备份**：支持 JSON、TXT、SRT、VTT 导出及完整备份与恢复。

### 本仓库的简体中文界面

本仓库是 [riffado/riffado](https://github.com/riffado/riffado) 的汉化分支，界面默认英文。打开 **Settings → Display → Interface language**，选择 **简体中文**；中文界面下对应 **设置 → 显示 → 界面语言**。登录页面也提供语言选择入口。

语言偏好保存在当前浏览器中，不跨设备同步。切换界面语言不会翻译用户输入，也不会改变转写语言、AI 输出语言或原始提示词。汉化覆盖登录、工作台、录音管理、设置、引导及常见提示，官网营销、文档和管理后台等内容不在当前范围内。

汉化实现与维护说明见 [LOCALIZATION.md](LOCALIZATION.md)。本次汉化及语言切换实现由 **GPT-6 Astra** 完成。

下方快速安装命令和发行镜像来自原始仓库，**不会自动包含本分支的汉化改动**。使用本仓库的中文界面，需要部署包含本分支改动的版本；原项目部署说明见下方 [Quick start](#quick-start)。

## Features

- Self-hosted. Your recordings, your storage, your API keys.
- Works with any OpenAI-compatible provider — OpenAI, Groq, OpenRouter, Together, LM Studio, Ollama, Azure, anything with a `baseURL`.
- Free browser transcription via Transformers.js (Whisper in WebAssembly).
- Local filesystem or S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi).
- AES-256-GCM encryption at rest for tokens, API keys, transcripts, and summaries.
- Auto-sync on a schedule, with browser and email notifications.
- Full export and backup — JSON, TXT, SRT, VTT, plus one-archive backup/restore.
- Automation API with signed webhooks for integrations.
- Zero-config Docker Compose deploy.

## Quick start

You need Docker, a Plaud account at [plaud.ai](https://plaud.ai), and (optionally) an OpenAI-compatible API key.

**One-liner (Linux / macOS):**

```bash
curl -fsSL https://riffado.com/install.sh | sh
```

Prompts for an install directory and `APP_URL`, downloads `docker-compose.yml` and `.env`, generates secrets, starts the stack, and waits for `/api/health`. Source: [`scripts/install.sh`](scripts/install.sh).

**Manual install:**

```bash
mkdir riffado && cd riffado
curl -fLO https://github.com/riffado/riffado/releases/latest/download/docker-compose.yml
curl -fL  https://github.com/riffado/riffado/releases/latest/download/env.example -o .env

# Generate secrets, paste into .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"

docker compose up -d
```

Open <http://localhost:3000/register> and create your account. The onboarding wizard handles Plaud connection, AI providers, storage, and sync preferences.

**Upgrade:** `docker compose pull && docker compose up -d`. Migrations run on container start.

Full install guide, version pinning, image tags, and Windows/WSL notes: [riffado.com/docs/self-hosting/install](https://riffado.com/docs/self-hosting/install).

> `main` is a rolling integration branch. Deploy from tagged image releases, not by building `main`. See [BRANCHING.md](BRANCHING.md).

## Connecting Plaud

Riffado signs into Plaud using your email — the same OTP flow as the official app. The verification code is forwarded directly to Plaud and never stored. Your access token is encrypted with AES-256-GCM before hitting the database. Region (Global, EU, APAC) is auto-detected.

If you signed up to Plaud with **Continue with Google** or **Continue with Apple**, the email-code flow won't return any recordings — that's a different identity on Plaud's side. Use the [Riffado Connector browser extension](https://github.com/riffado/connector), or paste a token manually. Full instructions: [riffado.com/docs/guides/connect-plaud-account](https://riffado.com/docs/guides/connect-plaud-account).

> Every line that handles your credentials is open source — [send-code route](src/app/api/plaud/auth/send-code/route.ts) · [verify route](src/app/api/plaud/auth/verify/route.ts) · [encryption](src/lib/encryption.ts).

## Documentation

Everything lives at **[riffado.com/docs](https://riffado.com/docs)**. Direct links:

- [Install & first run](https://riffado.com/docs/self-hosting/install)
- [Environment variables](https://riffado.com/docs/self-hosting/environment-variables)
- [Upgrading](https://riffado.com/docs/self-hosting/upgrading)
- [S3-compatible storage](https://riffado.com/docs/self-hosting/storage-s3)
- [Email / SMTP](https://riffado.com/docs/self-hosting/email-smtp)
- [Connect your Plaud account](https://riffado.com/docs/guides/connect-plaud-account)
- [AI providers](https://riffado.com/docs/guides/ai-providers)
- [Backup & restore](https://riffado.com/docs/guides/backup-and-restore)
- [Notifications](https://riffado.com/docs/guides/notifications)
- [Automation & webhooks](https://riffado.com/docs/guides/automation-and-webhooks)
- [Public API reference](https://riffado.com/docs/reference/public-api)
- [Encryption at rest](https://riffado.com/docs/reference/encryption-at-rest)
- [Security model](https://riffado.com/docs/reference/security-model)
- [Architecture](https://riffado.com/docs/reference/architecture)

## Sponsors

Riffado is AGPL-3.0 and stays that way. Sponsorship is what pays for the parts
that aren't fun: chasing vendor API changes that break sync, buying recorders to
test new device support against, CI and registry costs, and the mobile app.

[**Sponsor Riffado on GitHub &rarr;**](https://github.com/sponsors/riffado)

If your team self-hosts Riffado at work, a company tier is the cheapest
maintenance contract you'll ever buy.

<!-- sponsors -->
<!-- /sponsors -->

## Contributing

Bug reports, feature requests, and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the PR workflow, [BRANCHING.md](BRANCHING.md) for the release model, and [CHANGELOG.md](CHANGELOG.md) for version history.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) for disclosure.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Free to use, modify, and self-host. If you run a modified version as a network service, you must publish your source.

## Disclaimer

- **Not affiliated.** Riffado is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Plaud Inc. or any of its subsidiaries. "Plaud" and related marks are the property of their respective owners and are used here only for descriptive interoperability purposes (nominative fair use).
- **Third-party devices and services.** Riffado is designed to interoperate with hardware and services from third parties that users choose to connect — including recording devices (such as Plaud) and storage and AI providers. Users are solely responsible for complying with the applicable terms of service, acceptable-use policies, and laws governing any third-party device or service they connect to this software.

## Acknowledgments

Originally created by **Perier**. Maintained by the Riffado community.
