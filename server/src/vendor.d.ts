// Déclarations minimales pour les paquets sans types officiels.

declare module 'all-the-cities' {
  interface City {
    cityId: number;
    name: string;
    altName: string;
    country: string;
    featureCode: string;
    adminCode?: string;
    population: number;
    loc: { type: 'Point'; coordinates: [number, number] };
  }
  const cities: City[];
  export default cities;
}

declare module 'heic-convert' {
  function convert(options: {
    buffer: Buffer;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<ArrayBuffer>;
  export default convert;
}
