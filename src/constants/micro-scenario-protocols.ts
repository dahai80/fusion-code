export function getDeploymentProtocol(): string {
    return `# Deployment protocol

## Pre-deployment checklist

1. Verify build passes locally before any deployment attempt
2. Run the full test suite. Zero failures allowed.
3. Check environment variables: are all required vars set in the target environment?
4. Verify database migrations: are they reversible? Run on staging first.
5. Check config drift: compare target env config with what you expect.

## Deployment execution

1. Deploy to staging first. Verify. Then production.
2. Use the project's existing deployment tooling (Makefile, CI pipeline, deploy scripts).
3. Don't invent deployment methods. Follow what already works.
4. After deployment: smoke test the critical path. Don't assume success.

## Rollback protocol

- If deployment breaks production: rollback FIRST, investigate SECOND.
- Know the rollback command before you deploy.
- If rollback isn't available: fix forward, but tell the user the risk.
- After rollback: document what went wrong and why.

## Zero-downtime considerations

- If the app serves traffic: check for running migrations that lock tables.
- Check for background jobs that might fail with new code.
- Verify health check endpoints respond after deployment.
- If there's a cache: consider invalidation strategy.`
}

export function getConfigChangeProtocol(): string {
    return `# Config change protocol

## Reading config

- Read the current config BEFORE changing it. Understand what each value does.
- Check if the config is version-controlled. If yes, track changes via git.
- Check if the config has validation (schema, types). Know the constraints.

## Making config changes

1. Identify the config file and format (JSON, YAML, TOML, .env, INI)
2. Read the file. Understand current values.
3. Make the minimal change needed.
4. Verify syntax is correct for the format (common mistake: JSON trailing comma, YAML indentation)
5. Check if the app needs restart to pick up changes.
6. Check if the change affects other services.

## Environment-specific config

- Never modify production config without explicit user approval.
- Different environments (dev/staging/prod) may have different values.
- Check for config inheritance or overlay patterns (base + env-specific).
- .env files: never commit them. .env.example is OK.

## Secret management

- API keys, passwords, tokens → environment variables, not config files.
- If you see a hardcoded secret: flag it to the user immediately.
- Don't log config values that contain secrets.
- If the project uses a secret manager (Vault, AWS SSM), follow that pattern.`
}

export function getCodeMigrationProtocol(): string {
    return `# Code migration protocol

## Before migrating

1. Understand the source: what API/pattern/library are you migrating FROM?
2. Understand the target: what API/pattern/library are you migrating TO?
3. Map the API differences: which functions map to which? What's removed? What's new?
4. Estimate scope: how many files? How many call sites?

## Migration strategy

- For small migrations (<10 call sites): direct replacement in one pass.
- For medium migrations (10-50 call sites): batch by module/directory.
- For large migrations (50+ call sites): use an adapter/facade pattern first, migrate incrementally.

## Execution

1. Create the replacement code. Test it independently first.
2. Migrate call sites in dependency order: leaf modules first, then dependents.
3. After each batch: build + test. Don't let broken code accumulate.
4. Remove the old code only after ALL call sites are migrated and tested.
5. Don't keep the old API "for backward compatibility" unless the user asks.

## Common migration patterns

- Library A → Library B: find all imports, map API calls, update tests
- Old API → New API: create wrapper functions if needed, deprecate old, migrate callers
- Class-based → Functional: extract logic to functions, keep same behavior
- Callback → Async/Await: sequential transformation, test each conversion
- REST → GraphQL: map endpoints to queries/mutations, update client code`
}

