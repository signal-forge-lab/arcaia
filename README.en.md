# Arcaia ChatGPT Toolkit

English | [日本語](README.md)

Arcaia is a Chrome extension that augments the ChatGPT web UI with local display and workflow helpers. The Japanese README remains the detailed release log; this file provides the public English overview and repository policy.

## Highlights

Arcaia adds browser-side conveniences such as conversation navigation, Markdown export/copy helpers, model-state presentation, notifications, recent-view rendering, and other UI enhancements. It is designed to avoid unnecessary polling and to keep browser-side behavior bounded to the active ChatGPT surface.

## Install for development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository directory.
4. Reload the extension after source changes.

The extension is under active development and ChatGPT DOM changes can require compatibility updates.

## Public repository boundary

This public repository contains source, tests, documentation, and source assets required to review and develop Arcaia. Machine-specific state is intentionally excluded.

Do not commit:

- `.env` files or credentials;
- private keys, certificates, or provisioning material;
- local agent/runtime logs and scratch data;
- workstation-specific paths or profiles;
- generated distribution archives or build output.

Generated packages should be produced from source when needed instead of being kept in the source tree.

## Documentation

- `README.md` — Japanese release history and detailed notes.
- `docs/` — architecture, runtime contracts, refactoring plans, and review notes.

## Status

This is a development build. Internal diagnostics should remain opt-in and temporary; production behavior should avoid adding background observers, polling loops, or data collection unless the feature explicitly requires them.
