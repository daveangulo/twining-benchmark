# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it through [GitHub Security Advisories](https://github.com/daveangulo/twining-benchmark/security/advisories/new).

**Do not** open a public issue for security vulnerabilities.

## Scope

The following are in scope:

- The benchmark harness CLI and orchestrator (`src/`)
- Agent session execution and sandboxing (`src/runner/`)
- Condition setup (plugin installation, MCP server config)
- Score computation and data collection
- The analysis package (`analysis/`)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Resolution target**: Within 14 days for confirmed vulnerabilities
- **Disclosure**: Coordinated disclosure after a fix is available

## Security Considerations

This harness executes AI agent sessions that run code. Key safeguards:

- **API Keys**: Never committed. Use `ANTHROPIC_API_KEY` env var or `claude auth login`
- **Plugin Isolation**: `--setting-sources ''` prevents user plugins from leaking across conditions
- **Agent Sandboxing**: Sessions run in temporary git worktrees, cleaned up after each iteration
- **Cost Controls**: `--budget` flag enforces dollar limits

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |
