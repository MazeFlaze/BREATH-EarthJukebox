import { NextRequest, NextResponse } from "next/server";
import {
  buildProxyTargetUrl,
  resolveProxyBackendBase,
} from "@/services/backendApi";

export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxyRequest(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  const segments = context.params?.path ?? [];
  const targetUrl = buildProxyTargetUrl(segments, request.nextUrl.search);

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });
  if (!forwardHeaders.has("accept")) {
    forwardHeaders.set("accept", "application/json");
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }
    responseHeaders.set("x-breathe-proxy-upstream", resolveProxyBackendBase());

    const payload = await upstream.arrayBuffer();
    return new NextResponse(payload, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream proxy error";
    return NextResponse.json(
      {
        detail: "Backend upstream unreachable through Next.js API proxy.",
        upstream: targetUrl,
        error: message,
      },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  return proxyRequest(request, context);
}
