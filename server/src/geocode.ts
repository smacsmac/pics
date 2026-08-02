import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import frLocale from 'i18n-iso-countries/langs/fr.json' with { type: 'json' };
import koLocale from 'i18n-iso-countries/langs/ko.json' with { type: 'json' };
import type { Lang } from '../../shared/types.js';

countries.registerLocale(enLocale as never);
countries.registerLocale(frLocale as never);
countries.registerLocale(koLocale as never);

export interface Place {
  city: string;
  admin: string | null;
  country: string; // code ISO à deux lettres
}

/**
 * Codes admin1 GeoNames → nom lisible. On ne couvre que les pays où la
 * distinction compte pour l'utilisateur ; ailleurs on affiche « Ville, Pays ».
 */
const ADMIN1: Record<string, Record<string, string>> = {
  CA: {
    '01': 'Alberta', '02': 'British Columbia', '03': 'Manitoba', '04': 'New Brunswick',
    '05': 'Newfoundland and Labrador', '07': 'Nova Scotia', '08': 'Ontario',
    '09': 'Prince Edward Island', '10': 'Quebec', '11': 'Saskatchewan', '12': 'Yukon',
    '13': 'Northwest Territories', '14': 'Nunavut',
  },
  US: {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  },
};

interface CityIndex {
  lat: Float32Array;
  lon: Float32Array;
  name: string[];
  admin: (string | null)[];
  country: string[];
  pop: Float64Array;
}

let index: CityIndex | null = null;
let loadFailed = false;

/**
 * `all-the-cities` fait ~6 Mo et 135 000 entrées. On le charge à la demande,
 * une seule fois, et on aplatit en tableaux typés pour que la recherche du plus
 * proche voisin reste sous la milliseconde.
 */
async function load(): Promise<CityIndex | null> {
  if (index) return index;
  if (loadFailed) return null;
  try {
    const mod = await import('all-the-cities');
    const cities = (mod.default ?? mod) as Array<{
      name: string;
      country: string;
      adminCode?: string;
      population: number;
      loc: { coordinates: [number, number] };
    }>;
    const n = cities.length;
    const built: CityIndex = {
      lat: new Float32Array(n),
      lon: new Float32Array(n),
      name: new Array(n),
      admin: new Array(n),
      country: new Array(n),
      pop: new Float64Array(n),
    };
    for (let i = 0; i < n; i++) {
      const c = cities[i];
      built.lon[i] = c.loc.coordinates[0];
      built.lat[i] = c.loc.coordinates[1];
      built.name[i] = c.name;
      built.country[i] = c.country;
      built.admin[i] = ADMIN1[c.country]?.[c.adminCode ?? ''] ?? null;
      built.pop[i] = c.population;
    }
    index = built;
    return index;
  } catch (err) {
    loadFailed = true;
    console.warn('[geo] base de villes indisponible, les lieux seront ignorés :', err);
    return null;
  }
}

export function preloadGeocoder(): void {
  void load();
}

const cache = new Map<string, Place | null>();

/**
 * Cherche la ville la plus proche des coordonnées EXIF. Aucune requête réseau :
 * tout se joue sur la base embarquée.
 *
 * À rayon comparable on préfère la ville la plus peuplée — sinon une photo prise
 * à Hamilton ressort au nom d'un hameau voisin de 1 200 habitants.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<Place | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const idx = await load();
  if (!idx) return null;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const KM_PER_DEG = 111.32;
  let best = -1;
  let bestScore = Infinity;

  for (let i = 0; i < idx.lat.length; i++) {
    const dLat = idx.lat[i] - lat;
    if (dLat > 1.5 || dLat < -1.5) continue; // élagage grossier (~165 km) mais très rentable
    const dLon = (idx.lon[i] - lon) * cosLat;
    const dKm = Math.hypot(dLat, dLon) * KM_PER_DEG;
    if (dKm > 160) continue;

    // Score en kilomètres « ressentis » : chaque facteur 10 de population
    // rapproche virtuellement la ville de 4 km. Sans ça une photo prise à
    // Vancouver ressort au nom du quartier voisin de 44 000 habitants plutôt
    // que de la ville de 600 000 située 3 km plus loin.
    const score = dKm - 4 * Math.log10(Math.max(1000, idx.pop[i]) / 1000);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }

  const place: Place | null =
    best === -1
      ? null
      : { city: idx.name[best], admin: idx.admin[best], country: idx.country[best] };
  cache.set(key, place);
  return place;
}

export function formatPlace(
  city: string | null,
  admin: string | null,
  country: string | null,
  lang: Lang = 'en',
): string | null {
  if (!city) return null;
  const parts = [city];
  if (admin) parts.push(admin);
  if (country) parts.push(countries.getName(country, lang) ?? country);
  return parts.join(', ');
}
