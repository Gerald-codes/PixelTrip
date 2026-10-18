-- Let the frontend (anon key) read room data directly and receive Realtime updates for it.
-- See docs/SUPABASE_ACCESS_BOUNDARY.md.
--
-- Guest/demo trust model: anyone with the anon key can read every room's rows in these
-- tables. Only non-sensitive room data is exposed; travel_preferences stays backend-only.
-- Add policies for other tables (messages, votes, ...) when their features land.

CREATE POLICY anon_read_party_rooms ON party_rooms
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_read_room_members ON room_members
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_read_guests ON guests
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_read_characters ON characters
  FOR SELECT TO anon USING (true);

-- Core business tables are written only by the backend (service role). RLS already blocks
-- client writes because no write policies exist; revoking the privileges as well makes
-- that explicit and keeps it true if a write policy is ever added by mistake.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON party_rooms, guests, room_members, characters, travel_preferences
  FROM anon, authenticated;
