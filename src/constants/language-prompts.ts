export function getTypeScriptSection(): string {
    return `# TypeScript coding patterns

## Type system
 - Use strict mode. Enable noUncheckedIndexedAccess, noImplicitOverride, exactOptionalPropertyTypes where practical.
 - Prefer interfaces for object shapes, types for unions/intersections/utilities.
 - Use discriminated unions for state machines: { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: E }.
 - Avoid type assertions (as). Use type guards, narrowing, or generics instead.
 - Use satisfies operator for type checking without widening: const config = { port: 3000 } satisfies Config.
 - Use branded types for domain IDs: type UserId = string & { __brand: 'UserId' }.
 - Prefer readonly for immutable data. Use Readonly<T> or readonly modifier on arrays and tuples.

## Async patterns
 - Always handle promise rejections. Never fire-and-forget promises.
 - Use async/await over .then()/.catch() chains for readability.
 - For concurrent operations, use Promise.all() for independent work, Promise.allSettled() when some failures are acceptable.
 - Add AbortController support for long-running operations: const controller = new AbortController(); signal: controller.signal.
 - Timeout pattern: Promise.race([operation(), sleep(timeout).then(() => throw new Error('timeout'))]).

## Error handling
 - Create custom error classes that extend Error. Include context in the message.
 - Use Result/Either pattern for expected failures: type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }.
 - Never catch errors just to log and re-throw. Either handle or propagate.
 - For API errors, create a typed error hierarchy: ApiError > NotFoundError, ValidationError, AuthError.

## Module patterns
 - Use named exports. Avoid default exports — they make refactoring harder.
 - Group related types, utilities, and constants in the same module.
 - Use barrel exports (index.ts) sparingly — only for public API boundaries.
 - Keep circular dependencies out. Use dependency injection or events for cross-module communication.

## Common pitfalls
 - Don't use any. Use unknown if you don't know the type, then narrow it.
 - Don't use non-null assertion (!). Handle the null case explicitly.
 - Don't use enum. Use const objects with as const: const Direction = { Up: 'up', Down: 'down' } as const.
 - Don't use global type declarations (.d.ts) for module-level types. Use regular .ts files.
 - Avoid namespace keyword. Use ES modules.

## Node.js specifics
 - Use stream API for large data processing. Don't buffer everything in memory.
 - Handle process signals (SIGTERM, SIGINT) for graceful shutdown.
 - Use worker_threads for CPU-intensive work, not child_process.
 - Set appropriate timeouts on HTTP requests and database connections.

## React patterns
 - Keep components small and focused. Extract custom hooks for stateful logic.
 - Use React.memo sparingly — only when profiling shows re-renders are a problem.
 - Prefer controlled components. Uncontrolled should be rare and intentional.
 - Use useId() for unique IDs, not Math.random() or index keys.
 - Handle loading/error states in every data-fetching component.`
}

export function getPythonSection(): string {
    return `# Python coding patterns

## Type hints
 - Use type hints on all function signatures. Use pyright/mypy strict mode.
 - Prefer modern syntax: list[int] not List[int], dict[str, int] not Dict[str, int].
 - Use Protocol for structural typing, ABC for nominal typing.
 - Use Literal for fixed values: def mode(mode: Literal['train', 'eval']).
 - Use TypeGuard for custom type narrowing.
 - Use dataclass or pydantic models instead of raw dicts for structured data.

## Error handling
 - Use specific exception types. Never catch bare Exception unless you re-raise.
 - Create custom exception hierarchies: class AppError(Exception): pass; class NotFoundError(AppError): pass.
 - Use context managers for resource cleanup: with open(f) as file:.
 - Log the full traceback at debug level, concise message at error level.
 - For expected failures, use the Result pattern or explicit None returns with type hints.

## Async patterns
 - Use async/await with asyncio. Don't mix sync and async code.
 - Use asyncio.gather() for concurrent operations. Use asyncio.TaskGroup for structured concurrency (3.11+).
 - Always add timeouts: asyncio.wait_for(operation(), timeout=30).
 - Use aiohttp/httpx for async HTTP. Don't run synchronous requests in async code.
 - Use async generators (async for / async yield) for streaming data.

## Common pitfalls
 - Don't use mutable default arguments: def foo(items=[]) creates a shared list. Use None and initialize inside.
 - Don't use star imports (from module import *). Import only what you need.
 - Don't use == for None comparison. Use is None / is not None.
 - Don't catch and ignore exceptions silently. At minimum, log at warning level.
 - Don't use f-strings in log messages. Use lazy formatting: logger.info("value=%s", val).

## Project structure
 - Use pyproject.toml for project configuration. Avoid setup.py/setup.cfg.
 - Use src layout: src/package_name/ not package_name/ at root.
 - Keep tests in tests/ at project root, not inside the package.
 - Use a virtual environment. Never install packages globally.

## Testing
 - Use pytest. Write tests as test_<what>_<condition>_<expected>.
 - Use fixtures for setup. Scope them appropriately (function, module, session).
 - Use parametrize for testing multiple inputs: @pytest.mark.parametrize("input,expected", [...]).
 - Mock external dependencies only. Don't mock internal modules.
 - Use freezegun for time-dependent tests. Use responses/pytest-httpx for HTTP mocking.`
}

