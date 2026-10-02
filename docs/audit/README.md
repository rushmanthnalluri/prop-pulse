# PropPulse — Audit Archive

Audit files in this directory are dated forensic evidence. They describe the
code and verification state at the time they were produced and may mention
bugs that were fixed later.

**Current release status is not defined by these files.** Use the repository
root `RELEASE_STATUS.md` and the latest GitHub Actions verification artifact
for the current state.

Do not copy historical test counts, dependency findings, performance figures,
or release verdicts into current documentation without re-verifying them on
the commit being released.

## How to read the archive

- `FINAL_AUDIT.md` and wave reports document earlier audit passes.
- Red-team and frontend reports document specific attack/UX surfaces.
- Agent logs record implementation chronology rather than release truth.
- Current code and current CI are authoritative when a historical report
  conflicts with the present repository.
