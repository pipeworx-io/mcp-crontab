# mcp-crontab

Crontab expression MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1140+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `describe_cron` | Parse and validate a cron expression (5 fields or an @alias) and describe it in plain English. Returns the parsed fields and whether it is valid. |
| `next_runs` | Compute the next N run times (UTC ISO-8601) for a cron expression. Optionally start from a given time. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "crontab": {
      "url": "https://gateway.pipeworx.io/crontab/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1140+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Crontab data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
