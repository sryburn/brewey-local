# Brewey

Brewey is a local brewing recipe manager operated primarily through its AI agent, with brewing calculations, ingredient and style catalogues, and notes. The web app brings together chat, your recipe library and settings. Your library lives on your computer; connect your own ChatGPT account to create and edit recipes through the built-in agent.

## Install

Install from a [published release](https://github.com/sryburn/brewey-local/releases).

Give your local AI agent this prompt:

> Install Brewey from https://github.com/sryburn/brewey-local, following https://github.com/sryburn/brewey-local/blob/main/docs/deployment.md. Obtain the installation files from a published release at https://github.com/sryburn/brewey-local/releases and use its exact Docker image reference under ghcr.io/sryburn/brewey-local. If no release is available, stop and tell me. Check and help me install the prerequisites for my computer. Keep my data persistent and access limited to this computer. Start the app, verify that it works, and open it in my browser. If practical, create a desktop or application shortcut that opens Brewey and starts it when needed. Tell me where my data is stored and how to back it up, update and uninstall the app without deleting my data. Ask before replacing an existing installation or deleting anything.

Prefer to install it yourself? Follow [installation and updates](docs/deployment.md). Open **http://localhost:3100**, then choose **Start fresh** or **Restore a Brewey backup**. Fresh setup downloads ingredients and full beer-style descriptions; unavailable sources can be retried later. Connect your own ChatGPT account in **Settings → Chat** to use the built-in agent.

Moving from [app.brewey.ai](https://app.brewey.ai)? Download your library from **Settings → Move to local**, then restore it during local setup. See [migration and backups](docs/hosted-migration.md).

## Your data and support

Save backups through **Settings → Backup**. Ordinary updates preserve your data; `docker compose down --volumes` deletes it. See [account recovery](docs/local-accounts.md) if you cannot sign in.

Provided **as-is, without warranty or a commitment to maintenance or support**. Forks are encouraged. Bug reports and suggestions are welcome; outside code contributions are not accepted. See [development](CONTRIBUTING.md) and [security reporting](SECURITY.md).

Brewey's own code is **MIT**. See [LICENSE](LICENSE) and [third-party notices](NOTICE.md).
