# levelsfyi-visualizer

React + Vite app for querying and decoding Levels.fyi salary search payloads.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run the app and paste your bearer token in the form.

## Run

```bash
npm run dev
```

Open the local URL shown by Vite.

## Form Inputs

- Bearer token
- Company (`companySlug`)
- Min YoE (`minYearsOfExp`)
- Max YoE (`maxYearsOfExp`)
- Location (currently fixed option: SF Bay Area -> `dmaIds[]=807`)

All other query params are static and match the sample curl values.
