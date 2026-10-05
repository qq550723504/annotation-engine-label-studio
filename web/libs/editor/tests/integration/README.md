# LSF Cypress integration tests

Cypress e2e tests for the Label Studio Frontend editor. They run in CI against the same production standalone build that this doc describes.

## Local verification (CI-like build + Cypress UI)

To reproduce CI locally and debug in Cypress UI:

**1. Build the editor (production standalone, same as CI)**

From the `web/` directory:

```bash
MODE=standalone yarn nx run editor:build:production
```

**2. Serve the build on port 3000**

In the same or another terminal, from `web/`:

```bash
yarn lsf:serve-static
```

Leave this running. Confirm in the browser: [http://localhost:3000](http://localhost:3000) should load the LSF app (and CSS).

This uses the repository's Nx file-server target and its frozen `http-server`
dependency. CI starts the same server directly against the downloaded build.
Native audio/video tests require HTTP byte ranges; an arbitrary static server
may load the page correctly while giving different media duration or seeking
behavior. In particular, Python 3.11's `python -m http.server` returns the entire
file for a range request and is unsuitable for these media tests.

From another terminal, verify the audio response before running Cypress:

```bash
curl -sS -D - -H 'Range: bytes=0-63' \
  http://localhost:3000/public/files/barradeen-emotional.mp3 -o /tmp/editor-range.bin
wc -c /tmp/editor-range.bin
```

Expect status `206`, `Content-Range: bytes 0-63/<file size>` and a 64-byte body.
CI checks these properties and compares the bytes with the audio/video fixtures.

**3. Run Cypress in UI mode**

In a second terminal, from `web/`:

```bash
yarn lsf:integration:watch
```

This opens the Cypress UI. Choose a spec and run it; tests will hit `http://localhost:3000` (baseUrl in config). You can step through, inspect the app, and see exactly what Cypress sees.

To run headless (like CI) instead:

```bash
yarn lsf:integration
```
