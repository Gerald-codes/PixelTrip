import type { TravelVibe } from './types';

/**
 * Maps each non-'anywhere' TravelVibe to a curated list of destination chips
 * shown in the DestinationSuggestionPicker when the user selects that vibe.
 *
 * Used by DestinationSuggestionPicker to derive the visible chip set as the
 * deduplicated union of all selected vibes' chip lists.
 */
export const VIBE_CHIPS: Record<Exclude<TravelVibe, 'anywhere'>, string[]> = {
  asia: ['Japan', 'South Korea', 'Taiwan', 'Thailand', 'Vietnam', 'Indonesia', 'Malaysia'],
  western_cities: ['Italy', 'France', 'Spain', 'UK', 'Switzerland', 'Netherlands', 'Germany'],
  beach_escape: ['Bali', 'Maldives', 'Phuket', 'Krabi', 'Cebu', 'Da Nang', 'Okinawa'],
  nature_scenery: ['Hokkaido', 'New Zealand', 'Switzerland', 'Zhangjiajie', 'Taiwan East Coast', 'Northern Vietnam'],
  food_trip: ['Osaka', 'Seoul', 'Taipei', 'Bangkok', 'Penang', 'Ho Chi Minh City', 'Hong Kong'],
  culture_trip: ['Kyoto', 'Seoul', 'Beijing', 'Istanbul', 'Rome', 'Barcelona', 'Hanoi'],
  adventure_trip: ['New Zealand', 'Nepal', 'Hokkaido', 'Northern Vietnam', 'Taiwan East Coast', 'Jeju'],
  shopping_city: ['Tokyo', 'Seoul', 'Bangkok', 'Hong Kong', 'Taipei', 'Singapore', 'Paris'],
  hidden_gems: ['Okinawa', 'Tainan', 'Kanazawa', 'Da Nang', 'Penang', 'Luang Prabang', 'Fukuoka'],
};