export function getEnvSetupProtocol(): string {
    return `# Environment setup protocol

## New project setup

1. Check what runtime/package manager the project uses (package.json → npm/bun/pnpm, requirements.txt → pip/uv, Cargo.toml → cargo)
2. Run the install command. If it fails, read the error carefully.
3. Check for post-install scripts (prisma generate, husky install, etc.)
4. Verify the build works with a clean install.
5. Check for required global tools (Node version, Python version, etc.)

## Dependency installation issues

- Permission error → try without sudo, check node_modules ownership
- Version conflict → check package.json version ranges, try --legacy-peer-deps
- Network error → check registry config (.npmrc, pip.conf), try mirror
- Lock file out of sync → delete lock file, reinstall
- Native module build failure → check build tools (gcc, python, node-gyp)

## Runtime environment

- Node version mismatch → use nvm/volta to switch
- Python version mismatch → use pyenv/conda to switch
- Missing system deps → check README for prerequisites
- Port already in use → find and kill the process, or use a different port
- Disk space → check df -h, clean caches if needed

## Docker environment

- Build fails → check Dockerfile, try docker build with --no-cache
- Container won't start → docker logs <container>, check entrypoint
- Networking → check exposed ports, docker network, DNS resolution
- Volumes → check mount paths, permissions on mounted directories`
}

export function getTestWritingProtocol(): string {
    return `# Test writing protocol

## When to write tests

- User asks for a feature → write tests for the feature
- User asks for a bug fix → write a test that reproduces the bug FIRST, then fix
- User asks for a refactor → existing tests must pass before and after
- User doesn't mention tests → still verify existing tests pass after your changes

## What to test

- Happy path: does the core functionality work?
- Edge cases: empty input, null, undefined, boundary values, very large input
- Error paths: what happens when dependencies fail? Invalid input?
- Integration: does the component work with its real dependencies?

## Test structure

1. Arrange: set up the test data and preconditions
2. Act: call the function/endpoint/operation being tested
3. Assert: verify the result matches expectations

## Test anti-patterns to avoid

- Don't test implementation details. Test behavior.
  - BAD: assert(internalState.counter === 3)
  - GOOD: assert(result.length === 3)
- Don't mock what you don't own. Mock external APIs, not internal modules.
- Don't make tests depend on each other. Each test runs independently.
- Don't use fixed timestamps or random values without controlling them.
- Don't catch and swallow errors in tests. Let them fail loudly.

## Test naming

- Describe the expected behavior: "should return 404 for non-existent user"
- Not the implementation: "should call database.findById"
- Not just "test1", "test2", etc.

## Running tests

- After writing tests: run them to verify they PASS.
- After fixing code: run the specific failing tests first, then the full suite.
- If tests fail and it's not your code: investigate. Don't ignore pre-existing failures.
- If your change breaks existing tests: fix the code, not the tests (unless the test was testing the wrong thing).`
}

export function getLoggingProtocol(): string {
    return `# Logging protocol

## When to add logging

- Error handling: log the error with context (what operation, what inputs, what was expected)
- State transitions: log when entering a new state (especially async flows)
- Debug points: add temporary logging to trace values, REMOVE after debugging

## What to log

- Log: operation name, relevant identifiers, error details, timing for slow operations
- Don't log: full request/response bodies (unless debugging), credentials, PII
- Log levels: error (failures) > warn (unexpected but handled) > info (state changes) > debug (tracing)

## Log format

- Follow the project's existing logging pattern (library, format, transport)
- If no pattern exists: use structured logging (JSON) with timestamp, level, message, context
- Make logs searchable: include request IDs, user IDs, operation names
- Don't use string interpolation for structured logs. Use key-value pairs.

## Common mistakes

- Logging sensitive data: passwords, tokens, API keys, personal info → NEVER
- Log spam in hot loops: use sampling or rate-limited logging
- Missing context: "operation failed" → useless. "createUser failed: email already exists (user@example.com)" → useful
- Swallowing errors by logging them: if you log an error, either handle it or re-throw it
- Using console.log in production code: use the project's logger, not raw console`
}

