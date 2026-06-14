"""MCP server exposing the Hermes Agent decision engine to MCP clients.

Mounts FastMCP onto the existing FastAPI app so OpenClaw and other MCP
clients can call domain_decide / domain_audit / domain_register / etc.
via the standard MCP streamable-http transport.
"""
