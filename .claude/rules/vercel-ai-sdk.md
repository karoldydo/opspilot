---
paths:
  - apps/api/**/*.ts
---
# Vercel AI SDK (agent layer)

The agent runs on the **Vercel AI SDK** server-side in `apps/api`, against a user-configured LLM
provider.

## Structured synthesis

- Use `generateObject` with a Zod schema defined in `@opspilot/shared` for the synthesis output;
  the FE renders `z.infer` of that schema. See `contracts.md`.
- Do NOT invent per-run output schemas; the synthesis output is a single fixed schema.

## Tool-calling & skills

- Use `generateText` + tool-calling for skill execution; type each tool's input with a Zod schema.
- Do NOT add a free-form chat/prompt entry point; the agent runs only predefined skills, scoped
  to the target device.
- Route SSH-backed skills through the executor abstraction (see `node-ssh.md`); stream
  long-running runs over SSE (see `sse.md`).
