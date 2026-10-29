# IBPS PO Bilingual Practice

Monorepo for a low-clutter, bilingual (English/Hindi) IBPS PO practice app.

## Stack
- Bun, Next.js 15 (apps/web), TypeScript worker (apps/worker), Prisma + PostgreSQL, shared zod types.
- RAG ingest: `mupdf` (PDF text + page rendering), NVIDIA NIM `nvidia/nemotron-3.5-super-vl-120b-a12b` (text + image), local embeddings (`Xenova/all-MiniLM-L6-v2`).

## Setup
1. Copy `.env.example` to `.env` (root) and `apps/web/.env.local`.
2. Start database: `docker compose up -d`
3. Install deps: `bun install`
4. Generate client: `bun run db:generate`
5. Push schema: `cd packages/db && npx prisma db push`
6. Run web: `bun run dev` (http://localhost:3000)

## Automated Ingestion Pipeline

### RAG ingest (PDF -> AI parsed questions + answer table -> database)

Give it a PDF that contains both the questions and the answer table (for example `Q1 (B)  Q2 (C) ...`).
The AI (`nvidia/nemotron-3.5-super-vl-120b-a12b`, text + page images) reads every page, extracts
each question with its options, finds the answer table, links every answer to its option
(`Q1 -> option B`), embeds the question text for semantic retrieval, and stores everything in Postgres.

```bash
# one PDF
bun run worker rag-ingest "path/to/paper.pdf" --paper-key ibps-po-prelims-2020

# every PDF in a folder
bun run worker rag-ingest storage/inbox

# with Hindi translation and AI written solutions
bun run worker rag-ingest "path/to/paper.pdf" --translate --explain

# flags: --paper-key K --source-id ID --no-publish --translate --explain --no-images --json
```

Report fields: `questionsParsed`, `answersFound`, `answersMatched`, `questionsWithoutAnswer`,
`answersWithoutQuestion`, `warnings`.

Stored as:

| Table | Content |
| --- | --- |
| `fetched_documents` | the PDF itself (sha256, page count, path in `storage/raw`) |
| `papers` | one row per ingested paper + the full AI extraction (`structured` JSON) |
| `paper_answer_keys` | the answer table: `Q1 -> B`, page and optional explanation |
| `questions` / `question_options` | question, options, `correct_option_id`, `is_correct`, embedding |
| `question_variants` | English + Hindi prompt/explanation variants |
| `ingest_jobs` | job status for every ingest (download, parse and store progress) |

A question is published only when it has a matched answer and at least 4 options. Everything else
is stored as `in_review`.

### Semantic retrieval (RAG query)

```bash
bun run worker rag-search "seating arrangement two rows north facing" --limit 5 --with-answers
```

Returns the closest stored questions with similarity, options and the correct option key.

### Personal web app (Library + Practice)

The app has two screens, both reachable from the top navigation:

- `/` - **Library**: paste a PDF link, watch the download and AI parse progress, see where the PDF was
  stored locally, and browse the parsed questions grouped by section and topic (connected question sets keep
  their shared directions / passage stored once).
- `/practice` - **Practice**: solve the parsed questions, optionally scoped to one paper or one section.

```bash
# queue a document from a link (the worker downloads, parses and stores it)
curl -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/paper.pdf","paperKey":"my-paper","explain":true}'

# document list with progress, storage path and counts
curl http://localhost:3000/api/documents

# one document with its categories, connected sets and questions
curl http://localhost:3000/api/documents/<jobId>

# re-run the parse for a document
curl -X POST http://localhost:3000/api/documents/<jobId>
```

### Register a source
```bash
bun run worker register-source \
  --name "CareerPower IBPS PO PYQ" \
  --base-url "https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf" \
  --allowed-domains "www.careerpower.in" \
  --rights-status "licensed" \
  --allow-crawl --allow-ingest --allow-display \
  --listing-urls "https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf,https://www.careerpower.in/2021/ibps-po-prelims-solutions-2020.pdf"
```

### Run one full ingestion cycle (crawl → extract → structure → translate → validate → publish)
```bash
bun run worker tick [--source <sourceId>] [--paper <paperKey>] [--dry-run]
```

### Schedule continuous automation (Windows Task Scheduler)
```powershell
# Run every 30 minutes
powershell -File scripts/ingest-loop.ps1 -IntervalMinutes 30

# One-shot dry run
powershell -File scripts/ingest-loop.ps1 -DryRun -IntervalMinutes 1
```

### Publish pending candidates manually
```bash
bun run worker publish-candidates [--source <sourceId>] [--paper <paperKey>] [--dry-run]
```

## Worker commands
- `bun run worker list-sources`
- `bun run worker crawl <sourceId> <seedUrl> [--max-pages N] [--delay N] [--timeout N]`
- `bun run worker extract <documentId>` / `extract-pending [sourceId]`
- `bun run worker review <candidateId> <approve|reject|link_only> [--reason ...]`
- `bun run worker export-run <runId> [outPath]`
- `bun run worker pipeline [--source <id>] [--crawl-only] [--parse-only] [--export-only]`
- `bun run worker tick [--source <id>] [--paper <key>] [--dry-run]`
- `bun run worker register-source --name <name> --base-url <url> --allowed-domains <d1,d2> [options]`
- `bun run worker publish-candidates [--source <id>] [--paper <key>] [--dry-run]`
- `bun run worker list-sets [--source <id>]`
- `bun run worker set-info <groupId>`
- `bun run worker rag-ingest <pdf-path|pdf-url|folder> [--paper-key K] [--translate] [--explain] [--no-publish] [--json]`
- `bun run worker rag-search <query> [--limit N] [--section S] [--paper-key K] [--with-answers]`

## Validation
- `bun run questions:validate` (must report 0 issues)
- `bun run worker validate-db` (checks DB integrity)

## Content policy
- Only approved/licensed sources may be crawled; crawler gate refuses unapproved sources.
- Extracted questions land in `question_candidates` as `pending_review`; never auto-published without answer key and validation gates.
- Content comes from the RAG ingest pipeline (`rag-ingest`): the AI parses the PDF and its answer table; questions are published only with a matched answer and 4+ options.
- Seeding (`bun run db:seed`) only touches the legacy JSON questions; it never deletes RAG-ingested papers, questions or answer keys.
- Real PYQ content from approved sources (CareerPower/Adda247 IBPS PO papers).
- Correct answers are never exposed before submit; server validates submissions.
- Hindi translations for Quant/Reasoning are machine-generated (marked `translator=llm:...`); English Language questions are NOT translated (tested English preserved).
- DI/shared-context sets capture page images + VLM-extracted structured data.

## Environment variables
See `.env.example` for all options. Key additions:
- `NIM_BASE_URL`, `NIM_MODEL`, `NIM_VISION_MODEL` — NVIDIA NIM (OpenAI-compatible) endpoint for structuring, vision, translation.
- `NIM_MIN_CONFIDENCE` — minimum LLM confidence to auto-publish (default 0.85).
- `INGEST_INTERVAL_MINUTES` — scheduler interval for Windows Task Scheduler.