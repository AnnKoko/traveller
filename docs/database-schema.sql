-- ============================================
-- Traveller OSM Explore Feature - Database Schema
-- Stack: Supabase Postgres with RLS
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. TRIPS TABLE
-- ============================================
CREATE TABLE trips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    destination VARCHAR(255),
    destination_lat DECIMAL(10, 7),
    destination_lng DECIMAL(10, 7),
    status VARCHAR(20) DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trips_user_id ON trips(user_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_dates ON trips(start_date, end_date);

-- RLS Policies
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trips"
    ON trips FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trips"
    ON trips FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trips"
    ON trips FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trips"
    ON trips FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- 2. ACTIVITIES TABLE (Trip-specific POIs)
-- ============================================
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

    -- OSM identifiers (for dedupe and linking)
    osm_type VARCHAR(10) CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id BIGINT,

    -- Core fields
    name VARCHAR(500) NOT NULL,
    category VARCHAR(50) NOT NULL,
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,

    -- Optional details
    website VARCHAR(2000),
    phone VARCHAR(50),
    opening_hours VARCHAR(500),

    -- Address (flattened for simplicity)
    address_street VARCHAR(255),
    address_housenumber VARCHAR(20),
    address_city VARCHAR(100),
    address_postcode VARCHAR(20),
    address_country VARCHAR(100),

    -- Raw data preservation
    raw_tags JSONB DEFAULT '{}',

    -- Trip planning fields
    scheduled_date DATE,
    scheduled_time TIME,
    duration_minutes INTEGER,
    notes TEXT,
    cost_estimate DECIMAL(10, 2),
    cost_currency VARCHAR(3) DEFAULT 'USD',
    is_booked BOOLEAN DEFAULT FALSE,
    booking_reference VARCHAR(100),

    -- Metadata
    source VARCHAR(20) DEFAULT 'osm' CHECK (source IN ('osm', 'manual', 'google', 'other')),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one OSM POI per trip
    CONSTRAINT unique_osm_poi_per_trip UNIQUE (trip_id, osm_type, osm_id)
);

-- Indexes
CREATE INDEX idx_activities_trip_id ON activities(trip_id);
CREATE INDEX idx_activities_category ON activities(category);
CREATE INDEX idx_activities_scheduled ON activities(scheduled_date, scheduled_time);
CREATE INDEX idx_activities_osm ON activities(osm_type, osm_id);
CREATE INDEX idx_activities_location ON activities USING GIST (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)
);

-- RLS Policies (via trip ownership)
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view activities of own trips"
    ON activities FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = activities.trip_id
            AND trips.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert activities to own trips"
    ON activities FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = activities.trip_id
            AND trips.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update activities of own trips"
    ON activities FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = activities.trip_id
            AND trips.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete activities of own trips"
    ON activities FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = activities.trip_id
            AND trips.user_id = auth.uid()
        )
    );

-- ============================================
-- 3. POI_CACHE TABLE (Shared Overpass cache)
-- ============================================
CREATE TABLE poi_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Cache key (hash of query parameters)
    cache_key VARCHAR(64) NOT NULL UNIQUE,

    -- Query parameters (for debugging/inspection)
    bbox_south DECIMAL(10, 7),
    bbox_west DECIMAL(10, 7),
    bbox_north DECIMAL(10, 7),
    bbox_east DECIMAL(10, 7),
    categories TEXT[] NOT NULL,

    -- Cached data
    poi_count INTEGER NOT NULL DEFAULT 0,
    payload JSONB NOT NULL,  -- Array of normalized POIs

    -- Cache metadata
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    -- Lock for cache stampede prevention
    fetch_in_progress BOOLEAN DEFAULT FALSE,
    fetch_started_at TIMESTAMPTZ,

    -- Stats
    hit_count INTEGER DEFAULT 0,
    last_hit_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_poi_cache_key ON poi_cache(cache_key);
CREATE INDEX idx_poi_cache_expires ON poi_cache(expires_at);
CREATE INDEX idx_poi_cache_fetch_progress ON poi_cache(fetch_in_progress) WHERE fetch_in_progress = TRUE;

-- No RLS on cache - it's shared (accessed via service role)
-- Cache is read/written only by backend, not directly by users

-- ============================================
-- 4. HELPER FUNCTIONS
-- ============================================

-- Function to generate stable cache key
CREATE OR REPLACE FUNCTION generate_cache_key(
    p_bbox_south DECIMAL,
    p_bbox_west DECIMAL,
    p_bbox_north DECIMAL,
    p_bbox_east DECIMAL,
    p_categories TEXT[]
) RETURNS VARCHAR(64) AS $$
DECLARE
    sorted_categories TEXT[];
    key_string TEXT;
BEGIN
    -- Sort categories for consistent hashing
    SELECT ARRAY_AGG(cat ORDER BY cat) INTO sorted_categories
    FROM UNNEST(p_categories) AS cat;

    -- Round bbox to 4 decimal places (~11m precision) for cache hits
    key_string := FORMAT(
        'bbox:%s,%s,%s,%s|cats:%s',
        ROUND(p_bbox_south::numeric, 4),
        ROUND(p_bbox_west::numeric, 4),
        ROUND(p_bbox_north::numeric, 4),
        ROUND(p_bbox_east::numeric, 4),
        ARRAY_TO_STRING(sorted_categories, ',')
    );

    RETURN encode(digest(key_string, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to convert center+radius to bbox
CREATE OR REPLACE FUNCTION center_radius_to_bbox(
    p_lat DECIMAL,
    p_lng DECIMAL,
    p_radius_km DECIMAL
) RETURNS TABLE(south DECIMAL, west DECIMAL, north DECIMAL, east DECIMAL) AS $$
DECLARE
    lat_delta DECIMAL;
    lng_delta DECIMAL;
BEGIN
    -- Approximate: 1 degree lat = 111km, 1 degree lng = 111km * cos(lat)
    lat_delta := p_radius_km / 111.0;
    lng_delta := p_radius_km / (111.0 * COS(RADIANS(p_lat)));

    RETURN QUERY SELECT
        (p_lat - lat_delta)::DECIMAL AS south,
        (p_lng - lng_delta)::DECIMAL AS west,
        (p_lat + lat_delta)::DECIMAL AS north,
        (p_lng + lng_delta)::DECIMAL AS east;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM poi_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to update activity timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER trips_updated_at
    BEFORE UPDATE ON trips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER activities_updated_at
    BEFORE UPDATE ON activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 5. SCHEDULED JOBS (via pg_cron or Supabase)
-- ============================================
-- Run daily to clean up expired cache
-- In Supabase: use Edge Functions + cron or pg_cron extension
-- SELECT cron.schedule('cleanup-poi-cache', '0 3 * * *', 'SELECT cleanup_expired_cache()');
