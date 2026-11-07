# Security

Brewey is provided as-is. No version has a guaranteed support period, security-update commitment or response time. Operators are responsible for securing their installation, applying updates, protecting backups and assessing whether continued use is appropriate.

Use GitHub's **Security → Report a vulnerability** for confidential reports when private reporting is enabled on the repository. Do not post exploit details, credentials, account data or database backups in public Issues. If private reporting is unavailable, do not assume Issues is a confidential channel.

Include the affected version and a minimal synthetic reproduction. A report does not guarantee a response or fix. Forks may independently maintain and distribute fixes under the applicable licences.

The default Compose binding is loopback. Before enabling remote access, configure the canonical application origin and HTTPS proxy, and complete first-owner setup on a trusted connection. Keep the database and each user's agent home private. Never mount a desktop credential directory or the Docker socket into Brewey.
