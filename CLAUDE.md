# Claude Code Project Instructions

## MANDATORY: Twining Lifecycle Gates

This project uses the Twining plugin for coordination and decision tracking.
Use the `twining:*` skills for all lifecycle gates:

- **Before work:** invoke `twining:twining-orient`
- **After decisions:** invoke `twining:twining-decide`
- **Before completion:** invoke `twining:twining-verify`

---

## Serena MCP Best Practices

This project uses the Serena MCP server for intelligent code navigation and editing.

### Code Navigation Principles

**Prefer symbolic tools over file reads:**
- Use `get_symbols_overview` first to understand a file's structure
- Use `find_symbol` with `include_body=false` to explore before reading
- Only use `include_body=true` when you need the actual implementation
- Avoid reading entire files unless absolutely necessary

**Symbol discovery workflow:**
1. Start with `get_symbols_overview` for file structure
2. Use `find_symbol` with `depth=1` to see class members
3. Use `find_referencing_symbols` to understand usage patterns
4. Only then read specific symbol bodies you need

### Search Strategy

- `find_symbol` — When you know the symbol name (supports substring matching)
- `search_for_pattern` — For arbitrary text patterns, non-code files, or unknown symbol names
- `find_file` — When looking for files by name/mask
- `list_dir` — For directory structure exploration

Always pass `relative_path` when you know the scope. Use `restrict_search_to_code_files=true` for code-only searches.

### Editing Guidelines

**Symbol-based editing (preferred):**
- Use `replace_symbol_body` for modifying entire methods/functions/classes
- Use `insert_after_symbol` / `insert_before_symbol` for adding code
- Always check references with `find_referencing_symbols` before renaming

**Use file-based editing for:**
- Small inline changes within a large method
- Non-code files (config, markdown, etc.)
- Files without clear symbol structure

### Java-Specific Guidelines

This is a Java project. Keep in mind:
- Class names match file names
- Use name paths like `ClassName/methodName` for methods
- Constructors are named `<init>` in symbol trees
- Inner classes use `OuterClass/InnerClass` paths

### Efficiency Tips

1. **Be incremental:** Don't read more than you need
2. **Use depth parameter:** Control how deep to explore symbol trees
3. **Scope your searches:** Always provide `relative_path` when possible
4. **Trust tool results:** Don't verify successful operations unnecessarily
5. **Batch related operations:** Make multiple independent calls in parallel
