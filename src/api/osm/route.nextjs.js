/**
 * Next.js App Router Version
 * File: app/api/osm/import/route.ts
 *
 * This is the Next.js App Router equivalent of the Express handler.
 * Copy this to your Next.js project's app/api/osm/import/route.ts
 */

/*
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchPOIs, centerRadiusToBbox, getAvailableCategories, OverpassError } from '@/lib/overpass';
import { POICache, dedupePOIs } from '@/lib/cache';

// Service role client for cache (shared across users)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const poiCache = new POICache(supabaseAdmin);

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user via Supabase SSR
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Please log in to continue' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate request
    const errors = validateRequest(body);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Validation Error', messages: errors },
        { status: 400 }
      );
    }

    const {
      trip_id,
      bbox: inputBbox,
      center,
      radius_km = 5,
      categories,
      limit = 100
    } = body;

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id')
      .eq('id', trip_id)
      .eq('user_id', user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Trip not found' },
        { status: 404 }
      );
    }

    // Calculate effective bbox
    const bbox = inputBbox || centerRadiusToBbox(center.lat, center.lng, radius_km);
    const effectiveLimit = Math.min(limit, 300);

    // Check cache first
    const cacheResult = await poiCache.get(bbox, categories);

    if (cacheResult.hit) {
      const pois = dedupePOIs(cacheResult.pois).slice(0, effectiveLimit);
      return NextResponse.json({
        pois,
        meta: {
          from_cache: true,
          count: pois.length,
          bbox,
          categories,
          cache_key: cacheResult.cacheKey
        }
      });
    }

    // Handle cache stampede
    if (cacheResult.inProgress) {
      await sleep(2000);
      const retryResult = await poiCache.get(bbox, categories);
      if (retryResult.hit) {
        const pois = dedupePOIs(retryResult.pois).slice(0, effectiveLimit);
        return NextResponse.json({
          pois,
          meta: { from_cache: true, count: pois.length, bbox, categories }
        });
      }
    }

    // Acquire lock and fetch
    const lockAcquired = await poiCache.acquireLock(cacheResult.cacheKey);
    if (!lockAcquired) {
      await sleep(3000);
      const retryResult = await poiCache.get(bbox, categories);
      if (retryResult.hit) {
        const pois = dedupePOIs(retryResult.pois).slice(0, effectiveLimit);
        return NextResponse.json({
          pois,
          meta: { from_cache: true, count: pois.length, bbox, categories }
        });
      }
    }

    // Fetch from Overpass
    let result;
    try {
      result = await fetchPOIs({ bbox, categories, limit: 300 });
    } catch (error) {
      await poiCache.releaseLock(cacheResult.cacheKey);

      if (error instanceof OverpassError) {
        const statusMap: Record<string, number> = {
          RATE_LIMITED: 429,
          TIMEOUT: 504,
          API_ERROR: 502
        };
        return NextResponse.json(
          { error: error.code, message: error.message },
          { status: statusMap[error.code] || 500 }
        );
      }
      throw error;
    }

    // Dedupe and cache
    const dedupedPois = dedupePOIs(result.pois);
    await poiCache.set(bbox, categories, dedupedPois);

    // Return limited results
    const pois = dedupedPois.slice(0, effectiveLimit);
    return NextResponse.json({
      pois,
      meta: {
        from_cache: false,
        count: pois.length,
        total_fetched: dedupedPois.length,
        bbox,
        categories,
        timestamp: result.meta.timestamp
      }
    });

  } catch (error) {
    console.error('OSM import error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to import POIs' },
      { status: 500 }
    );
  }
}

function validateRequest(body: any): string[] {
  const errors: string[] = [];
  // ... same validation as Express version
  return errors;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
*/

// This file contains the Next.js App Router version as a comment.
// To use with Next.js, copy the code above to: app/api/osm/import/route.ts
module.exports = {};
