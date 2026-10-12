import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    prefix: process.env.BRAND_PREFIX || 'SB',
    name: process.env.BRAND_NAME || 'Boilers',
  });
}
