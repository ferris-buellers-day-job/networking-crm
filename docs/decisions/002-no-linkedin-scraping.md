# ADR 002: No LinkedIn scraping; manual entry only

**Status:** Accepted
**Date:** 2026-04-22

## Context
The CRM would be more useful if it could auto-populate contact photos, job titles, and company changes from LinkedIn. Three paths were considered: LinkedIn's official API, unofficial scraping, and paid third-party enrichment services.

## Decision
Store only a LinkedIn profile URL on each contact. All profile data (name, title, company, photo) is entered and maintained manually by David. The URL opens in a new browser tab when clicked so updates can be noted by hand.

## Consequences
**Easier:** no ToS exposure, no CFAA risk, no dependency on third-party APIs that may change pricing or shut down, no scraping-detection arms race, no credentials to manage.

**Harder:** contact data goes stale; David bears the cost of manual updates. Mitigated by the cadence/reminder system, which prompts periodic review.

**New risks:** none. This is the conservative choice.

## Alternatives considered
- **LinkedIn Marketing / Sales Navigator API:** gated to approved enterprise partners; individual developer access is not offered.
- **Unofficial scraping (headless browser, etc.):** violates LinkedIn ToS; *hiQ Labs v. LinkedIn* ultimately resolved on contract/CFAA grounds against hiQ in 2022; LinkedIn actively litigates and blocks.
- **Third-party enrichment (Proxycurl, Clearbit, etc.):** paid, and these services themselves operate in a legal gray zone whose longevity is uncertain.

If a trustworthy official LinkedIn-data API emerges, revisit.
