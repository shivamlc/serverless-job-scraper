@AGENTS.md

## Claude-Code-specific notes

- This is a **spec-driven** repo: `specs/*.md` are the contract, `docs/roadmap.md` is the rationale behind them (self-contained — copied in from the sibling `claude-job-search` repo, which is slated for archiving). Read the relevant spec before implementing or reviewing a feature in this repo — don't rely on memory of the roadmap conversation alone, the specs are more precise and are the source of truth for implementation details.
- Terraform `apply`/`destroy` and any real AWS deploy or ECR push require explicit, in-the-moment user confirmation regardless of what was approved earlier in the session — see AGENTS.md's safety rules.
