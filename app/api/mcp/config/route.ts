import { NextRequest, NextResponse } from "next/server";
import {
  getMcpBackupState,
  restartAllClients,
  updateMcpConfig,
} from "@/app/mcp/actions";
import { McpConfigData } from "@/app/mcp/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpConfigData(value: unknown): value is McpConfigData {
  return isRecord(value) && isRecord(value.mcpServers);
}

async function handleGet() {
  return NextResponse.json(await getMcpBackupState());
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

  await updateMcpConfig(payload.config, payload.updatedAt);
  await restartAllClients();

  return NextResponse.json(await getMcpBackupState());
}

export const GET = handleGet;
export const PUT = handlePut;

export const runtime = "nodejs";
