# Strict Architecture and AST Audit

The repository-local architecture audit is a read-only gate for newly introduced debt. It uses the existing TypeScript compiler parser and Acorn packages; it adds no linter dependency, rewrites no source, and has no inline suppression or editable waiver syntax.

## Run

Pass the trusted target commit explicitly:

```sh
node scripts/check-architecture.mjs --base <trusted-commit>
```

For a path and AST inventory suitable for teardown planning:

```sh
node scripts/check-architecture.mjs --report > .gnc-local/architecture-report.json
```

The report is full JSON; keep it in ignored `.gnc-local/` or attach it as a CI artifact, never commit it. Each file record includes finding rule, source file, line, column, and message. Inline `index.html` findings identify their script marker; their line is mapped to the HTML file and column is relative to that script. The `mainSource` section summarizes its AST and lists name-based clusters, large named functions with source locations, state-like binding examples, and the most frequently referenced classic-global name candidates with declaration locations.

The audit compares current findings with the same files at the trusted base. It fails when a changed/new first-party source file introduces a new empty catch, provably unreachable statement, unused-binding candidate, or write/declaration that pollutes a shared browser global. A new authored text/code file over 500 lines also fails. Existing findings remain visible in the report and do not block an unrelated change. Removed findings are reported as improvements.

The comparison includes committed and working-tree changes plus untracked files. Supply the actual PR target SHA/ref; do not use a moving or untrusted ref as the baseline. CI should provide a full-history checkout and pass the merge-base/target commit explicitly. The command exits nonzero for missing/invalid base or parse errors in changed files. No source code is modified.

## Scope and limits

- First-party JavaScript, JSX, TypeScript, TSX, Apps Script, and HTML inline JavaScript are parsed. In `index.html`, executable inline scripts are parsed independently. The exact `<script id="app-script-source" type="text/plain">` payload is parsed as the classic JavaScript application source used by the build; other plain-text payloads remain inert. JSON data scripts are validated as JSON.
- The audit excludes dependency trees, vendor/minified/generated bundles, build output, binary assets, and Git metadata from AST findings. The 500-line check identifies text by valid UTF-8 content without NUL bytes rather than by extension, so extensionless files such as `CODEOWNERS` are included. Every newly added tracked text file counts, including generated files or lockfiles when new; existing large files can be modified without triggering this new-file limit.
- Empty catches and straight-line statements after unconditional `return`, `throw`, `break`, or `continue` are detectable. The reachability rule deliberately does not attempt whole-program or complex constant-flow proofs.
- Unused declarations are conservative candidates: exports, parameters, class/object members, declaration names, and property names are excluded. Textual same-file use is used to avoid false positives from dynamic registries and inline shell handlers. A candidate is evidence for review, never an instruction to delete code.
- Global pollution covers explicit writes through `window`, `globalThis`, and `self`, mutation helpers such as `Object.assign`/`Object.defineProperty`, and new top-level declarations in classic browser scripts. It includes deployed staging browser modules under `scripts/staging/` while treating other Node tooling as non-browser unless it is placed in that runtime directory. It allows reads of host APIs and module-local bindings. Aliases, reflection, dynamically constructed property names, Apps Script globals, and some runtime registries cannot be proven statically.
- `--report` labels domains from paths and syntax signals only. The path map is a starting index: `index.html` is the legacy shell; `components/`, `live-src/`, `services/`, `utils/`, `assets/`, and `v2/src/` are UI/runtime candidates; `supabase/functions/` is backend; and `Code.gs` is Apps Script/PDF email. The main-source symbol groups use conservative keyword/prefix matching (for example, Que/Bunch/Suspend Tag, Requests/Orders, Inventory/Drive, auth/session, networking/API, sync/cache, and UI/navigation). Functions and state-like bindings can overlap conceptually, and unmatched names remain general; verify each location and its callers before extracting anything. `spanBytes` ranks syntactic function size, while global reference counts are same-unit identifier-use estimates rather than runtime call-graph reachability. There is no autofix mode.

## Baseline policy

Legacy `index.html`, including the marked application source payload, is parsed as separate inline scripts and remains baseline debt until those portions are extracted. Existing findings are compared by rule and normalized syntax fingerprint, not line number, so unrelated line shifts do not become new failures. Fix findings in the touched domain as part of its approved extraction; do not add broad suppressions or turn the first audit run into a repository-wide cleanup requirement.
