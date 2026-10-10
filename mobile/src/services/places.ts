import { NearbyPlace } from "../types/context";
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = (x: number) => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function osmCategories(tags: Record<string, string>): string[] {
  const categories: string[] = [];
  if (["supermarket", "convenience", "grocery"].includes(tags.shop)) categories.push("grocery_store");
  if (tags.amenity === "pharmacy" || tags.shop === "chemist") categories.push("pharmacy");
  if (tags.leisure === "fitness_centre") categories.push("gym");
  if (["restaurant", "fast_food"].includes(tags.amenity)) categories.push("restaurant");
  if (tags.amenity === "cafe") categories.push("coffee_shop");
  if (["university", "college", "school", "library"].includes(tags.amenity)) categories.push("university");
  if (["mall", "department_store", "clothes"].includes(tags.shop)) categories.push("shopping");
  return categories;
}
type Element = { id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
export function mapPlaces(elements: Element[], latitude: number, longitude: number): NearbyPlace[] {
  return elements.flatMap(element => {
    const lat = element.lat ?? element.center?.lat; const lon = element.lon ?? element.center?.lon;
    const types = osmCategories(element.tags ?? {});
    if (lat === undefined || lon === undefined || !types.length) return [];
    return [{ name: element.tags?.name, types, latitude: lat, longitude: lon, distanceMeters: distanceMeters(latitude, longitude, lat, lon) }];
  }).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 100);
}
let cache: { latitude: number; longitude: number; at: number; places: NearbyPlace[] } | undefined;
export async function nearbyPlaces(latitude: number, longitude: number): Promise<NearbyPlace[]> {
  if (cache && Date.now() - cache.at < 120000 && distanceMeters(latitude, longitude, cache.latitude, cache.longitude) < 100) {
    return cache.places.map(place => ({ ...place, distanceMeters: distanceMeters(latitude, longitude, place.latitude!, place.longitude!) }));
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const around = `around:500,${latitude},${longitude}`;
    const query = `[out:json][timeout:12];(nwr(${around})[shop~"^(supermarket|convenience|grocery|chemist|mall|department_store|clothes)$"];nwr(${around})[amenity~"^(pharmacy|restaurant|fast_food|cafe|university|college|school|library)$"];nwr(${around})[leisure=fitness_centre];);out center;`;
    const endpoint = process.env.EXPO_PUBLIC_PLACES_URL ?? "https://overpass-api.de/api/interpreter";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}`, signal: controller.signal });
    if (!response.ok) throw new Error("Nearby place lookup is unavailable. Try again later.");
    const data = await response.json() as { elements: Element[] };
    const places = mapPlaces(data.elements, latitude, longitude);
    cache = { latitude, longitude, at: Date.now(), places }; return places;
  } finally { clearTimeout(timer); }
}