export function getRustSection(): string {
    return `# Rust coding patterns

## Ownership and borrowing
 - Prefer borrowing (&T) over ownership transfer. Clone only when necessary and documented.
 - Use Cow<str> for functions that sometimes need owned, sometimes borrowed strings.
 - Use lifetimes explicitly when the compiler requires it. Don't fight the borrow checker — restructure.
 - Use Arc<Mutex<T>> for shared mutable state across threads. Use RwLock when reads dominate.
 - Avoid .clone() as a first solution. Check if borrowing or restructuring works first.

## Error handling
 - Use Result<T, E> for recoverable errors. Use panic! only for unrecoverable bugs.
 - Use thiserror for library error types. Use anyhow for application code.
 - Use the ? operator for error propagation. Don't match on Ok/Err manually.
 - Define error types that are actionable. Include context: what failed, what was expected, what was actual.
 - Use .context() or .with_context() to add information as errors propagate up the stack.

## Async patterns
 - Use tokio as the async runtime. Don't mix runtimes.
 - Use tokio::spawn for fire-and-forget tasks. Use JoinHandle to await results.
 - Use tokio::select! for racing futures or handling cancellation.
 - Always handle cancellation in long-running futures. Check CancellationToken or use tokio::select! with a cancel signal.
 - Use channels (tokio::sync::mpsc, oneshot, broadcast) for communication between tasks.

## Common pitfalls
 - Don't use .unwrap() in production code. Use .expect("why this is safe") at minimum.
 - Don't use String when &str suffices. Don't use Vec when &[T] suffices.
 - Don't implement From<BigError> for SmallError — the conversion may lose context.
 - Don't use static mut. Use std::sync::OnceLock or lazy_static.
 - Avoid Deref polymorphism. Use explicit methods or traits.

## Project structure
 - One crate per concern. Use workspace for multi-crate projects.
 - Put integration tests in tests/. Put unit tests in the same file with #[cfg(test)].
 - Use features for optional functionality. Keep the default feature set minimal.
 - Document public API with /// doc comments. Build docs with cargo doc.

## Performance
 - Profile before optimizing. Use cargo flamegraph, criterion for benchmarks.
 - Prefer iterators over indexing. They're zero-cost and more readable.
 - Use zero-copy parsing with &str references when possible (nom, winnow).
 - Use SmallVec/SmallVec for vectors that are usually small. Avoid Vec<Box<dyn Trait>>.`
}

export function getGoSection(): string {
    return `# Go coding patterns

## Error handling
 - Always check errors. Never ignore the error return value with _.
 - Wrap errors with context: fmt.Errorf("reading config: %w", err).
 - Use errors.Is() and errors.As() for error checking, not type assertions.
 - Define sentinel errors for expected conditions: var ErrNotFound = errors.New("not found").
 - Don't panic in library code. Return errors. Panics are for unrecoverable bugs only.

## Concurrency
 - Use goroutines for I/O-bound work. Use sync.Pool for object reuse.
 - Always use channels or sync primitives for goroutine communication. Don't share memory.
 - Use context.Context for cancellation and timeouts. Pass it as the first parameter.
 - Use errgroup for managing groups of goroutines that can fail.
 - Prevent goroutine leaks: always have an exit condition (context cancellation, channel close, done signal).

## Common pitfalls
 - Don't defer Close() in long-running functions — defer runs at function end, not scope end.
 - Don't use interface{} (or any) when generics or concrete types work.
 - Don't start goroutines without knowing how they'll stop. Every goroutine needs an exit strategy.
 - Don't use global mutable state. Pass dependencies explicitly.
 - Range over slices, don't index unless you need the index.

## Project structure
 - Follow the standard Go project layout. cmd/ for binaries, internal/ for private packages, pkg/ for public.
 - Use go.mod for dependency management. Run go mod tidy regularly.
 - Keep packages focused. A package should do one thing well.
 - Write table-driven tests: func TestFoo(t *testing.T) { cases := []struct{...}{...} }.

## Testing
 - Use the testing package. Write _test.go files alongside the code.
 - Use t.Run for subtests. Use t.Parallel for independent tests.
 - Use httptest for HTTP handler testing. Use testify for assertions if the project already uses it.
 - Mock interfaces, not concrete types. Define small interfaces for external dependencies.`
}