export function getAPIIntegrationProtocol(): string {
    return `# API integration protocol

## Before integrating

1. Read the API documentation. Understand endpoints, auth, rate limits, error formats.
2. Check if there's an existing SDK/client in the project. Don't write HTTP calls from scratch if one exists.
3. Understand the data model: what are the request/response shapes?
4. Identify auth requirements: API key? OAuth? Session token?

## Implementation

1. Create a typed client/interface for the API. Don't spread raw HTTP calls across the codebase.
2. Handle ALL error responses the API can return. Don't just handle 200.
3. Add request timeouts. Never let API calls hang indefinitely.
4. Add retry logic for transient errors (5xx, rate limits with Retry-After header).
5. Validate response shapes. External APIs can change without notice.

## Error handling for external APIs

- Network error (ECONNREFUSED, timeout) → retry with backoff, then fail gracefully
- 4xx error → don't retry. Fix the request. Log the error details.
- 5xx error → retry with exponential backoff (max 3 attempts)
- Rate limited (429) → respect Retry-After header. Don't hammer the API.
- Response validation failure → log the unexpected shape, handle gracefully

## Security

- Never expose API keys in client-side code.
- Use HTTPS. Always. No exceptions.
- Validate and sanitize data from external APIs before using it.
- Don't trust external API responses. They can be malformed or malicious.
- Use request signing or token rotation if the API supports it.`
}

export function getErrorHandlingProtocol(): string {
    return `# Error handling addition protocol

## When to add error handling

- At system boundaries: user input, external APIs, file I/O, network calls
- In async code: every await should consider the error case
- In resource management: open → must close, allocate → must free
- NOT in internal code where errors should propagate up

## How to add error handling

1. Identify what can go wrong (the failure modes)
2. Decide: can you recover? Or should you let it propagate?
3. If recoverable: handle it at this level. Log + continue/fallback.
4. If not recoverable: let it propagate. Don't swallow it.
5. Always preserve the original error (wrap, don't replace).

## Error handling patterns

- Try/catch: for expected errors you can handle
  - BAD: catch (e) { console.log(e) } — swallowed
  - GOOD: catch (e) { logger.error('Failed to fetch user', { userId, error: e }); throw e }
- Result type: for operations that can fail without throwing
  - return { ok: true, data } or { ok: false, error: 'reason' }
- Validation: check preconditions before operations
  - if (!user) throw new Error('User not found') — not try/catch after null access

## Common mistakes

- Catching too broadly: catch (e) without checking error type
- Swallowing errors: catch + log + continue without handling
- Losing context: throw new Error('Failed') without the original error
- Over-handling: try/catch on every line. Handle at the right level.
- Ignoring async errors: .then() without .catch(), or await without try/catch

## Error messages

- Be specific: "User not found" → "User with id 123 not found in database"
- Include context: what operation failed, what were the inputs
- Don't expose internals to end users: "Internal error" not "NullPointerException at UserService.java:42"
- Make errors actionable: "File not found: /path/to/config.json. Create it or set CONFIG_PATH env var."`
}

export function getTypeSafetyProtocol(): string {
    return `# Type safety improvement protocol

## When to add types

- When the codebase uses TypeScript/Python with type hints → follow the pattern
- When adding types reduces bugs (union types for state machines, branded types for IDs)
- When types serve as documentation for complex data flows
- NOT when the code is simple and types add no value (one-liner functions)

## TypeScript type safety

1. Avoid 'any'. Use 'unknown' if you don't know the type, then narrow it.
2. Use discriminated unions for state machines: { status: 'loading' } | { status: 'success', data: T }
3. Use branded types for IDs: type UserId = string & { __brand: 'UserId' }
4. Make illegal states unrepresentable: design types so invalid data doesn't compile.
5. Use const assertions and satisfies operator for literal types.

## Python type safety

1. Use type hints for function signatures. Don't annotate local variables unless ambiguous.
2. Use Literal types for fixed values: def set_mode(mode: Literal['read', 'write'])
3. Use Protocol for structural typing. Don't force inheritance.
4. Use dataclasses or Pydantic models instead of raw dicts.
5. Run mypy/pyright in CI. Fix type errors, don't add 'type: ignore'.

## Migration strategy

- Don't add types to the entire codebase at once. Add types incrementally.
- Start with public APIs and shared modules. Internal code can wait.
- Use 'unknown' as a stepping stone: any → unknown → specific type.
- After adding types, run the type checker. Fix real errors, suppress false positives with comments explaining why.`
}

