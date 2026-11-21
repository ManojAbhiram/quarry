# Quarry Documentation

Official product, technical, and operational documentation for Quarry.

Last reviewed: 18 November 2026. These documents describe the implementation in this repository; they do not certify a hosted deployment or live-provider validation.

## Getting started

- [Customer Guide](product/09-Product-Guide.md): account setup, research, lead review, lists, outreach, and integrations.
- [Personal API Connections](user-api-connections.md): search credentials, AI provider setup, model selection, and the account introduction.
- [Deployment and Operations](product/05-Deployment-and-Operations.md): configuration, deployment, backups, and troubleshooting.
- [Repository setup](../README.md): local development commands and project layout.

Research requires a personal Serper key and a configured AI connection. OpenRouter currently supports model discovery and selection. The other five AI adapters have deferred model setup; saving a key alone does not enable AI work. See the [provider metadata policy](provider-metadata-policy.md).

## Product and engineering reference

| Document | Purpose | PDF |
|---|---|---|
| [Product Requirements](product/01-PRD.md) | Scope, requirements, personas, and acceptance criteria | [Download](product/pdf/01-Quarry-PRD.pdf) |
| [System Design](product/02-System-Design.md) | Architecture, data flows, runtime, and design decisions | [Download](product/pdf/02-Quarry-System-Design.pdf) |
| [Data Model and API](product/03-Data-Model-and-API.md) | Storage, modules, endpoints, and configuration | [Download](product/pdf/03-Quarry-Data-Model-and-API.pdf) |
| [Security and Compliance](product/04-Security-and-Compliance.md) | Implemented controls, privacy scope, and known limitations | [Download](product/pdf/04-Quarry-Security-and-Compliance.pdf) |
| [Deployment and Operations](product/05-Deployment-and-Operations.md) | Runtime configuration, maintenance, and release procedures | [Download](product/pdf/05-Quarry-Deployment-and-Operations.pdf) |
| [Test Strategy and QA](product/06-Test-Strategy-and-QA.md) | Automated coverage, validation boundaries, and release checks | [Download](product/pdf/06-Quarry-Test-Strategy-and-QA.pdf) |
| [UX and Design Specification](product/07-UX-and-Design-Spec.md) | Navigation, screens, interaction patterns, and accessibility | [Download](product/pdf/07-Quarry-UX-and-Design-Spec.pdf) |
| [Roadmap and Release Plan](product/08-Roadmap-and-Release-Plan.md) | Delivery status, remaining work, and launch criteria | [Download](product/pdf/08-Quarry-Roadmap-and-Release-Plan.pdf) |
| [Customer Guide](product/09-Product-Guide.md) | Task-oriented instructions for users and workspace administrators | [Download](product/pdf/09-Quarry-Product-Guide.pdf) |

## Connection policies

- [Personal API Connections](user-api-connections.md)
- [Provider Metadata Policy](provider-metadata-policy.md)

## Historical records

The following records preserve earlier proposals and implementation decisions. Their examples, checklists, test totals, and descriptions of the system apply to the date recorded. Use the product and connection documentation above for current behavior.

- [Concierge pilot proposal](designs/quarry-concierge-pilot.md)
- [Interface concept study](designs/quarry-ui-directions.html)
- [SQLite migration design](superpowers/specs/2026-11-07-sqlite-migration-design.md)
- [SQLite migration plan](superpowers/plans/2026-11-07-sqlite-migration.md)
- [Personal connections and onboarding design](superpowers/specs/2026-11-14-user-api-connections-design.md)
- [Personal connections implementation record](superpowers/plans/2026-11-16-user-api-connections.md)

## Documentation maintenance

Update Markdown sources when behavior changes and regenerate the corresponding PDFs. Keep current instructions independent of implementation history and local machine paths. Mark proposals and historical evidence explicitly, and distinguish implemented behavior from live-service verification and planned work. Interactive API documentation is available at `/docs` on a running API.

The Customer Guide uses its original Quarry-branded layout. Regenerate it from the repository root with `apps/api/.venv/Scripts/python.exe docs/product/build_product_guide.py`. The [guide renderer](product/build_product_guide.py) preserves the navy cover, cyan accents, Segoe UI typography, tables, and workflow diagrams. It requires ReportLab from the API dependencies and the Segoe UI/Consolas font files; use `--font-dir` when those fonts are stored elsewhere.

The Customer Guide uses its original Quarry-branded layout. Regenerate it from the repository root with `apps/api/.venv/Scripts/python.exe docs/product/build_product_guide.py`. The [guide renderer](product/build_product_guide.py) preserves the navy cover, cyan accents, Segoe UI typography, tables, and workflow diagrams. It requires ReportLab from the API dependencies and the Segoe UI/Consolas font files; use `--font-dir` when those fonts are stored elsewhere.