export function getJavaSection(): string {
    return `# Java coding patterns

## Modern Java (17+)
 - Use records for immutable data carriers: record Point(int x, int y) {}.
 - Use sealed classes for restricted hierarchies: sealed interface Shape permits Circle, Square {}.
 - Use pattern matching with instanceof: if (obj instanceof String s) { use s directly }.
 - Use text blocks for multi-line strings: """...""".
 - Use var for local variables when the type is obvious from the right side.

## Error handling
 - Use checked exceptions for recoverable conditions. Use unchecked for programming errors.
 - Create specific exception types. Don't throw generic Exception.
 - Always include the cause when wrapping: throw new AppException("context", cause).
 - Use try-with-resources for AutoCloseable. Never rely on finalizers.
 - Log exceptions at the appropriate level. Don't log and re-throw the same exception.

## Common pitfalls
 - Don't use raw types. Use generics: List<String>, not List.
 - Don't use == for object comparison. Use .equals(). Use Objects.equals() for null safety.
 - Don't return null for collections. Return Collections.emptyList() or an empty array.
 - Don't use StringBuffer. Use StringBuilder (not thread-safe, but faster).
 - Don't create unnecessary objects in hot paths. Reuse where possible.

## Spring Boot specifics
 - Use constructor injection, not field injection (@Autowired on fields).
 - Keep controllers thin. Delegate to services.
 - Use @Transactional at the service layer, not the controller.
 - Use DTOs for API boundaries. Don't expose entity objects directly.
 - Use Spring's exception handling (@ControllerAdvice) for consistent error responses.`
}

export function getDatabaseSection(): string {
    return `# Database patterns

## Query design
 - Always use parameterized queries. Never interpolate values into SQL strings.
 - Add appropriate indexes for common query patterns. Don't over-index.
 - Use EXPLAIN/EXPLAIN ANALYZE to verify query plans before optimizing.
 - Limit result sets. Use pagination (LIMIT/OFFSET or cursor-based) for large queries.
 - Use transactions for multi-step operations that must be atomic.

## Migration patterns
 - Make migrations additive when possible. Avoid modifying existing columns in breaking ways.
 - Always provide a rollback strategy for every migration.
 - Test migrations against production-like data volumes.
 - Run migrations before deploying code that depends on them (expand-contract pattern).
 - Don't rename columns directly. Add new column, migrate data, drop old column in separate migrations.

## ORM patterns
 - Don't use the ORM as an abstraction that hides the database. Understand the generated SQL.
 - Use eager loading (JOIN FETCH, includes) for N+1 query prevention.
 - Use raw SQL for complex queries. Don't fight the ORM for things it's not designed for.
 - Map entities to domain objects at the repository boundary. Don't leak entities into business logic.

## Common pitfalls
 - Don't store large blobs in the database. Use object storage (S3) and store the reference.
 - Don't use SELECT *. Specify the columns you need.
 - Don't use OFFSET for deep pagination. Use cursor-based (WHERE id > last_id LIMIT N).
 - Don't run schema changes without a migration. Don't modify tables manually in production.`
}