export function getLegacyCodeInteractionProtocol(): string {
    return `# Legacy code interaction protocol

## Before touching legacy code

1. Read it. All of it. Don't assume you understand it from the function name.
2. Understand the invariants: what does this code depend on? What depends on it?
3. Check for implicit contracts: undocumented behavior that callers rely on.
4. Check for tests. If tests exist, they document expected behavior. If not, be extra careful.

## Working with legacy code

1. Make SMALL changes. Large rewrites of legacy code almost always introduce bugs.
2. Add tests BEFORE changing legacy code. Characterization tests: capture current behavior.
3. Follow the Boy Scout Rule: leave the code better than you found it, but don't remodel the campsite.
4. Don't modernize for the sake of modernizing. If it works, leave it alone.
5. When you must change legacy code: change the minimum, test the maximum.

## Refactoring legacy code safely

1. Write characterization tests first (tests that document current behavior, even if it seems wrong)
2. Make one change at a time. Run tests after each change.
3. Use the Strangler Fig pattern: build new code alongside old, migrate gradually.
4. Don't change the public API until all internals are migrated.
5. If the legacy code has no tests and is too risky to test: wrap it in an adapter with tests.

## Common pitfalls

- Assuming the code does what the comments say. Comments lie. Code doesn't.
- Breaking implicit contracts that aren't documented anywhere.
- "Cleaning up" error handling that was there for a reason.
- Changing timing/ordering that other code depends on implicitly.
- Removing "dead code" that's actually used by reflection, dynamic dispatch, or configuration.`
}

export function getDocUpdateProtocol(): string {
    return `# Documentation update protocol

## When to update docs

- You changed a public API → update API docs
- You changed CLI arguments or config format → update README/usage docs
- You added a new feature → update feature docs
- You fixed a bug that was documented as a known issue → remove the known issue
- You changed environment variables → update env var documentation

## What to document

- Public APIs: parameters, return types, error cases, examples
- Configuration: what each setting does, default values, valid ranges
- Architecture: module boundaries, data flow, key design decisions
- Setup: prerequisites, installation steps, first-run instructions

## What NOT to document

- Implementation details that are obvious from the code
- Things that change frequently (use auto-generated docs instead)
- Internal functions that only 2 people will ever call
- Comments that just restate the code: // increment counter → counter++

## Documentation style

- Follow the project's existing doc format (JSDoc, docstrings, markdown, etc.)
- Code examples > prose descriptions. Show, don't tell.
- Keep docs close to the code they describe (co-locate, don't centralize).
- Update docs in the same commit as the code change. Don't leave it "for later".`
}

export function getCrossPlatformProtocol(): string {
    return `# Cross-platform protocol

## File paths

- Always use path.join() or path.resolve(), never string concatenation with /
- Path separators: Windows uses \, Unix uses /. path.join handles this.
- Case sensitivity: macOS is case-insensitive, Linux is case-sensitive. Use exact case.
- Home directory: use os.homedir() or ~ expansion, never hardcode /home/user

## Line endings

- Git should handle this via .gitattributes: * text=auto
- If you must handle line endings: normalize to \n internally, convert on output
- CRLF issues: don't reformat entire files just to fix line endings

## Shell commands

- Don't assume bash is available. On Windows, it might be cmd or PowerShell.
- Use Node.js APIs (fs, child_process) over shell commands when possible.
- If you must use shell commands: document the platform requirement.
- Avoid platform-specific flags (e.g., ls --color on macOS vs --color=auto on Linux)

## Environment variables

- Windows: set VAR=value. Unix: export VAR=value. Use cross-env in package.json scripts.
- PATH separator: ; on Windows, : on Unix. Use path.delimiter.
- Case: Windows env vars are case-insensitive, Unix are case-sensitive.

## File system

- Don't assume file system is case-sensitive (macOS) or case-insensitive (Linux)
- Don't assume /tmp exists (Windows uses %TEMP%). Use os.tmpdir().
- Don't assume executable permissions work the same (Windows vs Unix).`
}
