import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fs = require("fs");
  const path = require("path");
  const storagePath = path.join(process.cwd(), "storage", asset.storagePath);
  if (!fs.existsSync(storagePath)) {
    return NextResponse.json({ error: "file missing" }, { status: 404 });
  }

  const file = fs.readFileSync(storagePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": file.length.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}