export function getCLIPatternsSection(): string {
    return `# CLI tool patterns

## Command structure
 - Follow POSIX conventions: short flags (-v), long flags (--verbose), -- for end-of-flags.
 - Use subcommands for complex tools: tool subcommand [flags] [args].
 - Provide --help on every command. Include examples in help text.
 - Use exit codes correctly: 0 for success, 1 for errors, 2 for usage errors.
 - Read from stdin when no file arguments provided. Write to stdout. Errors to stderr.

## User experience
 - Show progress for long operations. Use spinners or progress bars.
 - Provide clear error messages with actionable suggestions: "Config file not found at /path. Create one with: tool init".
 - Support --dry-run for destructive operations. Show what would happen without doing it.
 - Use color output when connected to a terminal. Disable with --no-color or NO_COLOR env var.
 - Support configuration files with sensible defaults. Allow env var overrides.

## Implementation patterns
 - Use a proper argument parser. Don't parse argv manually.
 - Validate inputs early. Fail fast with clear messages.
 - Use structured logging (JSON) for machine consumption, pretty printing for humans.
 - Handle signals (SIGINT, SIGTERM) for graceful shutdown. Clean up temp files and resources.
 - Test CLI tools by capturing stdout/stderr and exit codes. Use heredoc for complex inputs.`
}

export function getAPIDesignSection(): string {
    return `# API design patterns

## REST conventions
 - Use nouns for resources: /users, /orders, not /getUsers.
 - Use HTTP methods correctly: GET (read), POST (create), PUT (full update), PATCH (partial update), DELETE.
 - Return appropriate status codes: 200 (OK), 201 (Created), 204 (No Content), 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 422 (Unprocessable), 429 (Too Many Requests), 500 (Server Error).
 - Use consistent error response format: { error: { code: "VALIDATION_ERROR", message: "...", details: [...] } }.
 - Version APIs in the URL (/v1/users) or via header (Accept: application/vnd.api.v1+json).

## Authentication and authorization
 - Use Bearer tokens for API authentication. Don't put tokens in URLs.
 - Use short-lived access tokens with refresh tokens for SPAs.
 - Validate permissions at the route handler level, not just in middleware.
 - Use principle of least privilege. Don't grant blanket access.
 - Log authentication failures at warning level. Never log tokens or passwords.

## Pagination and filtering
 - Use cursor-based pagination for large datasets (next_cursor, has_more).
 - Support filtering via query params: /users?status=active&role=admin.
 - Support field selection: /users?fields=id,name,email.
 - Include total count only when specifically requested (it can be expensive).
 - Set reasonable default page sizes. Allow clients to request up to a maximum.

## Common pitfalls
 - Don't return internal error details to clients. Log internally, return generic message.
 - Don't use sequential IDs if enumeration is a concern. Use UUIDs or snowflake IDs.
 - Don't make breaking changes without versioning. Add new fields as optional first.
 - Don't ignore rate limiting. Implement it from the start. Use sliding window algorithms.
 - Don't store sensitive data in query parameters (they appear in logs and browser history).`
}

export function getDevOpsCloudSection(): string {
    return `# Cloud and DevOps patterns

## Infrastructure as code
 - Use Terraform/Pulumi for infrastructure. Don't create resources manually.
 - Store state remotely (S3+DynamoDB for Terraform). Never commit state files.
 - Use modules for reusable components. Keep modules small and composable.
 - Use workspaces or separate state files for environments (dev/staging/prod).
 - Run plan before apply. Review the diff. Use policy checks (OPA/Sentinel).

## Container patterns
 - Use multi-stage builds. Final image should have only the runtime binary + minimal OS.
 - Don't run as root. Add a non-root user: RUN adduser -D appuser && USER appuser.
 - Pin base image versions: node:20.10-alpine, not node:latest.
 - Use .dockerignore to exclude: .git, node_modules, .env, __pycache__, *.pyc.
 - Health checks: add HEALTHCHECK instruction or use /healthz endpoint.

## CI/CD
 - Keep pipelines fast. Fail fast. Fix fast. Target <10 minutes.
 - Use matrix builds for cross-platform testing.
 - Cache dependencies aggressively (node_modules, pip cache, cargo target).
 - Run security scanning in CI: SAST, dependency audit, container scanning.
 - Don't skip CI. If it's flaky, fix it. Don't add retry-without-fix hacks.

## Monitoring and observability
 - Use structured logging (JSON). Include: timestamp, level, message, trace_id, span_id.
 - Use distributed tracing for microservices. Propagate trace context.
 - Set up alerting on SLOs, not individual metrics. Alert on user impact.
 - Use red metrics: Rate (requests/s), Errors (%), Duration (latency percentiles).
 - Keep dashboards focused. One dashboard per service, one per SLO.`
}
