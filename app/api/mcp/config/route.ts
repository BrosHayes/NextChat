import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MCP_CONFIG, McpConfigData } from "@/app/mcp/types";

const EDGE_MCP_STATE_KEY = "__NEXTCHAT_EDGE_MCP_CONFIG__";

type EdgeMcpState = {
  config: McpConfigData;
  updatedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpConfigData(value: unknown): value is McpConfigData {
  return isRecord(value) && isRecord(value.mcpServers);
}

function getEdgeState(): EdgeMcpState {
  const globalState = globalThis as typeof globalThis & {
    [EDGE_MCP_STATE_KEY]?: EdgeMcpState;
  };

  return (
    globalState[EDGE_MCP_STATE_KEY] ?? {
      config: DEFAULT_MCP_CONFIG,
      updatedAt: 0,
    }
  );
}

function setEdgeState(state: EdgeMcpState) {
  const globalState = globalThis as typeof globalThis & {
    [EDGE_MCP_STATE_KEY]?: EdgeMcpState;
  };

  globalState[EDGE_MCP_STATE_KEY] = state;
}

async function handleGet() {
  return NextResponse.json(getEdgeState());
}

async function handlePut(req: NextRequest) {
  const body = await req.json();
  const payload = isMcpConfigData(body)
    ? {
        config: body,
        updatedAt: Date.now(),
      }
    : isRecord(body) && isMcpConfigData(body.config)
    ? {
        config: body.config,
        updatedAt:
          typeof body.updatedAt === "number" && Number.isFinite(body.updatedAt)
            ? body.updatedAt
            : Date.now(),
      }
    : null;

  if (!payload) {
    return NextResponse.json(
      {
        error: true,
        message: "Invalid MCP backup payload",
      },
      { status: 400 },
    );
  }

  setEdgeState(payload);

  return NextResponse.json({
    ...payload,
    persisted: false,
  });
}

export const GET = handleGet;
export const PUT = handlePut;

export const runtime = "edge";
