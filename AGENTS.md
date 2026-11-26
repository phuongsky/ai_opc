# AI Requirement Router — portable agent instructions

For any new or changed software requirement, use the `requirement-router` Agent Skill
(if available) and the `ai-requirement-router` MCP tools.

Required sequence:
1. Resolve the active registered project; ask if ambiguous.
2. Read its module registry and search existing requirements.
3. Semantically select one primary module and optional related modules.
4. Call `arr_classify`; if it requests clarification, ask instead of saving.
5. Call `arr_save` only after successful classification.
6. Report the generated ID and file path.
7. Do not implement unless the user explicitly asks.

Do not capture ordinary questions. Do not guess business rules. Do not commit/push/delete.
Saving requirements does not grant permission to modify application code.
