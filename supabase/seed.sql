-- PixelTrip — Persona seed data
--
-- Seeds the 5 fixed 8-bit travel personas. Re-runnable: deletes existing
-- personas by name before inserting. planning_weight keys (food, scenery,
-- planning, relaxation, luxury, nightlife, culture, adventure) are the same
-- dimensions the itinerary agent balances when weighting activities.

delete from personas
where name in (
  'Foodie Boss',
  'Scenic Wanderer',
  'Master Planner',
  'Chill Explorer',
  'Luxury Traveller'
);

insert into personas
  (name, avatar_image, budget_level, travel_pace, interests, flexibility, decision_style, description, planning_weight)
values
  (
    'Foodie Boss',
    '/personas/foodie-boss.png',
    'medium',
    'moderate',
    '["food", "nightlife", "cafes", "street markets", "local cuisine"]'::jsonb,
    'moderate',
    'Opinionated',
    'Plans the trip around the next great meal. Hunts down street markets, hole-in-the-wall eateries, and the best local dishes, and will happily reroute the day for a standout restaurant.',
    '{"food": 0.9, "nightlife": 0.6, "culture": 0.4, "scenery": 0.2, "relaxation": 0.2, "adventure": 0.2, "luxury": 0.3, "planning": 0.3}'::jsonb
  ),
  (
    'Scenic Wanderer',
    '/personas/scenic-wanderer.png',
    'low',
    'slow',
    '["nature", "hiking", "photography", "viewpoints", "scenery"]'::jsonb,
    'flexible',
    'Easygoing',
    'Chases landscapes and golden-hour views on a budget. Prefers scenic trails, viewpoints, and slow wandering over packed schedules, and is happy to skip pricey extras.',
    '{"scenery": 0.9, "adventure": 0.6, "relaxation": 0.5, "culture": 0.3, "food": 0.3, "nightlife": 0.1, "luxury": 0.1, "planning": 0.2}'::jsonb
  ),
  (
    'Master Planner',
    '/personas/master-planner.png',
    'medium',
    'fast',
    '["museums", "landmarks", "guided tours", "history", "culture"]'::jsonb,
    'rigid',
    'Decisive',
    'Wants every hour accounted for and every must-see ticked off. Builds tight, efficient schedules around landmarks, museums, and booked tours, leaving little to chance.',
    '{"planning": 0.9, "culture": 0.7, "adventure": 0.4, "food": 0.3, "scenery": 0.3, "relaxation": 0.1, "nightlife": 0.2, "luxury": 0.3}'::jsonb
  ),
  (
    'Chill Explorer',
    '/personas/chill-explorer.png',
    'low',
    'slow',
    '["cafes", "beaches", "people-watching", "relaxation", "wandering"]'::jsonb,
    'flexible',
    'Go-with-the-flow',
    'Treats travel as downtime. Favours a relaxed pace with plenty of cafe stops, beach time, and unstructured wandering, and resists overpacked days.',
    '{"relaxation": 0.9, "food": 0.4, "scenery": 0.5, "nightlife": 0.3, "culture": 0.3, "adventure": 0.2, "luxury": 0.2, "planning": 0.1}'::jsonb
  ),
  (
    'Luxury Traveller',
    '/personas/luxury-traveller.png',
    'high',
    'moderate',
    '["fine dining", "spas", "boutique hotels", "shopping", "comfort"]'::jsonb,
    'moderate',
    'Particular',
    'Travels for comfort and quality. Gravitates to fine dining, spas, boutique stays, and premium experiences, and will pay more to avoid crowds and hassle.',
    '{"luxury": 0.9, "food": 0.6, "relaxation": 0.6, "culture": 0.4, "nightlife": 0.4, "scenery": 0.3, "adventure": 0.2, "planning": 0.4}'::jsonb
  );
