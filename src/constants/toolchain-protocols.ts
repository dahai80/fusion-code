export function getGitConflictProtocol(): string {
    return `# Git conflict resolution protocol

## When conflicts occur

1. Don't panic. Read the conflict markers carefully.
2. Understand both sides: what did YOUR branch change? What did THEIR branch change?
3. Determine intent: are the changes compatible? Complementary? Contradictory?

## Resolution strategies

- Both added different content → combine both, maintain logical order
- Both modified same line → understand which change is correct, keep that one
- One deleted, one modified → is the deletion intentional? If yes, delete. If no, keep the modification.
- Import conflicts → merge both import lists, remove duplicates

## Resolution steps

1. Read the conflicted file: git diff --name-only --diff-filter=U
2. For each conflicted file: read both versions, understand the changes
3. Resolve by editing the file: remove conflict markers, write the correct content
4. Mark as resolved: git add <file>
5. Continue: git rebase --continue or git merge --continue
6. Run tests after resolving all conflicts

## Common pitfalls

- Don't just pick "ours" or "theirs" blindly. That silently drops changes.
- Don't leave conflict markers in the file. Always verify resolution is clean.
- Don't resolve conflicts without understanding the code. Read first.
- After resolving, ALWAYS build and test. Resolving conflicts often introduces bugs.

## Prevention

- Pull/rebase frequently to reduce conflict surface
- Keep changes small and focused
- Communicate with team about overlapping changes
- Use feature flags instead of long-lived branches`
}

export function getCIDebuggingProtocol(): string {
    return `# CI debugging protocol

## When CI fails

1. Read the CI error output. It usually tells you exactly what's wrong.
2. Reproduce locally first if possible. Can't fix what you can't reproduce.
3. Common CI failures:
   - Flaky tests (pass locally, fail in CI) → timing/ordering/environment differences
   - Missing dependencies (works locally) → lock file out of sync or global packages
   - Permission errors → CI runs as different user, different file permissions
   - Environment differences → check Node/Python/system versions in CI vs local

## Debugging steps

1. Check the error: build failure? Test failure? Lint error? Deploy failure?
2. Build failure:
   - Missing dependency → check lock file, run install with frozen lockfile
   - Type error → check Node/TypeScript version matches CI
   - Syntax error → might be version-specific syntax not supported in CI
3. Test failure:
   - Same test always fails → real bug, fix it
   - Random tests fail → flaky, check timing/mocking/async issues
   - Works locally but not CI → environment difference (timezone, locale, file system)
4. Lint error:
   - Different lint version in CI → pin lint version
   - Different config → check if CI uses same config file

## CI-specific issues

- Cache invalidation: clear CI cache if builds seem stale
- Resource limits: CI may have less memory/CPU → reduce parallelism
- Network issues: CI may block external URLs → mock external calls
- Timeout: CI jobs have time limits → optimize slow tests or increase timeout

## After fixing

- Verify the fix in CI, not just locally
- If the fix was environment-specific, document it in the CI config
- If you found a flaky test, fix it or mark it as skipped with a TODO
- Add the failure pattern to your knowledge for next time`
}

export function getDockerDebuggingProtocol(): string {
    return `# Docker debugging protocol

## Build failures

1. Read the Dockerfile. Understand each layer.
2. Common build failures:
   - Base image not found → check image name and registry access
   - Package install fails → check network, package versions, system deps
   - COPY fails → check file paths relative to build context
   - Permission denied → check USER directive and file ownership

3. Debugging steps:
   - docker build --no-cache → rule out cache issues
   - docker build --progress=plain → see full build output
   - Run the failing step interactively: docker run -it <base-image> bash

## Runtime failures

1. Container exits immediately → docker logs <container>
2. Common runtime failures:
   - App crashes on start → check env vars, config files, port bindings
   - Permission denied → check volume mount permissions, USER directive
   - Port not accessible → check EXPOSE and port mapping (-p flag)
   - Health check fails → check health check command, timing, dependencies

3. Debugging steps:
   - docker exec -it <container> bash → inspect running container
   - docker inspect <container> → check config, env vars, network
   - docker logs -f <container> → stream logs in real-time

## Networking issues

- Container can't reach host → use host.docker.internal (Docker Desktop) or host network
- Containers can't talk to each other → check docker network, use service names as hostnames
- DNS resolution fails → check docker network DNS, try --dns flag

## Volume issues

- File not found in volume → check mount path (host:absolute vs container:absolute)
- Permission denied on volume → check UID/GID mapping, use --user flag
- Changes not persisted → check if volume is read-only, verify mount is correct

## Docker Compose issues

- Service won't start → docker compose logs <service>
- Dependency order → check depends_on, add health checks
- Environment not passed → check .env file, env_file directive, environment section
- Rebuild after Dockerfile change → docker compose build --no-cache <service>`
}

