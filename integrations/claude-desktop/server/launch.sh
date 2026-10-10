#!/bin/sh
# Claude Desktop extension entry point. The real MCP server ships with the Keybroker app,
# so updating the app updates this extension too.
KB="$HOME/.keybroker/bin/keybroker"
if [ ! -x "$KB" ]; then
  echo "Keybroker isn't installed (missing $KB). Install and open Keybroker.app." >&2
  exit 1
fi
exec "$KB" mcp --client claude-desktop
