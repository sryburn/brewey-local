import type { LegalDocument } from '../api/legal-documents.ts';
const updated = '2026-10-06'
const content: Record<'terms_of_use' | 'privacy_policy', { title: string; text: string }> = {
  terms_of_use: {
    title: 'About this Brewey installation',
    text: `# About this Brewey installation

Brewey is a self-hosted brewing assistant. Your local account and recipe library belong to this installation. Its operator manages the server and access to its data.

## Chat and recipe tools

Chat uses the ChatGPT account you connect in Chat settings. That connection is separate from your local Brewey sign-in. Chat can create, update and delete recipes through the installation's brewing tools. Check recipe changes and calculations before brewing.

There are no Brewey credit purchases or subscription payments in this installation. Your use of ChatGPT remains subject to the terms and limits of that service.

## Your account

Keep your password and personal access tokens private. Personal access tokens grant the brewing permissions you select, shared by the API and MCP. You can revoke them in settings.

Account settings let you change your password or permanently delete your local account and its recipes. The last administrator must create another administrator before deleting their account. Deletion does not remove files you have exported elsewhere or copies retained separately by the server operator.

For questions about access, operation or recovery, contact this installation's operator. This page describes how the installation works; it does not grant a software or ingredient-catalogue licence.`,
  },
  privacy_policy: {
    title: 'Data in this Brewey installation',
    text: `# Data in this Brewey installation

## Data stored on the server

The installation stores local account details, password hashes, brewing profiles, preferences, recipes, saved conversations and personal access token records in its SQLite database. Session cookies identify your signed-in account and are HttpOnly. Your connected ChatGPT credentials are kept in a separate server-side Codex home for your Brewey account.

The server operator controls its storage and any backups. Ask the operator about access, retention or recovery arrangements for this installation.

## Browser storage

Saved conversation history is stored in the installation’s SQLite database. The browser holds active UI state and debugging logs; debugging files can be exported. Signing out or switching Brewey accounts clears that account's active browser conversation and recipe state. Exported files remain wherever you save them; debugging exports can contain chat and recipe details.

## ChatGPT requests

When you use chat, your messages and conversation context are sent to OpenAI through the ChatGPT account you connected. That context can include your brewing profile, selected recipe and uploaded recipe file. OpenAI handles those requests under the connected account's service terms and data settings. Consult those settings before sending information you do not want processed by that service.

## Deleting data

Deleting your Brewey account removes its application records and server-side Codex connection. Browser exports and separately retained backups are outside that deletion. Contact the installation operator for questions about those copies.`,
  },
}

export function installationDocument(type: 'terms_of_use' | 'privacy_policy'): LegalDocument {
  return { id: `selfhosted-${type}`, document_type: type, version: '2', title: content[type].title,
    effective_date: updated, last_updated: updated, content: content[type].text,
    is_active: true, created_at: updated, updated_at: updated };
}
