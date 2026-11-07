# Copyright and third-party material

Copyright © 2026 sryburn. Brewey's own code is licensed under the MIT License. See [LICENSE](LICENSE). This grant does not relicense third-party material.

The water optimizer derives from `brewing-water-calculator` 2.0.0 (MIT). Its original copyright and licence remain in [water.LICENSE](frontend/src/lib/domain/water.LICENSE). Node.js, Codex and other installed dependencies retain their own licences and notices.

## Catalogue material

The repository and image contain ingredient identities for migration, conversion rules, a small reviewed supplement with original descriptions, and beer-style names, numbers and brewing statistics. They do not contain the downloaded ingredient catalogue or full BJCP style descriptions.

Style metadata is from the **BJCP 2021 Beer Style Guidelines**, copyright © 2021 BJCP, Inc. BJCP's [usage guidance](https://www.bjcp.org/faq/i-want-to-use-your-style-guidelines-can-i/) permits naming, numbering and style-parameter excerpts. The [official BJCP site](https://www.bjcp.org/bjcp-style-guidelines/) is the authoritative source for current guidelines.

During setup, Brewey downloads ingredient files from public sources listed in [the manifest](catalog/manifest.json), and style descriptions from a pinned [community transcription](https://github.com/bjcp-brasil/styleguide-2021) configured in [styles.json](catalog/styles.json). Downloaded material retains its original ownership and terms. Public availability and a checksum establish neither permission to redistribute nor an open-source licence. BJCP's guidance asks application developers using the full guidelines to contact its communication director; this project does not claim that permission has been obtained. An installation-time download avoids bundling the text but does not grant additional rights to use or redistribute it.

Downloads, caches, generated catalogues and user backups must stay outside source releases and images. Review the applicable source terms before republishing any generated catalogue. [Catalogue documentation](catalog/README.md) explains provenance and source updates. The release check verifies the public file boundary; it is not legal clearance of external downloads.
