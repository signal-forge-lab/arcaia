# Arcaia diagnostic tools

`tools/` contains bounded, diagnostic-only probes and development utilities.
None of these files are loaded by the normal Arcaia runtime.

## Standalone extension probes

- `arcaia_initial_render_probe_extension/`
  - Captures document-start and initial-render timing when a one-shot console
    probe cannot observe early enough.
- `arcaia_model_decoration_watch_probe_extension/`
  - Watches model-decoration presence and native-versus-Arcaia display correctness across DOM replacement and navigation.
- `arcaia_assistant_render_gap_watch_probe_extension/`
  - Separately watches assistant-response display gaps and reload restoration. It does not diagnose model decoration.
- `arcaia_backend_contract_probe_extension/`
  - Correlates conversation API schema, Recent View rewrite state, timestamp turn assignment, and DOM turn structure without storing response bodies or IDs.
- `arcaia_model_selector_interaction_probe_extension/`
  - Correlates Composer geometry, Picker selection, Chat/Work authoritative
    model state, Arcaia decoration state, and future style variants.

## One-shot browser probes

- `arcaia_file_preview_copy_probe.js`
- `arcaia_file_preview_tooltip_probe.js`
- `assistant_completion_signal_diagnostic.js`
- `chat_ui_observer_scope_probe.js`
- `model_selector_dom_diagnostic.js`
- `model_selector_observer_scope_probe.js`
- `model_selector_thinking_level_probe.js`
- `recent_view_dom_observer_probe.js`
- `recent_view_history_controls_probe.js`
- `timestamp_model_selector_transition_probe.js`

Use these only for the named symptom. They must remain privacy-bounded and
must not be copied into the normal extension runtime.

## Development utility

- `arcaia_sound_tuner.py`
  - Normalizes and compares bundled notification sounds during development.

## Cleanup rule

Issue-specific probes should be removed after the source is identified and the
result is no longer needed for a pending fix. Reusable lifecycle, DOM-scope,
and UI-comparison probes may remain for future ChatGPT regressions.
