import { NextRequest, NextResponse } from "next/server";
import md5 from "spark-md5";
import { ACCESS_CODE_PREFIX } from "@/app/constant";
import { getServerSideConfig } from "@/app/config/server";

function getAccessCode(req: NextRequest) {
  const authToken = req.headers.get("Authorization") ?? "";
  const token = authToken.trim().replaceAll("Bearer ", "").trim();

  if (!token.startsWith(ACCESS_CODE_PREFIX)) {
    return "";
  }

  return token.slice(ACCESS_CODE_PREFIX.length).trim();
}

async function handle(req: NextRequest) {
  const serverConfig = getServerSideConfig();

  if (!serverConfig.needCode) {
    return NextResponse.json({
      authorized: true,
      needCode: false,
    });
  }

  const accessCode = getAccessCode(req);
  const hashedCode = md5.hash(accessCode).trim();
  const authorized = serverConfig.codes.has(hashedCode);

  return NextResponse.json(
    {
      authorized,
      needCode: true,
    },
    {
      status: authorized ? 200 : 401,
    },
  );
}

export const POST = handle;

export const runtime = "edge";