export function getPackageManagerProtocol(): string {
    return `# Package manager protocol

## Choosing the right command

- Node.js: check lock file → package-lock.json (npm), yarn.lock (yarn), bun.lockb (bun), pnpm-lock.yaml (pnpm)
- Python: check for uv.lock (uv), poetry.lock (poetry), requirements.txt (pip)
- Rust: always cargo
- Go: always go mod

## Adding a package

1. Use the project's existing package manager. Don't mix npm and yarn.
2. Add the package: npm install <pkg>, bun add <pkg>, etc.
3. Check the lock file was updated.
4. Verify: import the package in a test file, run the build.

## Removing a package

1. Find all imports: Grep for the package name across the codebase.
2. If still imported somewhere → don't remove it.
3. Remove: npm uninstall <pkg>, bun remove <pkg>, etc.
4. Verify build and tests pass.

## Updating packages

1. Check for security updates first: npm audit, bun audit
2. Update specific package: npm update <pkg>
3. Update all: npm update (careful — may break things)
4. After updating: run build, run tests. Fix any breakage.

## Lock file rules

- NEVER manually edit lock files
- ALWAYS commit lock files to version control
- If lock file conflicts: don't resolve manually. Delete and regenerate.
- CI should use frozen lockfile: npm ci, bun install --frozen-lockfile

## Monorepo considerations

- Use workspaces: npm/yarn/bun workspaces
- Install at root, not in sub-packages
- Use turbo/nx/lerna for build orchestration if the project already does`
}

export function getBuildSystemProtocol(): string {
    return `# Build system protocol

## When the build fails

1. Read the error message. It tells you the file, line, and what's wrong.
2. Fix the FIRST error first. Often fixes cascading errors.
3. Common build errors:
   - Module not found → check import path, check if package is installed
   - Type error → check type definitions, may need @types/ package
   - Syntax error → check for missing brackets, commas, or version-specific syntax
   - Circular dependency → refactor to break the cycle

## Build debugging

1. Clean build: delete build artifacts (dist/, build/, .cache/) and rebuild
2. Verbose output: use --verbose or --debug flag
3. Check build configuration: tsconfig.json, webpack.config, vite.config, etc.
4. Check environment: Node version, environment variables, platform

## Build optimization

- Don't optimize build speed unless it's actually slow
- Common optimizations: tree-shaking, code splitting, caching, parallel builds
- Measure before and after. If <10% improvement, not worth the complexity

## Watch mode

- Use watch mode during development for faster feedback loops
- If watch mode breaks: full clean + rebuild usually fixes it
- Don't rely on watch mode for production builds. Always do a clean build.`
}

export function getLintFormatProtocol(): string {
    return `# Lint and format protocol

## When lint fails

1. Read the lint error. It tells you the rule violated and the location.
2. Determine: is this a real issue or a false positive?
   - Real issue → fix the code
   - False positive → add an inline disable comment with explanation
3. Don't globally disable lint rules. Fix the root cause.

## Common lint fixes

- Unused import → remove it
- Unused variable → remove or prefix with _ (if intentionally unused)
- Missing return type → add it (TypeScript)
- Any type → replace with specific type or unknown
- console.log → remove (use proper logger)
- Missing error handling → add it

## Formatting

1. Follow the project's formatter (Prettier, Biome, Black, etc.)
2. Don't argue about style. Let the formatter decide.
3. If the formatter isn't configured: don't add one. Match existing style manually.
4. Format only the code you changed. Don't reformat the entire file.

## Integration with editor

- Enable format-on-save if the project has a formatter
- Enable lint-on-save for immediate feedback
- Don't fight the linter. If it says something's wrong, it probably is.

## CI integration

- Lint should run in CI. If it doesn't, add it.
- Format check (--check flag) should run in CI.
- Don't add new lint rules that fail on existing code. Add them as warnings first, then fix and promote to errors.`
}

export function getMonitoringProtocol(): string {
    return `# Monitoring and alerting protocol

## Adding monitoring

- Only add monitoring for things that matter to users or operations
- Track: error rates, latency (p50/p95/p99), throughput, resource utilization
- Don't track: every function call, every variable value (metric spam)

## Alerting design

- Alert on symptoms (user-visible problems), not causes (internal state)
  - BAD: alert when CPU > 80%
  - GOOD: alert when API latency p99 > 2s
- Alert thresholds: set them based on data, not guesses
- Alert fatigue is real: too many alerts = no alerts. Keep them meaningful.
- Every alert should have a runbook: what to do when it fires.

## Log-based monitoring

- Structure logs for searchability (JSON, consistent fields)
- Include correlation IDs across service boundaries
- Log at the right level: error for failures, warn for degradation, info for state changes
- Don't use logs for metrics. Use a metrics system.

## Health checks

- Liveness: is the process running? (simple endpoint returning 200)
- Readiness: can it serve traffic? (check dependencies: DB, cache, external APIs)
- Startup: is it still initializing? (for slow-starting services)
- Health checks should be lightweight. Don't do expensive operations.`
}
